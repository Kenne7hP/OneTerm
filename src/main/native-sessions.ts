import fs from 'node:fs/promises';
import { listAgy, geminiRoot } from './agy-history';
import { within } from './within';
export { within } from './within';
import os from 'node:os';
import path from 'node:path';
import { NativeHistoryEntry, NativeSessionRef, PromptPage, nativeKey, normalWorkspacePath } from '../shared/workbench';
import { t } from './i18n';
import { codexThreadNames } from './session-history';
import { HistoryRequest, requestHistory } from './codex-history';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const MAX_SCAN = 6000;
const PAGE_BYTES = 2 * 1024 * 1024;
export function nativeRoots(): Record<NativeSessionRef['tool'], string> {
  return { agy: geminiRoot(), codex: path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex')), kimi: path.resolve(process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code')) };
}
async function boundedBuffer(file: string, bytes: number, start = 0): Promise<Buffer> {
  const handle = await fs.open(file, 'r');
  try { const buffer = Buffer.alloc(bytes); const result = await handle.read(buffer, 0, bytes, start); return buffer.subarray(0, result.bytesRead); }
  finally { await handle.close(); }
}
async function boundedRead(file: string, bytes: number, start = 0): Promise<string> { return (await boundedBuffer(file, bytes, start)).toString('utf8'); }
async function walk(root: string, depth: number, predicate: (name: string) => boolean): Promise<string[]> {
  const files: string[] = [], queue: Array<[string, number]> = [[root, depth]];
  let count = 0;
  while (queue.length && count < MAX_SCAN) {
    const [dir, left] = queue.shift()!;
    try {
      const iterator = await fs.opendir(dir);
      for await (const entry of iterator) {
        if (++count > MAX_SCAN) break;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && left > 0) queue.push([path.join(dir, entry.name), left - 1]);
        else if (entry.isFile() && predicate(entry.name)) files.push(path.join(dir, entry.name));
      }
    } catch { /* unavailable directories do not redirect to another account */ }
  }
  return files;
}
function extractAgyUserText(content: string): string {
  const req = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(content)?.[1];
  if (req !== undefined) return req.trim();
  return content
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
    .replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/g, '')
    .trim();
}
type Indexed = { entry: NativeHistoryEntry; file: string } | { entry: NativeHistoryEntry; server: true };
export class NativeSessions {
  constructor(private roots = nativeRoots(), private request: HistoryRequest = requestHistory) {}
  private index = new Map<string, Indexed>();
  private scannedAt = 0;
  private pending?: Promise<NativeHistoryEntry[]>;
  private visibleEntries() {
    return [...this.index.values()].map(x => x.entry).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 400);
  }
  private indexedCodex(thread: any): NativeHistoryEntry | undefined {
    if (typeof thread?.id !== 'string' || !ID.test(thread.id) || typeof thread.cwd !== 'string' || !path.isAbsolute(thread.cwd)) return;
    return { tool: 'codex', id: thread.id, cwd: normalWorkspacePath(thread.cwd), storageRoot: this.roots.codex, title: String(thread.name || thread.preview || thread.id).replace(/\s+/g, ' ').slice(0, 100), updatedAt: thread.updatedAt * 1000 };
  }
  async list(refresh = false): Promise<NativeHistoryEntry[]> {
    if (this.pending) return this.pending;
    if (!refresh && Date.now() - this.scannedAt < 3000) return this.visibleEntries();
    this.pending = this.scan();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  private async scan(): Promise<NativeHistoryEntry[]> {
    const names = await codexThreadNames(this.roots.codex);
    const next = new Map<string, Indexed>();
    const ambiguous = new Set<string>();
    for (const tool of ['codex', 'kimi'] as const) {
      const storageRoot = this.roots[tool];
      const files = await walk(path.join(storageRoot, 'sessions'), tool === 'codex' ? 4 : 2, name => tool === 'codex' ? name.endsWith('.jsonl') : name === 'state.json');
      // Bound open file concurrency and body size. No credentials or native configuration reads.
      for (const file of files) {
        try {
          await within(storageRoot, file);
          const head = await boundedRead(file, 128 * 1024);
          let id: string, cwd: string, title: string, transcript: string;
          if (tool === 'codex') {
            const first = JSON.parse(head.split('\n')[0]);
            if (first.type !== 'session_meta' || !['cli', 'vscode'].includes(first.payload?.source)) continue;
            // New paginated/forked/reverted histories require native database resolution.
            // Do not mistake a physical rollout ID or old segment for the active thread.
            if (first.payload.history_base || (first.payload.history_mode && first.payload.history_mode !== 'legacy') || path.basename(file).includes('_')) continue;
            ({ id, cwd } = first.payload);
            title = names.get(id) || first.payload.thread_name || path.basename(cwd || '') || 'Codex';
            transcript = file;
          } else {
            const state = JSON.parse(head);
            if (state.archived || path.basename(path.dirname(file)) !== state.id) continue;
            ({ id, cwd } = state);
            title = state.title || state.lastPrompt || 'Kimi';
            transcript = path.join(path.dirname(file), 'agents', 'main', 'wire.jsonl');
          }
          if (!ID.test(id) || typeof cwd !== 'string' || !path.isAbsolute(cwd)) continue;
          const entry: NativeHistoryEntry = { tool, id, cwd, storageRoot, title: String(title).replace(/\s+/g, ' ').slice(0, 100), updatedAt: (await fs.stat(file)).mtimeMs };
          const key = nativeKey(entry);
          // Ambiguous duplicate IDs never select one arbitrarily.
          if (ambiguous.has(key)) continue;
          if (next.has(key)) { next.delete(key); ambiguous.add(key); continue; }
          next.set(key, { entry, file: transcript });
        } catch { /* truncated or unsupported native records are omitted */ }
      }
    }
    if (this.roots.agy) for (const item of await listAgy(this.roots.agy)) next.set(nativeKey(item.entry), item);
    // The native index owns logical identities for paginated and forked threads.
    try {
      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const result = await this.request(this.roots.codex, 'thread/list', { limit: 100, cursor, sortKey: 'updated_at', modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer'], useStateDbOnly: true });
        for (const thread of result.data) {
          const entry = this.indexedCodex(thread);
          if (entry) next.set(nativeKey(entry), { entry, server: true });
        }
        if (!result.nextCursor || result.nextCursor === cursor) break;
        cursor = result.nextCursor;
      }
    } catch { /* Older CLI versions can still use verified legacy rollouts. */ }
    this.index = next; this.scannedAt = Date.now();
    return this.visibleEntries();
  }
  async resolve(ref: NativeSessionRef, refresh = true): Promise<Indexed> {
    if (!ref || !['codex', 'kimi', 'agy'].includes(ref.tool) || !ID.test(ref.id) || typeof ref.storageRoot !== 'string') throw new Error(t('会话身份未确认'));
    await this.list(refresh);
    let item = this.index.get(nativeKey(ref));
    if (!item && ref.tool === 'codex' && path.resolve(ref.storageRoot).toLowerCase() === path.resolve(this.roots.codex).toLowerCase()) {
      const { thread } = await this.request(this.roots.codex, 'thread/read', { threadId: ref.id, includeTurns: false });
      const exact = thread?.id === ref.id && ['cli','vscode','appServer'].includes(thread.source) && this.indexedCodex(thread);
      if (exact) item = { entry: exact, server: true };
    }
    if (!item || path.resolve(normalWorkspacePath(item.entry.cwd)).toLowerCase() !== path.resolve(normalWorkspacePath(ref.cwd)).toLowerCase()) throw new Error(t('原生会话不可用，请刷新历史'));
    return item;
  }
  async savedCodexRef(id: string, cwd: string) {
    const { entry } = await this.resolve({ tool: 'codex', id, cwd, storageRoot: this.roots.codex }, false);
    return entry;
  }
  async prompts(ref: NativeSessionRef, cursor?: string): Promise<PromptPage> {
    try {
      const item = await this.resolve(ref, false);
      if ('server' in item) {
        const token = cursor && JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (cursor && (token?.key !== nativeKey(ref) || typeof token.cursor !== 'string')) throw new Error(t('会话身份未确认'));
        const page = await this.request(this.roots.codex, 'thread/turns/list', { threadId: ref.id, limit: 3, itemsView: 'full', sortDirection: 'desc', cursor: token?.cursor });
        const items: PromptPage['items'] = [];
        for (const message of page.data.flatMap((turn: any) => [...turn.items].reverse())) {
          const role = message?.type === 'agentMessage' ? 'assistant' : message?.type === 'userMessage' ? 'user' : undefined;
          if (!role) continue;
          const text = role === 'assistant' ? message.text : message.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
          if (typeof text === 'string' && text.trim()) items.push({ role, text: text.slice(0, 16000), truncated: text.length > 16000 });
        }
        return { items, conversation: true, partial: false, next: page.nextCursor ? Buffer.from(JSON.stringify({ key: nativeKey(ref), cursor: page.nextCursor })).toString('base64url') : undefined };
      }
      if (ref.tool === 'agy') await within(this.roots.agy, item.entry.storageRoot);
      const file = await within(item.entry.storageRoot, item.file);
      const stat = await fs.stat(file);
      const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
      let end = stat.size;
      if (cursor) {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (parsed.key !== nativeKey(ref) || parsed.stamp !== stamp || !Number.isSafeInteger(parsed.before) || parsed.before < 0 || parsed.before > stat.size) throw new Error(t('历史已变化，请刷新后重试'));
        end = parsed.before;
      }
      const maxSlices = ref.tool === 'agy' ? 4 : 1;
      let sliceEnd = end;
      let nextEnd = end;
      let partial = false;
      const items: PromptPage['items'] = [];
      let lastTurn: PromptPage['lastTurn'];
      for (let slice = 0; slice < maxSlices && sliceEnd > 0; slice++) {
        const start = Math.max(0, sliceEnd - PAGE_BYTES);
        let bytes = await boundedBuffer(file, sliceEnd - start, start);
        nextEnd = start;
        if (start > 0) {
          // Cursor ends after the skipped leading record, so the previous page reads it.
          const nl = bytes.indexOf(10);
          if (nl >= 0) { nextEnd = start + nl + 1; bytes = bytes.subarray(nl + 1); }
          else bytes = Buffer.alloc(0); // A record larger than the byte budget is skipped, with partial=true.
          if (nextEnd >= sliceEnd) nextEnd = start;
        }
        partial = start > 0;
        const lines = bytes.toString('utf8').split('\n'); lines.pop(); // Never parse an incomplete final record.
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (ref.tool === 'agy') {
              const role = record.type === 'USER_INPUT' ? 'user' : record.type === 'PLANNER_RESPONSE' ? 'assistant' : undefined;
              if (!role || typeof record.content !== 'string') continue;
              const text = role === 'user' ? extractAgyUserText(record.content) : record.content.trim();
              if (text) {
                items.push({ role, text: text.slice(0, 16000), timestamp: typeof record.created_at === 'string' ? record.created_at : undefined, truncated: text.length > 16000 });
                lastTurn = role === 'assistant' && record.status === 'DONE' ? 'completed' : role === 'user' ? undefined : lastTurn;
              }
              continue;
            }
            const message = ref.tool === 'codex' ? record.payload : record;
            let content: unknown;
            if (ref.tool === 'codex' && record.type === 'response_item' && message?.type === 'message' && message.role === 'user') content = message.content;
            if (ref.tool === 'kimi' && ['turn.prompt', 'turn.steer'].includes(record.type) && record.origin?.kind === 'user') content = Array.isArray(record.input) ? record.input.filter((x: any) => !['user prompt submit hook', 'skill activation'].includes(x?.meta?.source)) : record.input;
            const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(x => x && ['text', 'input_text'].includes(x.type) && typeof x.text === 'string').map(x => x.text) : [];
            const prompt = parts.join('\n').trim();
            if (prompt && !/^# AGENTS\.md instructions|^<environment_context>|^<system_reminder>/.test(prompt)) items.push({ text: prompt.slice(0, 16000), timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined, truncated: prompt.length > 16000 });
            if (ref.tool === 'kimi' && record.type === 'turn.ended') lastTurn = ['completed', 'failed', 'cancelled'].includes(record.reason) ? record.reason : undefined;
            if (ref.tool === 'kimi' && ['turn.prompt', 'turn.steer'].includes(record.type)) lastTurn = undefined;
            if (ref.tool === 'codex' && record.type === 'event_msg' && message?.type === 'task_complete') lastTurn = 'completed';
            if (ref.tool === 'codex' && record.type === 'event_msg' && message?.type === 'task_started') lastTurn = undefined;
          } catch { /* invalid native record, never evaluate content */ }
        }
        if (items.length > 0 || nextEnd <= 0) break;
        sliceEnd = nextEnd;
      }
      const after = await fs.stat(file);
      if (`${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}` !== stamp) throw new Error(t('历史已变化，请刷新后重试'));
      return { items: items.reverse(), conversation: ref.tool === 'agy' || undefined, partial, lastTurn, next: nextEnd > 0 ? Buffer.from(JSON.stringify({ key: nativeKey(ref), stamp, before: nextEnd })).toString('base64url') : undefined };
    } catch (e) { return { items: [], partial: false, error: e instanceof Error ? e.message : t('无法读取历史') }; }
  }
}
export const nativeSessions = new NativeSessions();
