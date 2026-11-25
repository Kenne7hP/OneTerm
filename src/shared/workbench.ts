export interface NativeSessionRef {
  tool: 'codex' | 'kimi' | 'agy';
  id: string;
  storageRoot: string;
  cwd: string;
}
// The Codex index can return extended Windows paths while One stores ordinary paths.
export function normalWorkspacePath(value: string): string {
  if (value.toUpperCase().startsWith('\\\\?\\UNC\\')) return '\\\\' + value.slice(8);
  return /^\\\\\?\\[a-z]:\\/i.test(value) ? value.slice(4) : value;
}
export interface NativeHistoryEntry extends NativeSessionRef {
  title: string;
  updatedAt: number;
}
export function resumeCommand(ref: NativeSessionRef): string {
  if (ref.tool === 'agy') return 'agy --conversation ' + ref.id;
  if (ref.tool === 'kimi') return 'kimi --session ' + ref.id;
  return 'codex resume ' + ref.id;
}
export interface PromptPage {
  items: Array<{ text: string; timestamp?: string; truncated: boolean; role?: 'assistant' | 'user' }>;
  conversation?: boolean;
  next?: string;
  partial: boolean;
  lastTurn?: 'completed' | 'cancelled' | 'failed';
  error?: string;
}
export interface ProjectListing {
  directory: string;
  entries: Array<{ name: string; path: string; directory: boolean; link: boolean }>;
  partial: boolean;
  error?: string;
}
export const nativeKey = (ref: NativeSessionRef) => `${ref.tool}:${ref.storageRoot.replace(/\\/g, '/').toLowerCase()}:${ref.id}`;

export interface AntigravityDesktopInfo {
  installed: boolean;
  executable?: string;
  version?: string;
  projectOpen: 'manual';
  error?: string;
}
export interface AntigravityOpenResult {
  success: boolean;
  projectOpened: false;
  clipboardCopied: boolean;
  error?: string;
}

export interface CodexPayloadRequest {
  taskId: string;
  sessionId: string;
  storageRoot?: string;
}

export interface CodexPayloadInfo {
  estMb: number;
  fileMb: number;
  activeBytes: number;
  fileBytes: number;
  images: number;
  compacts: number;
  level: 'ok' | 'warn' | 'danger';
  updatedAt: number;
}
