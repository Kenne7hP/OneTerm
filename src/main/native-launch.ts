import { resumeCommand } from '../shared/workbench';
import path from 'node:path';
import fs from 'node:fs/promises';
import { nativeKey, NativeSessionRef, normalWorkspacePath } from '../shared/workbench';
import { NativeSessions, nativeRoots } from './native-sessions';
import { allocateCodexThread } from './codex-history';
import { t } from './i18n';

export class NativeLaunch {
  private owners = new Map<string, { id: string; ref: NativeSessionRef }>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private native: NativeSessions, private pty: {
    hasSession(id: string): boolean;
    getSessionOptions(id: string): { command?: string; cwd?: string; account?: unknown } | undefined;
    createSession(options: any): { success: boolean; error?: string; buffer?: string };
  }) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn); this.tail = result.catch(() => {}); return result;
  }
  private check(ref: NativeSessionRef, id: string) {
    for (const [key, owner] of this.owners) if (!this.pty.hasSession(owner.id)) this.owners.delete(key);
    const owner = this.owners.get(nativeKey(ref));
    if (owner && owner.id !== id) throw new Error(t('此原生会话已在另一个终端中打开'));
    if (this.pty.hasSession(id) && [...this.owners.entries()].some(([key, value]) => value.id === id && key !== nativeKey(ref))) throw new Error(t('会话身份已关联'));
  }
  create(options: any) {
    return this.serial(async () => {
      try {
        if (options.newCodexTitle && !options.nativeSession && !options.account && options.command === 'codex') {
          const existing = [...this.owners.values()].find(owner => owner.id === options.id);
          if (existing && this.pty.hasSession(options.id)) return { success: true, nativeSession: existing.ref };
          if (!(await fs.stat(options.cwd)).isDirectory()) throw new Error(t('项目目录不可用'));
          const storageRoot = nativeRoots().codex;
          const id = await allocateCodexThread(storageRoot, options.cwd, options.newCodexTitle);
          const ref: NativeSessionRef = { tool: 'codex', id, cwd: options.cwd, storageRoot };
          const result = this.pty.createSession({ ...options, command: `codex resume ${id}`, nativeSession: ref });
          if (result.success) this.owners.set(nativeKey(ref), { id: options.id, ref });
          return { ...result, nativeSession: ref };
        }
        if (options.nativeSession) {
          if (options.account) throw new Error(t('原生历史面板目前仅支持默认账号'));
          const { entry } = await this.native.resolve(options.nativeSession);
          if (path.resolve(normalWorkspacePath(options.cwd)).toLowerCase() !== path.resolve(normalWorkspacePath(entry.cwd)).toLowerCase()) throw new Error(t('会话目录不匹配'));
          if (!(await fs.stat(entry.cwd)).isDirectory()) throw new Error(t('项目目录不可用'));
          this.check(entry, options.id);
          if (this.pty.hasSession(options.id) && this.owners.get(nativeKey(entry))?.id !== options.id) throw new Error(t('会话身份未确认'));
          options = { ...options, command: resumeCommand(entry) };
          const result = this.pty.createSession(options);
          if (result.success) this.owners.set(nativeKey(entry), { id: options.id, ref: entry });
          return result;
        }
        return this.pty.createSession(options);
      } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
    });
  }
  bind(id: string, ref: NativeSessionRef) {
    return this.serial(async () => {
      const { entry } = await this.native.resolve(ref);
      if (!this.pty.hasSession(id)) throw new Error(t('没有活动终端'));
      const options = this.pty.getSessionOptions(id);
      if (!options || options.account || !new RegExp(`^${entry.tool}(?:\\s|$)`, 'i').test(options.command || '') || path.resolve(normalWorkspacePath(options.cwd || '')).toLowerCase() !== path.resolve(normalWorkspacePath(entry.cwd)).toLowerCase()) throw new Error(t('会话目录不匹配'));
      this.check(entry, id);
      for (const owner of this.owners.values()) if (owner.id === id && nativeKey(owner.ref) !== nativeKey(entry)) throw new Error(t('会话身份已关联'));
      this.owners.set(nativeKey(entry), { id, ref: entry });
      return entry;
    });
  }
}
