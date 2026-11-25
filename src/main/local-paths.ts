import fs from 'node:fs/promises';
import path from 'node:path';
import { ipcMain, shell } from 'electron';
import { MAX_LOCAL_PATH_CANDIDATES, MAX_LOCAL_PATH_LENGTH, ResolvedLocalPath } from '../shared/local-paths';

const MAX_SPACE_PROBES = 12;
const STAT_CACHE_TTL_MS = 3000;
const STAT_CACHE_MAX = 500;

const statCache = new Map<string, { kind: 'file' | 'dir' | null; at: number }>();

export function clearLocalPathCache(): void {
  statCache.clear();
}

function isUncPath(value: string): boolean {
  return /^(?:\\\\|\/\/)/.test(value);
}

async function statKind(target: string): Promise<'file' | 'dir' | null> {
  const key = target.toLowerCase();
  const now = Date.now();
  const cached = statCache.get(key);
  if (cached && now - cached.at < STAT_CACHE_TTL_MS) return cached.kind;
  let kind: 'file' | 'dir' | null = null;
  try {
    const st = await fs.stat(target);
    kind = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
  } catch {
    kind = null;
  }
  if (statCache.size >= STAT_CACHE_MAX) statCache.clear();
  statCache.set(key, { kind, at: now });
  return kind;
}

function splitTrailingLocation(raw: string): { base: string; line?: number } {
  const hashMatch = raw.match(/^(.*)#L(\d+)(?:-L?\d+)?$/i);
  if (hashMatch && hashMatch[1]) {
    return { base: hashMatch[1], line: Number(hashMatch[2]) };
  }
  const colonMatch = raw.match(/^(.*?):(\d+)(?::\d+)?$/);
  if (colonMatch && colonMatch[1] && !/^[A-Za-z]$/.test(colonMatch[1])) {
    return { base: colonMatch[1], line: Number(colonMatch[2]) };
  }
  return { base: raw };
}

function trimProbeSegment(seg: string): string {
  let out = seg.replace(/\s+$/, '');
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last === ',' || last === ';' || last === '.' || last === ']' || last === '}') {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (out.match(/\(/g) || []).length;
      const closes = (out.match(/\)/g) || []).length;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return out;
}

async function resolveSingleLocalPath(cwd: string, rawInput: string): Promise<ResolvedLocalPath | null> {
  if (!rawInput || rawInput.length > MAX_LOCAL_PATH_LENGTH || isUncPath(rawInput)) return null;

  // 1. file:/// URI
  if (/^file:\/\/\//i.test(rawInput)) {
    const lineMatch = rawInput.match(/#L(\d+)(?:-L?\d+)?$/i);
    const line = lineMatch ? Number(lineMatch[1]) : undefined;
    const withoutFragment = rawInput.split('#')[0].split('?')[0];
    let decoded = '';
    try {
      decoded = decodeURIComponent(withoutFragment.slice('file://'.length));
    } catch {
      return null;
    }
    if (/^\/[A-Za-z]:[\\/]/.test(decoded)) decoded = decoded.slice(1);
    if (!decoded || isUncPath(decoded)) return null;
    const target = path.resolve(decoded);
    const kind = await statKind(target);
    return kind ? { target, kind, matchedLength: rawInput.length, ...(line !== undefined ? { line } : {}) } : null;
  }

  // 2. Windows 盘符绝对路径（含空格时从左到右最多试探 MAX_SPACE_PROBES 个切分点，按最长真实存在前缀命中）
  if (/^[A-Za-z]:[\\/]/.test(rawInput)) {
    const spaceIndices: number[] = [];
    for (let i = 0; i < rawInput.length; i++) {
      if (/\s/.test(rawInput[i])) spaceIndices.push(i);
    }
    const endIndices = spaceIndices.length < MAX_SPACE_PROBES
      ? [...spaceIndices, rawInput.length]
      : spaceIndices.slice(0, MAX_SPACE_PROBES);

    for (let i = endIndices.length - 1; i >= 0; i--) {
      const endIdx = endIndices[i];
      if (endIdx < rawInput.length && /^\s+[^\s\\/]+[\\/]/.test(rawInput.slice(endIdx))) continue;
      const trimmed = trimProbeSegment(rawInput.slice(0, endIdx));
      if (trimmed.length < 3) continue;
      const { base, line } = splitTrailingLocation(trimmed);
      if (!base || base.length < 3 || isUncPath(base)) continue;
      const target = path.resolve(base);
      const kind = await statKind(target);
      if (kind) {
        return { target, kind, matchedLength: trimmed.length, ...(line !== undefined ? { line } : {}) };
      }
    }
    return null;
  }

  // 3. 相对路径（需基于当前任务 cwd）
  if (!cwd || isUncPath(cwd)) return null;
  const trimmed = trimProbeSegment(rawInput);
  const { base, line } = splitTrailingLocation(trimmed);
  if (!base || isUncPath(base)) return null;
  const target = path.resolve(cwd, base);
  const kind = await statKind(target);
  return kind ? { target, kind, matchedLength: trimmed.length, ...(line !== undefined ? { line } : {}) } : null;
}

export async function resolveLocalPaths(cwd: string, candidates: string[]): Promise<Array<ResolvedLocalPath | null>> {
  const list = Array.isArray(candidates) ? candidates.slice(0, MAX_LOCAL_PATH_CANDIDATES) : [];
  return Promise.all(list.map((item) => resolveSingleLocalPath(cwd, String(item ?? ''))));
}

/** 打开文件夹，或定位并选中文件所在文件夹（绝不直接执行文件）。 */
export async function openLocalPath(targetPath: string): Promise<boolean> {
  try {
    const raw = typeof targetPath === 'string' ? targetPath.trim() : '';
    if (!raw || isUncPath(raw)) return false;
    const normalized = path.resolve(raw);
    const st = await fs.stat(normalized);
    if (st.isDirectory()) {
      return (await shell.openPath(normalized)) === '';
    }
    if (st.isFile()) {
      shell.showItemInFolder(normalized);
      return true;
    }
  } catch {
    // 路径不存在或无法访问
  }
  return false;
}

export function setupLocalPaths(): void {
  ipcMain.handle('path:resolve-local', (_event, cwd: string, candidates: unknown) =>
    resolveLocalPaths(String(cwd || ''), Array.isArray(candidates) ? candidates.map(String) : []),
  );
  ipcMain.handle('shell:open-local-path', (_event, targetPath: string) =>
    openLocalPath(String(targetPath || '')),
  );
}
