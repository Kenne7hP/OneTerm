import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { CodexPayloadInfo } from '../shared/workbench';
import { resolveConfigDir } from './account-env';
import { nativeRoots, within } from './native-sessions';

const WARN_MB = 2.5;
const DANGER_MB = 3.6;
const WARN_IMGS = 6;
const DANGER_IMGS = 10;
const FRAME_OVERHEAD_BYTES = 35_000;
const SLICE_BYTES = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const MAX_TASKS = 50;
const MAX_SCAN = 6000;
const MAX_HEADER_FALLBACK = 50;
const MAX_FILE_CACHE = 100;
const MAX_PATH_CACHE = 200;

const COMPACTED_A = Buffer.from('"type":"compacted"');
const COMPACTED_B = Buffer.from('"type": "compacted"');
const RESPONSE_A = Buffer.from('"type":"response_item"');
const RESPONSE_B = Buffer.from('"type": "response_item"');
const DATA_IMAGE_BUF = Buffer.from('data:image/');

interface FileCacheEntry {
  offset: number;
  mtimeMs: number;
  size: number;
  pending: Buffer;
  activeBytes: number;
  activeImages: number;
  compacts: number;
}

const fileCache = new Map<string, FileCacheEntry>();
const pathCache = new Map<string, string>();

function countBufOccurrences(haystack: Buffer, needle: Buffer): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function buildPayloadInfo(entry: FileCacheEntry): CodexPayloadInfo {
  const estMb = (entry.activeBytes + FRAME_OVERHEAD_BYTES) / 1_000_000;
  const fileMb = entry.size / 1_000_000;
  const level: CodexPayloadInfo['level'] =
    estMb >= DANGER_MB || entry.activeImages >= DANGER_IMGS
      ? 'danger'
      : estMb >= WARN_MB || entry.activeImages >= WARN_IMGS
        ? 'warn'
        : 'ok';
  return {
    estMb,
    fileMb,
    activeBytes: entry.activeBytes,
    fileBytes: entry.size,
    images: entry.activeImages,
    compacts: entry.compacts,
    level,
    updatedAt: entry.mtimeMs,
  };
}

function setLru<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

/**
 * Incrementally scan a Codex rollout `.jsonl` file from the last read offset
 * (resetting counters when a `compacted` entry appears) and return its active
 * request payload estimate, embedded image count, compaction count, and health level.
 */
export async function measureCodexRolloutFile(file: string): Promise<CodexPayloadInfo | null> {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return null;

    let entry = fileCache.get(file);
    if (entry && entry.mtimeMs === stat.mtimeMs && entry.size === stat.size) {
      setLru(fileCache, file, entry, MAX_FILE_CACHE);
      return buildPayloadInfo(entry);
    }

    if (!entry || stat.size < entry.offset) {
      entry = {
        offset: 0,
        mtimeMs: 0,
        size: 0,
        pending: Buffer.alloc(0),
        activeBytes: 0,
        activeImages: 0,
        compacts: 0,
      };
    }

    if (stat.size > entry.offset) {
      const handle = await fs.promises.open(file, 'r');
      try {
        while (entry.offset < stat.size) {
          const toRead = Math.min(SLICE_BYTES, stat.size - entry.offset);
          const chunk = Buffer.alloc(toRead);
          const { bytesRead } = await handle.read(chunk, 0, toRead, entry.offset);
          if (bytesRead <= 0) break;
          entry.offset += bytesRead;

          const data = entry.pending.length > 0 ? Buffer.concat([entry.pending, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
          let lineStart = 0;
          let nl: number;
          while ((nl = data.indexOf(0x0a, lineStart)) !== -1) {
            const lineBuf = data.subarray(lineStart, nl);
            lineStart = nl + 1;
            const lineBytes = lineBuf.length + 1;
            if (lineBuf.includes(COMPACTED_A) || lineBuf.includes(COMPACTED_B)) {
              entry.compacts += 1;
              entry.activeBytes = lineBytes;
              entry.activeImages = countBufOccurrences(lineBuf, DATA_IMAGE_BUF);
            } else if (lineBuf.includes(RESPONSE_A) || lineBuf.includes(RESPONSE_B)) {
              entry.activeBytes += lineBytes;
              entry.activeImages += countBufOccurrences(lineBuf, DATA_IMAGE_BUF);
            }
          }
          entry.pending = lineStart < data.length ? Buffer.from(data.subarray(lineStart)) : Buffer.alloc(0);
        }
      } finally {
        await handle.close();
      }
    }

    entry.mtimeMs = stat.mtimeMs;
    entry.size = stat.size;
    setLru(fileCache, file, entry, MAX_FILE_CACHE);
    return buildPayloadInfo(entry);
  } catch {
    return null;
  }
}

async function readHeadLine(file: string): Promise<string | null> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(32 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (bytesRead <= 0) return null;
    const nl = buf.subarray(0, bytesRead).indexOf(0x0a);
    return buf.subarray(0, nl >= 0 ? nl : bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function walkNewestJsonl(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue: Array<[string, number]> = [[root, 4]];
  let scanned = 0;
  while (queue.length > 0 && scanned < MAX_SCAN) {
    const [dir, depth] = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const subDirs: string[] = [];
    for (const entry of entries) {
      if (++scanned > MAX_SCAN) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && depth > 0) {
        subDirs.push(entry.name);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(dir, entry.name));
      }
    }
    // Reverse lexicographical order visits newest YYYY/MM/DD directories first.
    subDirs.sort().reverse();
    for (const name of subDirs) {
      queue.push([path.join(dir, name), depth - 1]);
    }
  }
  return files;
}

/**
 * Locate the rollout `.jsonl` file for a confirmed Codex `sessionId` under `storageRoot`.
 */
export async function findCodexRolloutFile(storageRoot: string, sessionId: string): Promise<string | null> {
  if (!storageRoot || !ID_RE.test(sessionId)) return null;

  const cacheKey = `${storageRoot.toLowerCase()}|${sessionId}`;
  const cachedPath = pathCache.get(cacheKey);
  if (cachedPath) {
    try {
      const validated = await within(storageRoot, cachedPath);
      const stat = await fs.promises.stat(validated);
      if (stat.isFile()) {
        setLru(pathCache, cacheKey, validated, MAX_PATH_CACHE);
        return validated;
      }
    } catch {
      pathCache.delete(cacheKey);
    }
  }

  const sessionsDir = path.join(storageRoot, 'sessions');
  const allJsonl = await walkNewestJsonl(sessionsDir);
  if (allJsonl.length === 0) return null;

  const exactBase = `${sessionId}.jsonl`;
  const filenameMatches = allJsonl.filter((file) => {
    const base = path.basename(file);
    if (base === exactBase) return true;
    return base.includes(sessionId) && !base.includes('_');
  });

  if (filenameMatches.length > 0) {
    const withMtime = await Promise.all(
      filenameMatches.map(async (file) => {
        try {
          const stat = await fs.promises.stat(file);
          return stat.isFile() ? { file, mtimeMs: stat.mtimeMs } : null;
        } catch {
          return null;
        }
      }),
    );
    const valid = withMtime.filter((x): x is { file: string; mtimeMs: number } => x !== null);
    valid.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const candidate of valid) {
      try {
        const safePath = await within(storageRoot, candidate.file);
        setLru(pathCache, cacheKey, safePath, MAX_PATH_CACHE);
        return safePath;
      } catch { /* reject traversal or symlink escape */ }
    }
  }

  for (const file of allJsonl.slice(0, MAX_HEADER_FALLBACK)) {
    try {
      const safePath = await within(storageRoot, file);
      const firstLine = await readHeadLine(safePath);
      if (!firstLine) continue;
      const parsed = JSON.parse(firstLine);
      if (parsed?.type === 'session_meta' && parsed?.payload?.id === sessionId) {
        setLru(pathCache, cacheKey, safePath, MAX_PATH_CACHE);
        return safePath;
      }
    } catch { /* skip unreadable or non-JSON lines */ }
  }

  return null;
}

/**
 * Resolve and measure payloads for a batch of confirmed Codex tasks.
 */
export async function readCodexPayloads(
  raw: unknown,
  defaultRoot?: string,
): Promise<Record<string, CodexPayloadInfo>> {
  if (!Array.isArray(raw)) return {};
  const fallbackRoot = defaultRoot ?? nativeRoots().codex;
  const result: Record<string, CodexPayloadInfo> = {};

  const items = raw.slice(0, MAX_TASKS);
  await Promise.all(
    items.map(async (item) => {
      if (!item || typeof item !== 'object') return;
      const { taskId, sessionId, storageRoot } = item as Record<string, unknown>;
      if (typeof taskId !== 'string' || !taskId) return;
      if (typeof sessionId !== 'string' || !ID_RE.test(sessionId)) return;

      let root: string;
      if (typeof storageRoot === 'string' && storageRoot.trim()) {
        const resolved = resolveConfigDir(storageRoot);
        if (!resolved) return;
        root = resolved;
      } else {
        root = fallbackRoot;
      }

      const file = await findCodexRolloutFile(root, sessionId);
      if (!file) return;
      const info = await measureCodexRolloutFile(file);
      if (info) result[taskId] = info;
    }),
  );

  return result;
}

export function setupCodexPayload(): void {
  ipcMain.handle('codex:payloads', (_event, tasks: unknown) => readCodexPayloads(tasks));
}
