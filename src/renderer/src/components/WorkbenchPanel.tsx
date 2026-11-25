import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Copy, FileText, Folder, FolderOpen, History, Link2, MessageSquareText, RefreshCw, Search, X } from 'lucide-react';
import { TaskSession } from '../types';
import { AntigravityDesktopInfo, NativeHistoryEntry, NativeSessionRef, ProjectListing, PromptPage, nativeKey } from '../../../shared/workbench';
import { t } from '../i18n';
import { folderKey } from '../workspaceState';
import { BrandIcon } from './BrandIcon';
import { ConversationReader } from './ConversationReader';

export type WorkbenchTab = 'files' | 'prompts' | 'history' | 'connections';
interface Props {
  mainConversation?: boolean;
  antigravity?: AntigravityDesktopInfo | null; desktopBusy?: boolean;
  onOpenAntigravity?: () => void; onRefreshAntigravity?: () => void;
  task: TaskSession | null; cwd: string; tab: WorkbenchTab;
  installed: Record<string, boolean> | null; closed: TaskSession[];
  onTab: (tab: WorkbenchTab) => void; onClose: () => void;
  onPreview: (path: string) => void;
  onRestore: (ref: NativeSessionRef, title: string, sourceTaskId?: string) => Promise<void>;
  onBind: (ref: NativeHistoryEntry) => Promise<void>;
  onCodexPicker: () => Promise<void>;
  restoreWorkspace: boolean; onRecoveryChange: (value: boolean) => void;
}
export function WorkbenchPanel(p: Props) {
  const [directory, setDirectory] = useState('');
  const [hidden, setHidden] = useState(false);
  const [reload, setReload] = useState(0);
  const [listing, setListing] = useState<ProjectListing>();
  const [prompts, setPrompts] = useState<PromptPage>();
  const [history, setHistory] = useState<NativeHistoryEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const [preview, setPreview] = useState<NativeHistoryEntry>();
  const checkedSavedId = useRef(false);
  const ref = preview || p.task?.nativeSession;
  const identity = ref ? nativeKey(ref) : '';
  useEffect(() => { setDirectory(''); setListing(undefined); }, [p.cwd]);
  useEffect(() => {
    const request = ++generation.current;
    setError(''); setPrompts(undefined); setBusy(false);
    const valid = () => generation.current === request;
    if (p.tab === 'files') {
      setListing(undefined);
      void window.electronAPI?.listProjectFiles?.(p.cwd, directory, hidden).then(x => { if (valid()) setListing(x); }).catch(e => { if (valid()) setError(String(e)); });
    }
    if (p.tab === 'prompts' && ref) {
      void window.electronAPI?.readPromptHistory?.(ref).then(x => { if (valid()) setPrompts(x); }).catch(e => { if (valid()) setError(String(e)); });
    }
    if (p.tab === 'history' || p.tab === 'connections') {
      setHistory([]);
      void window.electronAPI?.listNativeSessions?.().then(async entries => {
        if (!valid()) return;
        setHistory(entries);
        if (p.tab !== 'history' || checkedSavedId.current || !p.task || !['codex', 'agy'].includes(p.task.groupId) || p.task.accountId || p.task.nativeSession || !p.task.historyId) return;
        checkedSavedId.current = true;
        const savedTask = p.task;
        const exact = entries.find(entry => entry.tool === savedTask.groupId && entry.id === savedTask.historyId && folderKey(entry.cwd) === folderKey(savedTask.cwd))
          || (savedTask.groupId === 'codex' ? await window.electronAPI?.savedCodexRef?.(savedTask.historyId!, savedTask.cwd) : undefined);
        if (valid() && exact) { setPreview(exact); p.onTab('prompts'); }
      }).catch(e => { if (valid()) setError(String(e)); });
    }
    return () => { generation.current++; };
  }, [p.cwd, p.task?.id, identity, p.tab, directory, hidden, reload]);
  const assistant = ref?.tool === 'agy' ? 'Antigravity' : ref?.tool === 'kimi' ? 'Kimi' : 'Codex';
  const older = async () => {
    if (!ref || !prompts?.next || busy) return;
    const request = generation.current; setBusy(true);
    try {
      const page = await window.electronAPI.readPromptHistory?.(ref, prompts.next);
      if (generation.current === request && page) {
        if (page.error) setError(page.error);
        else setPrompts(prev => ({ ...page, items: [...(prev?.items || []), ...page.items] }));
      }
    } catch (e) { if (generation.current === request) setError(String(e)); }
    finally { if (generation.current === request) setBusy(false); }
  };
  const act = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); try { await fn(); } catch(e) { setError(String(e)); } finally { setBusy(false); } };
  const copy = (text: string) => { void window.electronAPI?.writeClipboardText?.(text); };
  const titles: Record<WorkbenchTab, string> = { files: t('项目文件'), prompts: t('提示词历史'), history: t('恢复会话'), connections: t('工具连接') };
  const tabIcons: Record<WorkbenchTab, React.ReactNode> = {
    files: <FolderOpen size={14} />, prompts: <MessageSquareText size={14} />, history: <History size={14} />, connections: <Link2 size={14} />,
  };
  return <aside className="workbench-panel flex min-h-0 shrink-0 flex-col border-l border-line bg-surface text-ui" aria-label={t('工作台辅助面板')}>
    <div className="workbench-panel-tabs flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2 py-2">
      {(Object.keys(titles) as WorkbenchTab[]).map(tab => <button key={tab} title={titles[tab]} aria-label={titles[tab]} aria-pressed={p.tab === tab} className={`workbench-panel-tab ${p.tab === tab ? 'is-active' : ''}`} onClick={() => p.onTab(tab)}>{tabIcons[tab]}<span>{titles[tab]}</span></button>)}
      <button className="icon-btn ml-auto h-7 w-7" onClick={p.onClose} title={t('关闭')} aria-label={t('关闭')}><X size={15} /></button>
    </div>
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Folder size={14} className="shrink-0 text-fg-faint" />
        <span className="truncate text-xs font-medium text-fg-muted" title={p.cwd}>{p.task?.title || p.cwd || t('请先添加项目')}</span>
      </div>
      <button className="icon-btn h-7 w-7" title={t('刷新')} aria-label={t('刷新')} onClick={() => setReload(x => x + 1)}><RefreshCw size={14} /></button>
    </div>
    {p.mainConversation && p.tab === 'prompts' && ref ? <>
      {error && <p role="alert">{error}</p>}
      <ConversationReader assistant={assistant} key={identity} page={prompts} busy={busy} older={older}
        resume={() => void act(() => p.onRestore(ref, preview?.title || p.task!.title, p.task?.id))}
        link={preview && !p.task?.nativeSession && !p.task?.accountId && p.task?.groupId === preview.tool && folderKey(p.cwd) === folderKey(preview.cwd) && (!p.task.historyId || p.task.historyId === preview.id) ? () => void act(() => p.onBind(preview)) : undefined}/>
    </> : <div className="workbench-panel-body min-h-0 flex-1 overflow-auto px-3 py-3">
      {error && <p role="alert" className="workbench-notice text-danger">{error}</p>}
      {p.tab === 'files' && <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <button className="btn-secondary workbench-small-btn" onClick={() => setDirectory('')}><FolderOpen size={13} />{t('项目根目录')}</button>
          <button className="icon-btn h-7 w-7 border border-line bg-canvas" title={t('上级目录')} aria-label={t('上级目录')} disabled={!directory} onClick={() => setDirectory(directory.split(/[\\/]/).slice(0, -1).join('/'))}><ChevronLeft size={14} /></button>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-fg-subtle"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />{t('显示隐藏文件')}</label>
        </div>
        <p className="workbench-path" title={directory || '/'}>{directory || '/'}</p>
        {listing?.error && <p role="alert" className="workbench-notice text-danger">{listing.error}</p>}
        {!listing && <p className="workbench-muted">{t('加载中…')}</p>}
        {listing?.partial && <p className="workbench-notice text-warning">{t('列表已截断，请缩小目录范围')}</p>}
        <div className="workbench-file-list">
          {listing?.entries.map(entry => <div key={entry.path} className="workbench-file-row group">
            <button disabled={entry.link} className="flex min-w-0 flex-1 items-center gap-2 truncate px-2 py-1.5 text-left text-fg-muted hover:text-fg disabled:opacity-40" title={entry.path} onClick={() => entry.directory ? setDirectory(entry.path) : p.onPreview(entry.path)}>
              {entry.directory ? <Folder size={14} className="shrink-0 text-fg-faint" /> : <FileText size={14} className="shrink-0 text-fg-faint" />}<span className="truncate">{entry.name}{entry.link ? ' ↗' : ''}</span>
            </button>
            <button className="icon-btn mr-1 h-6 w-6 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" title={t('复制路径')} aria-label={t('复制路径')} onClick={() => copy(`${p.cwd.replace(/[\\/]$/, '')}\\${entry.path}`)}><Copy size={12} /></button>
          </div>)}
        </div>
        <p className="workbench-muted border-t border-line/60 pt-3">{t('只读预览；链接不跟随；浏览不会改变终端目录。')}</p>
      </div>}
      {p.tab === 'prompts' && <div className="space-y-3">
        {!ref ? <p className="workbench-empty-copy">{t('会话身份未确认。请在恢复会话中明确关联，或从历史恢复。')}</p> : <>
          <div className="workbench-context-card">
            <p className="break-all font-mono text-xs text-fg-muted">{ref.tool} · {ref.id}</p>
            <p className="workbench-muted mt-2">{prompts?.conversation ? t('会话消息（从新到旧）') : t('仅显示原生记录中的用户输入；不是完整聊天。')}</p>
          </div>
          {prompts?.error && <p role="alert" className="workbench-notice text-danger">{prompts.error}</p>}
          {preview && <button className="btn-secondary workbench-small-btn" disabled={busy} onClick={() => void act(() => p.onRestore(preview, preview.title))}>{t('恢复为新任务')}</button>}
          {!prompts && <p className="workbench-muted">{t('加载中…')}</p>}
          {prompts?.items.map((item, i) => <details key={`${identity}:${i}`} className="workbench-disclosure"><summary className="cursor-pointer break-words px-3 py-2.5 text-fg-muted">{item.role && <b>{item.role === 'assistant' ? assistant : t('你')} · </b>}{item.text.slice(0, 100)}</summary><div className="border-t border-line/60 px-3 pb-3"><pre className="mt-3 select-text whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-fg-subtle">{item.text}</pre>{item.truncated && <p className="workbench-muted mt-2">{t('内容已截断')}</p>}<button className="btn-secondary workbench-small-btn mt-3" onClick={() => copy(item.text)}><Copy size={12} />{t('复制')}</button></div></details>)}
          {prompts && !prompts.items.length && !prompts.error && <p className="workbench-empty-copy">{prompts.conversation ? t('本页没有对话消息') : t('暂无可读取的用户输入')}</p>}
          {prompts?.partial && <p className="workbench-muted">{t('有界读取，超大或不支持的记录可能未显示。')}</p>}
          {prompts?.next && <button className="btn-secondary workbench-small-btn" disabled={busy} onClick={() => void older()}>{prompts.conversation ? t('加载更早消息') : t('加载更早输入')}</button>}
        </>}
      </div>}
      {p.tab === 'history' && <div className="space-y-3">
        {p.mainConversation && <h2 className="text-base font-semibold">{t('选择对应会话')}</h2>}
        {p.task?.groupId === 'codex' && <button className="btn-secondary workbench-small-btn" disabled={busy}
          onClick={() => void act(p.onCodexPicker)}>{t('打开 Codex 原生会话选择器')}</button>}
        <div className="relative"><Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-fg-faint" /><input className="input workbench-search" placeholder={t('搜索会话编号、标题或目录')} value={filter} onChange={e => setFilter(e.target.value)} /></div>
        <p className="workbench-muted">{t('默认账号的 Codex、Kimi 和 Antigravity 历史，最多显示 400 条。')}</p>
        <div className="space-y-2">
          {history.filter(entry => (!p.mainConversation || entry.tool === p.task?.groupId) && `${entry.title} ${entry.id} ${entry.cwd}`.toLowerCase().includes(filter.toLowerCase())).map(entry => <div key={nativeKey(entry)} className="workbench-card">
            <div className="flex items-start gap-2"><BrandIcon icon={entry.tool} size={16} /><p className="min-w-0 flex-1 break-words font-medium leading-5 text-fg-muted">{entry.title}{entry.tool === 'agy' && (/antigravity-cli[\\/]?$/i.test(entry.storageRoot) ? ' · CLI' : ' · Desktop')}</p></div>
            <p className="mt-2 break-all font-mono text-2xs leading-relaxed text-fg-faint">{entry.id}<br /><span className="font-sans">{entry.cwd}</span></p>
            <div className="mt-3 flex flex-wrap gap-2">
              {entry.tool !== 'kimi' && <button className="btn-secondary workbench-small-btn" onClick={() => { setPreview(entry); p.onTab('prompts'); }}>{t('查看对话')}</button>}
              <button className="btn-secondary workbench-small-btn" disabled={busy} onClick={() => void act(() => p.onRestore(entry, entry.title))}>{t('恢复为新任务')}</button>
              {p.task && !p.task.nativeSession && !p.task.accountId && p.task.groupId === entry.tool && folderKey(p.task.cwd) === folderKey(entry.cwd) && (!p.task.historyId || p.task.historyId === entry.id) && <button className="btn-secondary workbench-small-btn" disabled={busy} onClick={() => { setPreview(undefined); void act(() => p.onBind(entry)); }}>{['stopped','error'].includes(p.task.status) ? t('关联到此任务') : t('关联当前终端')}</button>}
            </div>
          </div>)}
        </div>
        {!history.length && <p className="workbench-empty-copy">{t('没有可用记录；可在 Shell 使用工具自带的会话选择器。')}</p>}
        {p.closed.length > 0 && <details className="workbench-disclosure"><summary className="cursor-pointer px-3 py-2.5 text-fg-muted">{t('已关闭的本地任务')} ({p.closed.length})</summary><div className="space-y-2 border-t border-line/60 p-2">{p.closed.map(task => <div key={task.id} className="rounded-md bg-canvas p-2.5"><p className="text-fg-muted">{task.title}</p><p className="workbench-muted mt-1 break-all">{task.cwd}</p>{task.nativeSession ? <button className="btn-secondary workbench-small-btn mt-2" onClick={() => void act(() => p.onRestore(task.nativeSession!, task.title, task.id))}>{t('恢复为新任务')}</button> : <p className="workbench-muted mt-2">{t('身份未确认，原任务记录保留。请打开 Shell 或工具原生选择器。')}</p>}</div>)}</div></details>}
      </div>}
      {p.tab === 'connections' && <div className="space-y-3">
        <div className="workbench-card space-y-2">
          <div className="flex items-center gap-2"><BrandIcon icon="agy" size={16} /><b>Antigravity</b><span className="text-xs text-fg-muted">{p.antigravity?.version}</span></div>
          <p>{!p.antigravity ? t('检测中…') : p.antigravity.installed ? t('桌面应用已检测到') : t('未找到 Antigravity 桌面应用')}</p>
          {p.antigravity?.error && <p role="alert">{p.antigravity.error}</p>}
          <p className="workbench-muted break-all">{p.antigravity?.executable}</p>
          <p className="workbench-muted">{t('项目需在桌面端选择；登录、额度和会话连接尚未验证。')}</p>
          <div className="flex flex-wrap gap-2"><button className="btn-secondary workbench-small-btn" disabled={!p.antigravity?.installed || p.desktopBusy} onClick={p.onOpenAntigravity}>{t('复制路径并打开')}</button><button className="btn-secondary workbench-small-btn" onClick={p.onRefreshAntigravity}>{t('重新检测')}</button></div>
        </div>
        {['kimi', 'codex'].map(tool => <div key={tool} className="workbench-card">
          <div className="flex items-center gap-2.5"><BrandIcon icon={tool} size={18} /><b className="font-medium text-fg">{tool === 'kimi' ? 'Kimi' : 'Codex'}</b><span className={`ml-auto h-1.5 w-1.5 rounded-full ${p.installed?.[tool] ? 'bg-success' : 'bg-fg-faint'}`} /></div>
          <p className="mt-3 text-fg-muted">{p.installed === null ? t('检测中…') : p.installed[tool] ? t('命令已检测到') : t('未检测到命令')}</p>
          <p className="workbench-muted mt-1.5">{t('事件接入未检查；登录与实时会话未验证。')}</p>
        </div>)}
        <p className="workbench-muted">{t('当前使用只读历史关联。安装不会修改工具配置；需要事件接入时，先审阅具体文件与变更。')}</p>
        <label className="workbench-setting"><input type="checkbox" checked={p.restoreWorkspace} onChange={e => p.onRecoveryChange(e.target.checked)} /><span>{t('启动时显示工作区恢复检查')}</span></label>
        <p className="workbench-muted">{t('恢复前逐项确认原进程已关闭。未知身份、缺目录或已占用的会话不会自动启动。')}</p>
      </div>}
    </div>}
  </aside>;
}
