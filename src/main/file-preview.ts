import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { t } from './i18n';

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export type FilePreviewResult =
  | { kind: 'text'; path: string; size: number; content: string }
  | { kind: 'image'; path: string; size: number; dataUrl: string }
  | { kind: 'binary' | 'too-large' | 'error'; path: string; size?: number; message?: string };

/** 把候选路径解析为 cwd 内真实存在的文件；越界、不存在或不是文件时返回 null。 */
async function resolveInside(cwd: string, candidate: string): Promise<string | null> {
  try {
    const root = await fs.realpath(path.resolve(String(cwd || '')));
    const target = await fs.realpath(path.resolve(root, String(candidate || '')));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return (await fs.stat(target)).isFile() ? target : null;
  } catch {
    return null;
  }
}

export async function readPreview(cwd: string, candidate: string): Promise<FilePreviewResult> {
  const target = await resolveInside(cwd, candidate);
  if (!target) return { kind: 'error', path: String(candidate), message: t('文件不存在，或不在当前任务工作目录内') };
  try {
    const { size } = await fs.stat(target);
    const mime = IMAGE_MIME[path.extname(target).toLowerCase()];
    const limit = mime ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
    if (size > limit) return { kind: 'too-large', path: target, size };
    const handle = await fs.open(target, 'r');
    let buffer: Buffer;
    try { const data = Buffer.alloc(limit + 1); const result = await handle.read(data, 0, data.length, 0); buffer = data.subarray(0, result.bytesRead); } finally { await handle.close(); }
    if (buffer.length > limit) return { kind: 'too-large', path: target, size: buffer.length };
    if (mime) {
      if (size > MAX_IMAGE_BYTES) return { kind: 'too-large', path: target, size };
      return { kind: 'image', path: target, size, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
    }
    if (size > MAX_TEXT_BYTES) return { kind: 'too-large', path: target, size };
    if (buffer.subarray(0, 8192).includes(0)) return { kind: 'binary', path: target, size };
    return { kind: 'text', path: target, size, content: buffer.toString('utf8') };
  } catch (error) {
    return { kind: 'error', path: target, message: error instanceof Error ? error.message : String(error) };
  }
}

export function setupFilePreview() {
  ipcMain.handle('preview:resolve', (_event, cwd: string, candidates: unknown) => {
    const list = Array.isArray(candidates) ? candidates.slice(0, 20) : [];
    return Promise.all(list.map((item) => resolveInside(cwd, String(item))));
  });
  ipcMain.handle('preview:read', (_event, cwd: string, filePath: string) => readPreview(cwd, filePath));
}
