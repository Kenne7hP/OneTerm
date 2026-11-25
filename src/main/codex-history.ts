import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { t } from './i18n';

type Method = 'thread/list' | 'thread/read' | 'thread/turns/list';
export type HistoryRequest = (root: string, method: Method, params: Record<string, unknown>) => Promise<any>;

function isFile(file: string): boolean {
  try { return statSync(file).isFile(); } catch { return false; }
}

function npmCodexExecutable(dir: string, arch: string): string | undefined {
  const { pkg, triple } = arch === 'arm64'
    ? { pkg: 'codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' }
    : { pkg: 'codex-win32-x64', triple: 'x86_64-pc-windows-msvc' };
  const codexPkg = path.join(dir, 'node_modules', '@openai', 'codex');
  const pkgRoots = [codexPkg];
  try {
    const resolved = realpathSync(codexPkg);
    if (resolved !== codexPkg) pkgRoots.push(resolved);
  } catch { /* Missing or unreadable package root falls through to fallback candidates. */ }
  const candidates: string[] = [];
  for (const root of pkgRoots) {
    candidates.push(
      path.join(root, 'node_modules', '@openai', pkg, 'vendor', triple, 'bin', 'codex.exe'),
      path.join(root, '..', pkg, 'vendor', triple, 'bin', 'codex.exe'),
      path.join(root, 'vendor', triple, 'bin', 'codex.exe'),
    );
  }
  candidates.push(path.join(dir, 'node_modules', '@openai', pkg, 'vendor', triple, 'bin', 'codex.exe'));
  return candidates.find(isFile);
}

/** Resolve the native Codex executable path, supporting npm/pnpm shims on Windows. */
export function resolveCodexExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform !== 'win32') return 'codex';
  const installed = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
  if (installed && isFile(installed)) return installed;
  const dirs = [...new Set((env.PATH || env.Path || '').split(path.delimiter).filter(Boolean))];
  for (const dir of dirs) {
    const direct = path.join(dir, 'codex.exe');
    if (isFile(direct)) return direct;
    if (isFile(path.join(dir, 'codex.cmd'))) {
      const bundled = npmCodexExecutable(dir, arch);
      if (bundled) return bundled;
    }
  }
  if (env.APPDATA) {
    const fallback = npmCodexExecutable(path.join(env.APPDATA, 'npm'), arch);
    if (fallback) return fallback;
  }
  return 'codex.exe';
}

export const requestHistory: HistoryRequest = (root, method, params) => callCodex(root, method, params);
// Naming a newly allocated thread materializes its rollout before the terminal resumes it.
export async function allocateCodexThread(root: string, cwd: string, title: string): Promise<string> {
  await mkdir(root, { recursive: true });
  return callCodex(root, 'thread/start', { cwd, ephemeral: false }, title);
}
function callCodex(root: string, method: Method | 'thread/start', params: Record<string, unknown>, title?: string): Promise<any> {
  return new Promise((resolve, reject) => {
  const executable = resolveCodexExecutable();
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    env: { ...process.env, CODEX_HOME: root }, cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  let done = false;
  const finish = (ok: boolean, result?: unknown) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (!child.stdin.writableEnded) child.stdin.end();
    if (!ok || !title) child.kill();
    if (ok) resolve(result);
    else reject(new Error(t('Codex 历史读取失败，请刷新后重试。')));
  };
  const timer = setTimeout(() => finish(false), 15000);
  child.once('error', () => finish(false));
  let persisted = false;
  child.once('close', code => finish(persisted && code === 0, threadId));
  child.stdin.on('error', () => finish(false));
  const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
  child.stdout.setEncoding('utf8');
  let buffer = '';
  let threadId: string | undefined;
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 16 * 1024 * 1024) return finish(false);
    let end: number;
    while (!done && (end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.id === 1 && msg.result) {
          send({ method: 'initialized' });
          send({ id: 2, method, params });
        } else if (msg.id === 2 && title && !msg.error) {
          const id = msg.result?.thread?.id;
          if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return finish(false);
          threadId = id;
          send({ id: 3, method: 'thread/name/set', params: { threadId, name: title } });
        } else if (msg.id === 3 && threadId && !msg.error) { persisted = true; child.stdin.end(); }
        else if (msg.id === 3 && msg.error) finish(false);
        else if (msg.id === 2 || (msg.id === 1 && msg.error)) finish(!msg.error, msg.result);
      } catch { finish(false); }
    }
  });
  send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'oneai', version: '1' }, capabilities: { experimentalApi: true } } });
  });
}
