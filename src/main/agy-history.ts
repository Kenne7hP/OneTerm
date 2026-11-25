import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { NativeHistoryEntry, normalWorkspacePath } from '../shared/workbench';
import { within } from './within';

export const geminiRoot = () => path.resolve(process.env.GEMINI_HOME || path.join(os.homedir(), '.gemini'));
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;
const ALLOWED_SOURCES = new Set(['antigravity-cli', 'antigravity']);

function validTimestamp(...candidates: unknown[]): number {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
}

function decodePbtxtString(literal: string): string {
  const raw = literal.slice(1, -1);
  const bytes: number[] = [];
  const token = /\\([0-7]{1,3}|x[0-9a-fA-F]{2}|[\s\S])|([^\\]+)/g;
  for (const match of raw.matchAll(token)) {
    if (match[2] !== undefined) {
      bytes.push(...Buffer.from(match[2], 'utf8'));
      continue;
    }
    const esc = match[1];
    if (/^[0-7]{1,3}$/.test(esc)) bytes.push(parseInt(esc, 8) & 0xff);
    else if (/^x[0-9a-fA-F]{2}$/.test(esc)) bytes.push(parseInt(esc.slice(1), 16));
    else if (esc === 'n') bytes.push(0x0a);
    else if (esc === 'r') bytes.push(0x0d);
    else if (esc === 't') bytes.push(0x09);
    else if (esc === '"') bytes.push(0x22);
    else if (esc === "'") bytes.push(0x27);
    else if (esc === '\\') bytes.push(0x5c);
    else bytes.push(...Buffer.from(esc, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

function firstFileUriPath(uris: unknown): string | undefined {
  if (!Array.isArray(uris)) return undefined;
  for (const uri of uris) {
    if (typeof uri !== 'string' || !uri.startsWith('file:')) continue;
    try {
      const resolved = normalWorkspacePath(fileURLToPath(uri));
      if (path.isAbsolute(resolved)) return resolved;
    } catch { /* Ignore non-file or malformed URIs. */ }
  }
  return undefined;
}

export async function listAgy(root = geminiRoot()) {
  const cli = path.join(root, 'antigravity-cli');
  const result: {entry: NativeHistoryEntry; file: string}[] = [];
  const seen = new Set<string>();
  async function read(file: string) {
    return fs.readFile(await within(root, file), 'utf8');
  }
  async function readAnnotationTitle(storageRoot: string, id: string): Promise<string> {
    try {
      const annotation = await read(path.join(storageRoot, 'annotations', `${id}.pbtxt`));
      const match = /^title:\s*("(?:\\.|[^"\\])*")/m.exec(annotation);
      return match ? decodePbtxtString(match[1]).trim() : '';
    } catch {
      return '';
    }
  }
  async function add(id: string, source: string, cwd: string, title: string, updatedAt: number): Promise<boolean> {
    const normalizedCwd = normalWorkspacePath(cwd);
    if (!idPattern.test(id) || !ALLOWED_SOURCES.has(source) || !path.isAbsolute(normalizedCwd)) return false;
    const storageRoot = path.join(root, source);
    try { await within(root, storageRoot); } catch { return false; }
    const logs = path.join(storageRoot, 'brain', id, '.system_generated', 'logs');
    let file = path.join(logs, 'transcript_full.jsonl');
    try { await fs.access(file); } catch { file = path.join(logs, 'transcript.jsonl'); }
    let resolvedTitle = typeof title === 'string' ? title.trim() : '';
    if (!resolvedTitle) resolvedTitle = await readAnnotationTitle(storageRoot, id);
    let ts = updatedAt;
    if (ts <= 0) {
      try { ts = (await fs.stat(file)).mtimeMs; } catch { /* Transcript may not exist yet. */ }
    }
    result.push({
      entry: { tool: 'agy', id, title: (resolvedTitle || id).replace(/\s+/g, ' ').slice(0, 100), cwd: normalizedCwd, storageRoot, updatedAt: ts },
      file,
    });
    return true;
  }
  try {
    const cache = JSON.parse(await read(path.join(cli,'cache','conversation_metadata.json')));
    for (const [id, row] of Object.entries<any>(cache.conversations || {})) {
      if (row?.is_internal || row?.summary?.Internal) {
        seen.add(id);
        continue;
      }
      const s = row?.summary;
      if (!s || s.NumSteps === 0 || s.ID !== id) continue;
      const source = typeof s.AppDataDir === 'string' ? s.AppDataDir : '';
      const cwd = firstFileUriPath(s.WorkspaceURIs);
      if (!cwd || !ALLOWED_SOURCES.has(source)) continue;
      const updatedAt = validTimestamp(s.UpdatedAt, row.last_modified_time);
      const title = (typeof s.Title === 'string' && s.Title.trim())
        ? s.Title
        : (await readAnnotationTitle(path.join(root, source), id)) || (typeof s.Preview === 'string' ? s.Preview : '');
      if (await add(id, source, cwd, title, updatedAt)) seen.add(id);
    }
  } catch { /* A new CLI profile may have no metadata cache yet. */ }
  try {
    for (const line of (await read(path.join(cli,'history.jsonl'))).split('\n').reverse()) {
      try {
        const h = JSON.parse(line);
        const id = h.conversationId;
        if (typeof id !== 'string' || !idPattern.test(id) || seen.has(id) || typeof h.workspace !== 'string' || !(path.isAbsolute(h.workspace) || h.workspace.startsWith('file:'))) continue;
        const title = (await readAnnotationTitle(cli, id)) || (typeof h.display === 'string' ? h.display : '');
        const cwd = normalWorkspacePath(h.workspace.startsWith('file:') ? fileURLToPath(h.workspace) : h.workspace);
        if (await add(id, 'antigravity-cli', cwd, title, validTimestamp(h.timestamp))) seen.add(id);
      } catch { /* Ignore partial lines. */ }
    }
  } catch { /* History is optional. */ }
  return result;
}
