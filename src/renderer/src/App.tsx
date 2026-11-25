import { resumeCommand } from '../../shared/workbench';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { PanelRightClose, PanelRightOpen, Plus } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { TerminalViewport, TerminalViewportRef } from './components/TerminalViewport';
import { NewTaskModal } from './components/NewTaskModal';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingModal } from './components/OnboardingModal';
import { WorkbenchPanel, WorkbenchTab } from './components/WorkbenchPanel';
import { AntigravityDesktopInfo, CodexPayloadInfo, CodexPayloadRequest, NativeHistoryEntry, NativeSessionRef, nativeKey } from '../../shared/workbench';
import { UsageModal } from './components/UsageModal';
import { FilePreviewPanel } from './components/FilePreviewPanel';
import { Modal } from './components/Modal';
import { ConfirmDialog, ConfirmOptions } from './components/ConfirmDialog';
import { BrandIcon } from './components/BrandIcon';
import { AppLogo } from './components/AppLogo';
import { CliDef, CustomCli, FolderEntry, TaskSession, QuotaData, AppSettings, ThemeId, HistoryEntry, Account } from './types';
import { BUILTIN_CLIS } from './clis';
import { SUMMARY_CLIS, formatAgo } from './taskSummary';
import { ensureFolder, folderKey, folderName, groupRecent, loadAppState, moveBefore, nextTaskTitle, orderedTasks, saveAppState, tasksInFolder } from './workspaceState';
import { accountCli, quotaKey, sanitizeAccounts, toSessionAccount } from './accounts';
import { sanitizeCustomClis, toCliDef } from './customClis';
import { getLanguage, isLanguage, setLanguage, systemLanguage, t } from './i18n';
import { THEME_MODE } from './themes';
import { isTaskAlive } from './taskStatus';

const DEFAULT_SETTINGS: AppSettings = {
  language: systemLanguage(),
  onboardingDone: false,
  theme: 'system',
  workReminderEnabled: false,
  voiceReminderEnabled: true,
  workReminderHours: 1,
  terminalFontSize: 15,
  terminalLineHeight: 1.3,
  uiScale: 'comfortable',
  terminalCursorStyle: 'bar',
  terminalCursorBlink: true,
  previewMinimap: true,
  restoreWorkspace: false,
  clockOffsetHours: 0,
  topbarDateVisible: true,
  accounts: [],
  customClis: [],
};

const workReminderText = (hours: number) => t('您已经工作 {n} 小时了，该休息一下了。', { n: hours });
const IDLE_AFTER_MS = 10_000;

// 启动结果转为任务状态，失败时保留原因供侧栏与终端区显示
function startOutcome(result?: { success: boolean; error?: string }): Pick<TaskSession, 'status' | 'errorMessage'> {
  return result?.success ? { status: 'running', errorMessage: undefined } : { status: 'error', errorMessage: result?.error || t('终端启动失败') };
}

function loadSavedSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('onedesktop_settings');
    if (raw) {
      const saved = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...saved, accounts: sanitizeAccounts(saved?.accounts), customClis: sanitizeCustomClis(saved?.customClis), workReminderEnabled: saved?.workReminderEnabled === true, language: isLanguage(saved?.language) ? saved.language : systemLanguage(), onboardingDone: saved?.onboardingDone === true };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

type DetectedCli = { id: string; name: string; command: string };

// 已检测到、但不在内置列表里的 CLI（如 Antigravity、Pi），自动补成可新建任务的 CLI
// 用户自定义的 CLI 也会出现在检测结果里，但它们来自设置，不能当作自动检测到的 CLI 保存进状态
function mergeDetectedExtras(current: CliDef[], detected: DetectedCli[], custom: CustomCli[]): CliDef[] {
  const extras = detected
    .filter((cli) => !BUILTIN_CLIS.some((builtin) => builtin.id === cli.id) && !current.some((item) => item.id === cli.id) && !custom.some((item) => item.id === cli.id))
    .map((cli): CliDef => ({ id: cli.id, name: cli.name, icon: cli.id, defaultCommand: cli.command }));
  return extras.length ? [...current, ...extras] : current;
}

// 启动时读取已保存的状态（旧的各工作区数据在首次启动时迁移）
const INITIAL_STATE = loadAppState();

const toolbarClis = ['terminal', 'kimi', 'codex', 'agy'];

export const App: React.FC = () => {
  const [tasks, setTasks] = useState<TaskSession[]>(INITIAL_STATE.tasks);
  const [folders, setFolders] = useState<FolderEntry[]>(INITIAL_STATE.folders);
  const [lastFolder, setLastFolder] = useState(INITIAL_STATE.lastFolder);
  const [extraClis, setExtraClis] = useState<CliDef[]>(INITIAL_STATE.extraClis);
  const reorderFolder = useCallback((sourcePath: string, targetPath: string) => {
    setFolders((current) => moveBefore(current, (folder) => folderKey(folder.path), folderKey(sourcePath), folderKey(targetPath)));
  }, []);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(INITIAL_STATE.activeTaskId);
  // 任务只能在所属文件夹内调整顺序
  const reorderTask = useCallback((sourceId: string, targetId: string) => {
    setTasks((current) => {
      const source = current.find((task) => task.id === sourceId);
      const target = current.find((task) => task.id === targetId);
      if (!source || !target || folderKey(source.cwd) !== folderKey(target.cwd)) return current;
      return moveBefore(current, (task) => task.id, sourceId, targetId);
    });
  }, []);
  // 待查看：后台任务输出停下或进程退出后，在侧栏标记，切换过去查看后清除（不持久化）
  const [unreadTaskIds, setUnreadTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const activeTaskIdRef = useRef(activeTaskId);
  activeTaskIdRef.current = activeTaskId;
  const markUnread = useCallback((ids: string[]) => {
    const background = ids.filter((id) => id !== activeTaskIdRef.current);
    if (background.length === 0) return;
    setUnreadTaskIds((prev) => (background.every((id) => prev.has(id)) ? prev : new Set([...prev, ...background])));
  }, []);
  useEffect(() => {
    if (!activeTaskId || !unreadTaskIds.has(activeTaskId)) return;
    setUnreadTaskIds((prev) => {
      const next = new Set(prev);
      next.delete(activeTaskId);
      return next;
    });
  }, [activeTaskId, unreadTaskIds]);
  const [quotas, setQuotas] = useState<Record<string, QuotaData>>({});
  const [workReminderVisible, setWorkReminderVisible] = useState(false);
  const terminalViewportRef = useRef<TerminalViewportRef>(null);
  // 应用内确认 / 通知弹窗：askConfirm 返回用户的选择
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const askConfirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    confirmResolveRef.current?.(false);
    confirmResolveRef.current = resolve;
    setConfirmOptions(options);
  }), []);
  const resolveConfirm = (confirmed: boolean) => {
    confirmResolveRef.current?.(confirmed);
    confirmResolveRef.current = null;
    setConfirmOptions(null);
  };
  const notify = useCallback((title: string, message: string) => askConfirm({ title, message, notice: true, confirmLabel: t('知道了') }), [askConfirm]);

  // 关闭窗口时仍有终端进程在运行：先确认，再通知主进程真正关闭
  useEffect(() => window.electronAPI?.onWindowCloseRequest?.(async (aliveCount) => {
    if (await askConfirm({
      title: t('关闭 OneTerm'),
      message: t('还有 {n} 个终端进程在运行，关闭窗口会全部终止。', { n: aliveCount }),
      confirmLabel: t('关闭并终止'),
      danger: true,
    })) window.electronAPI?.confirmWindowClose?.();
    else window.electronAPI?.cancelWindowClose?.();
  }), [askConfirm]);
  // 字体与外观设置状态（自动持久化到 localStorage）
  const [settings, setSettings] = useState<AppSettings>(loadSavedSettings);
  // 先于子组件渲染切换界面语言，t() 才能在本次渲染里取到新语言的译文
  setLanguage(settings.language);
  // 任务启动：按任务绑定的账号注入配置目录；账号配置已被删除时拒绝启动，避免悄悄回落到默认账号
  const accountsRef = useRef(settings.accounts);
  accountsRef.current = settings.accounts;
  const startSession = useCallback((task: TaskSession, cli: Pick<CliDef, 'defaultCommand' | 'custom'>) => {
    const account = task.accountId ? accountsRef.current.find((item) => item.id === task.accountId) : undefined;
    if (task.accountId && !account) {
      return Promise.resolve({ success: false, error: t('该任务使用的账号配置已被删除。请关闭任务后重新新建，或在「设置 → 账号」中重新添加该账号。') });
    }
    return window.electronAPI.createSession({
      id: task.id,
      nativeSession: task.nativeSession,
      command: task.command || cli.defaultCommand,
      cwd: task.cwd,
      shell: cli.custom,
      account: account && toSessionAccount(account),
    });
  }, []);
  useEffect(() => {
    void window.electronAPI?.setQuotaAccounts?.(settings.accounts.map((a) => ({ key: a.id, cliId: a.cliId, configDir: a.configDir })));
  }, [settings.accounts]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const extraClisRef = useRef(extraClis);
  extraClisRef.current = extraClis;
  const customClisRef = useRef(settings.customClis);
  customClisRef.current = settings.customClis;
  const voiceReminderEnabledRef = useRef(settings.voiceReminderEnabled);
  voiceReminderEnabledRef.current = settings.voiceReminderEnabled;

  const workReminderHours = Number.isFinite(settings.workReminderHours) ? Math.max(1, Math.min(12, Math.trunc(settings.workReminderHours))) : 1;

  // 默认关闭工作时长提醒；手动开启后从开启时刻起算，每满设定的小时数提醒一次（第 N 次提醒时已工作 N × 设定小时）；改动时长后按新间隔排到下一个整倍数时刻，不补弹
  const workReminderStartedAtRef = useRef<number | null>(null);
  const [workedHours, setWorkedHours] = useState(workReminderHours);
  useEffect(() => {
    if (!settings.workReminderEnabled) {
      workReminderStartedAtRef.current = null;
      setWorkReminderVisible(false);
      return;
    }
    if (workReminderStartedAtRef.current === null) {
      workReminderStartedAtRef.current = Date.now();
    }
    const startedAt = workReminderStartedAtRef.current;
    const interval = workReminderHours * 60 * 60 * 1000;
    let timer = 0;
    const schedule = () => {
      const elapsed = Math.max(0, Date.now() - startedAt);
      const nextCount = Math.floor(elapsed / interval) + 1;
      timer = window.setTimeout(() => {
        const hours = nextCount * workReminderHours;
        setWorkedHours(hours);
        setWorkReminderVisible(true);
        if (voiceReminderEnabledRef.current && 'speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(workReminderText(hours));
          utterance.lang = getLanguage() === 'en' ? 'en-US' : 'zh-CN';
          window.speechSynthesis.speak(utterance);
        }
        schedule();
      }, Math.max(0, startedAt + nextCount * interval - Date.now()));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [settings.workReminderEnabled, workReminderHours]);

  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const resolvedTheme: ThemeId = settings.theme === 'system'
    ? (systemPrefersDark ? 'dark' : 'light')
    : (settings.theme in THEME_MODE ? settings.theme : 'dark');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemPrefersDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = THEME_MODE[resolvedTheme];
  }, [resolvedTheme]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<WorkbenchTab>('files');
  const [panelOpen, setPanelOpen] = useState(false);
  const [antigravity, setAntigravity] = useState<AntigravityDesktopInfo | null>(null);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const desktopLock = useRef(false);
  const refreshAntigravity = useCallback(async () => {
    try { setAntigravity(await window.electronAPI?.detectAntigravityDesktop?.() || { installed: false, projectOpen: 'manual' }); }
    catch { setAntigravity({ installed: false, projectOpen: 'manual', error: t('桌面应用检测失败，请重试') }); }
  }, []);
  useEffect(() => { void refreshAntigravity(); }, [refreshAntigravity]);
  useEffect(() => { if (isHistoryOpen) { setPanelTab('history'); setPanelOpen(true); setIsHistoryOpen(false); } }, [isHistoryOpen]);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [filePreview, setFilePreview] = useState<{ cwd: string; path: string; line?: number; openedAt: number } | null>(null);
  const [previewWidth, setPreviewWidth] = useState(420);
  // null 表示尚未检测完成（或非 Electron 预览），此时显示全部分组
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null);
  const customClis = settings.customClis;
  const allClis = useMemo(() => [...BUILTIN_CLIS, ...extraClis, ...customClis.map(toCliDef)], [extraClis, customClis]);
  const visibleClis = useMemo(
    () => installed ? allClis.filter((cli) => cli.id === 'terminal' || installed[cli.id]) : allClis,
    [allClis, installed],
  );
  // 未安装 CLI 的任务不在侧栏显示，也不参与 Ctrl+Tab / Ctrl+数字
  const visibleTasks = useMemo(() => {
    const ids = new Set(visibleClis.map((cli) => cli.id));
    return tasks.filter((task) => !task.closedAt && (ids.has(task.groupId) || task.nativeSession));
  }, [tasks, visibleClis]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('oneai_sidebar_collapsed') === 'true'; } catch { return false; }
  });

  // 弹窗状态
  const [newTaskContext, setNewTaskContext] = useState<{ folderPath: string; cliId?: string } | null>(null);
  const isNewTaskOpen = newTaskContext !== null;

  // 动态应用全局 UI 界面缩放比例
  useEffect(() => {
    const scaleMap: Record<AppSettings['uiScale'], string> = {
      compact: '14.5px',      // 90%
      standard: '16px',       // 100%
      comfortable: '17.5px',  // 110% (推荐默认)
      large: '20px',          // 125%
    };
    document.documentElement.style.fontSize = scaleMap[settings.uiScale] || '17.5px';
    try {
      localStorage.setItem('onedesktop_settings', JSON.stringify(settings));
    } catch {}
  }, [settings]);

  useEffect(() => {
    saveAppState({ tasks, folders, activeTaskId, lastFolder, extraClis });
  }, [tasks, folders, activeTaskId, lastFolder, extraClis]);

  useEffect(() => {
    try { localStorage.setItem('oneai_sidebar_collapsed', String(isSidebarCollapsed)); } catch {}
  }, [isSidebarCollapsed]);

  // 全局快捷键缩放终端字体（Ctrl + / Ctrl - / Ctrl 0）。在捕获阶段处理并阻止继续传播：
  // 冒泡阶段时 xterm 已把 Ctrl+- 转成 \x1f（Ctrl+_，多数 CLI 的「撤销」）发给 CLI。排除 Alt，避免 AltGr 组合被误判
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['=', '+', '-', '0'].includes(e.key)) e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setSettings((prev) => ({
            ...prev,
            terminalFontSize: Math.min(24, prev.terminalFontSize + 1),
          }));
        } else if (e.key === '-') {
          e.preventDefault();
          setSettings((prev) => ({
            ...prev,
            terminalFontSize: Math.max(12, prev.terminalFontSize - 1),
          }));
        } else if (e.key === '0') {
          e.preventDefault();
          setSettings((prev) => ({
            ...prev,
            terminalFontSize: 15,
          }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const allTasks = tasks;

  // 当前激活的任务与对应的 CLI
  const activeTask = useMemo(() => {
    return tasks.find((t) => t.id === activeTaskId) || null;
  }, [tasks, activeTaskId]);

  const mainConversation = panelOpen && !!activeTask && ['codex', 'agy'].includes(activeTask.groupId) && !activeTask.accountId && !isTaskAlive(activeTask.status) && (panelTab === 'prompts' || panelTab === 'history');
  const currentGroup = useMemo(() => {
    if (!activeTask) return null;
    return allClis.find((cli) => cli.id === activeTask.groupId) || null;
  }, [allClis, activeTask]);

  // 没有活动任务时，新建任务默认使用的文件夹
  const workspacePath = activeTask?.cwd ?? lastFolder;
  useEffect(() => {
    if (activeTask) setLastFolder(activeTask.cwd);
  }, [activeTask?.cwd]);

  const openAntigravity = async () => {
    if (desktopLock.current) return;
    desktopLock.current = true; setDesktopBusy(true);
    try {
      if (!await askConfirm({ title: t('打开 Antigravity 桌面端'), message: t('将复制项目目录 {cwd} 并打开 Antigravity。请在桌面端选择或添加该目录；本次不会自动打开项目或创建会话。', { cwd: workspacePath }), confirmLabel: t('复制路径并打开') })) return;
      const result = await window.electronAPI?.openAntigravityDesktop?.(workspacePath);
      await notify(result?.success ? t('已发送桌面启动请求') : t('无法启动桌面应用'), result?.success ? t('项目路径已复制。请在 Antigravity 中选择或添加该目录；会话与额度仍未接通。') : result?.error || t('未找到 Antigravity 桌面应用'));
      await refreshAntigravity();
    } finally { desktopLock.current = false; setDesktopBusy(false); }
  };

  // 当前选中 CLI 对应的实时配额
  const currentQuota = useMemo(() => {
    if (!currentGroup) return null;
    return quotas[quotaKey(currentGroup.id, activeTask?.accountId)] || null;
  }, [quotas, currentGroup, activeTask?.accountId]);

  // 初始化拉取各 CLI 真实配额与订阅后台推送
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAllQuotas().then((all) => {
        if (all) setQuotas(all);
      });
      // 主进程每次刷新都会推送（Claude statusLine 快照一更新就推），多数时候只有 lastUpdated 变化；
      // 内容未变时保留原对象，避免整个界面重渲染
      const contentKey = (all: Record<string, QuotaData>) => JSON.stringify(all, (key, value) => (key === 'lastUpdated' ? undefined : value));
      const unsub = window.electronAPI.onQuotaUpdate((updatedQuotas) => {
        if (!updatedQuotas) return;
        setQuotas((prev) => (contentKey(prev) === contentKey(updatedQuotas) ? prev : updatedQuotas));
      });
      return () => unsub();
    } else {
      // 浏览器独立预览调试降级数据
      setQuotas({
        kimi: {
          cliId: 'kimi',
          cliName: 'Kimi Code',
          model: 'Kimi Coding',
          planType: 'Kimi Coding',
          fiveHourPercent: 100,
          fiveHourResetsIn: '4h 12m',
          sevenDayPercent: 12,
          sevenDayResetsOn: 'Resets Wed',
          lastUpdated: Date.now(),
          status: 'normal',
        },
        codex: {
          cliId: 'codex',
          cliName: 'Codex',
          model: 'Codex',
          planType: 'Plus',
          fiveHourPercent: 100,
          fiveHourResetsIn: '--',
          sevenDayPercent: 100,
          sevenDayResetsOn: '--',
          lastUpdated: Date.now(),
          status: 'normal',
        },
        claude: {
          cliId: 'claude',
          cliName: 'Claude Code',
          model: 'Claude Code',
          planType: 'Pro',
          fiveHourPercent: 100,
          fiveHourResetsIn: '--',
          sevenDayPercent: 100,
          sevenDayResetsOn: '--',
          lastUpdated: Date.now(),
          status: 'normal',
        },
        opencode: {
          cliId: 'opencode',
          cliName: 'OpenCode',
          model: 'Auto',
          fiveHourPercent: 0,
          fiveHourResetsIn: '--',
          sevenDayPercent: 0,
          sevenDayResetsOn: '--',
          lastUpdated: Date.now(),
          status: 'offline',
          message: t('未检测到本地配置'),
        },
        grok: {
          cliId: 'grok',
          cliName: 'Grok Build',
          model: 'Grok',
          planType: 'xAI Premium',
          fiveHourPercent: 100,
          fiveHourResetsIn: '--',
          sevenDayPercent: 100,
          sevenDayResetsOn: '--',
          lastUpdated: Date.now(),
          status: 'normal',
        },
      });
    }
  }, []);

  // 为初始化任务在 Electron 主进程创建真实 CLI 终端 PTY
  useEffect(() => {
    if (window.electronAPI) {
      let disposed = false;
      // 先按 PATH 检测已安装的 CLI，再为初始任务创建 PTY；未安装 CLI 的分组不显示
      window.electronAPI.detectClis(customClisRef.current.map(({ id, command }) => ({ id, command }))).catch(() => null).then((list) => {
        if (disposed) return;
        const detected = list ? Object.fromEntries(list.map((cli) => [cli.id, true])) : null;
        setInstalled(detected);
        if (list) setExtraClis((prev) => mergeDetectedExtras(prev, list, customClisRef.current));
        const isVisibleCli = (id: string) => id === 'terminal' || !detected || Boolean(detected[id]);
        const candidates = tasksRef.current.filter((task) => !task.closedAt && isVisibleCli(task.groupId));
        const initialTask = candidates.find((task) => task.id === activeTaskId) || candidates[0];
        const initialCli = initialTask && (
          [...BUILTIN_CLIS, ...extraClisRef.current, ...customClisRef.current.map(toCliDef)].find((cli) => cli.id === initialTask.groupId)
          ?? list?.map((cli) => ({ defaultCommand: cli.command, id: cli.id })).find((cli) => cli.id === initialTask.groupId)
        );
        if (initialTask && initialCli) setActiveTaskId(initialTask.id);
        if (initialTask && ['codex', 'agy'].includes(initialTask.groupId) && !initialTask.accountId && !isTaskAlive(initialTask.status)) {
          setPanelTab(initialTask.nativeSession ? 'prompts' : 'history'); setPanelOpen(true);
        } else if (settings.restoreWorkspace && candidates.length) { setPanelTab('history'); setPanelOpen(true); }

      });

      // 监听终端进程退出事件，将对应任务状态翻转为 'stopped'
      const unsub = window.electronAPI.onSessionExit(({ id }) => {
        const exited = tasksRef.current.find((t) => t.id === id);
        if (exited && isTaskAlive(exited.status)) markUnread([id]);
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'stopped' } : t)));
      });
      return () => { disposed = true; unsub(); };
    }
  }, []);

  // 历史会话：启动后稍等再读（避开启动高峰），之后每 2 分钟刷新；「最近任务」由它按文件夹归类
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    const list = window.electronAPI?.listNativeSessions;
    if (!list) return;
    let disposed = false;
    const refresh = () => {
      void list().then((entries) => { if (!disposed && Array.isArray(entries)) setHistory(entries.map(entry => ({ ...entry, cliId: entry.tool, command: resumeCommand(entry) }))); }).catch(() => {});
    };
    const first = window.setTimeout(refresh, 1500);
    const timer = window.setInterval(refresh, 120_000);
    return () => { disposed = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  const recentFolders = useMemo(() => {
    const cliIds = new Set(visibleClis.map((cli) => cli.id));
    return groupRecent(history.filter((entry) => cliIds.has(entry.cliId)), new Set(folders.map((folder) => folderKey(folder.path))));
  }, [history, visibleClis, folders]);

  // Git 分支：只读 .git/HEAD；文件夹列表变化、窗口获得焦点和每 30 秒刷新
  const [gitBranches, setGitBranches] = useState<Record<string, string | null>>({});
  const branchPathsKey = [...folders.map((folder) => folder.path), ...recentFolders.map((recent) => recent.path)].join('\n');
  useEffect(() => {
    const read = window.electronAPI?.getGitBranches;
    if (!read) return;
    const paths = branchPathsKey ? branchPathsKey.split('\n') : [];
    let disposed = false;
    const refresh = () => {
      void read(paths).then((result) => {
        if (disposed) return;
        const next: Record<string, string | null> = {};
        for (const [dir, branch] of Object.entries(result)) next[folderKey(dir)] = branch;
        setGitBranches((prev) => (Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([key, value]) => prev[key] === value) ? prev : next));
      }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [branchPathsKey]);

  // 原生标题栏已隐藏：把窗口控件覆盖层的底色、符号色和高度同步为顶栏的实际样式
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header || !window.electronAPI?.setTitleBarOverlay) return;
    {
      const toHex = (css: string) => {
        const m = css.match(/\d+(\.\d+)?/g);
        return m && m.length >= 3 ? `#${m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}` : null;
      };
      const color = toHex(getComputedStyle(header).backgroundColor);
      const symbolColor = toHex(getComputedStyle(header).color);
      if (color && symbolColor) window.electronAPI.setTitleBarOverlay({ color, symbolColor, height: Math.round(header.getBoundingClientRect().height) });
    }
  }, [resolvedTheme, settings.uiScale]);

  // 任务行第二行：任务对应会话里最近一条用户消息（仅 Claude / Codex / Kimi），每 5 秒与窗口获得焦点时刷新。
  // 使用账号的任务读该账号的配置目录；账号配置已被删除的任务不读，避免误取默认账号的会话
  const [summaries, setSummaries] = useState<Record<string, { text: string | null }>>({});
  const summaryTasks = useMemo(() => tasks
    .filter((task) => SUMMARY_CLIS.has(task.groupId) && !['codex', 'kimi', 'agy'].includes(task.groupId))
    .flatMap((task) => {
      const account = task.accountId ? settings.accounts.find((item) => item.id === task.accountId) : undefined;
      if (task.accountId && !account) return [];
      return [{ id: task.id, cliId: task.groupId, cwd: task.cwd, createdAt: task.createdAt, historyId: task.historyId, configDir: account?.configDir }];
    }), [tasks, settings.accounts]);
  const summaryKey = JSON.stringify(summaryTasks);
  useEffect(() => {
    const read = window.electronAPI?.getTaskSummaries;
    if (!read || summaryTasks.length === 0) return;
    let disposed = false;
    const refresh = () => {
      if (document.hidden) return;
      void read(summaryTasks).then((result) => {
        if (!disposed) setSummaries((prev) => (JSON.stringify(prev) === JSON.stringify(result) ? prev : result));
      }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [summaryKey]);

  const [codexPayloads, setCodexPayloads] = useState<Record<string, CodexPayloadInfo>>({});
  const codexPayloadTasks = useMemo<CodexPayloadRequest[]>(() => tasks
    .filter((task) => !task.closedAt && task.groupId === 'codex')
    .flatMap((task) => {
      const sessionId = task.nativeSession?.id || task.historyId;
      if (!sessionId) return [];
      const account = task.accountId ? settings.accounts.find((item) => item.id === task.accountId) : undefined;
      if (task.accountId && !account) return [];
      const storageRoot = task.nativeSession?.storageRoot || account?.configDir;
      return [{ taskId: task.id, sessionId, ...(storageRoot ? { storageRoot } : {}) }];
    }), [tasks, settings.accounts]);
  const codexPayloadKey = JSON.stringify(codexPayloadTasks);
  const refreshCodexPayloads = useCallback(async () => {
    const read = window.electronAPI?.getCodexPayloads;
    if (!read || codexPayloadTasks.length === 0) return;
    try {
      const result = await read(codexPayloadTasks);
      if (result) setCodexPayloads((prev) => (JSON.stringify(prev) === JSON.stringify(result) ? prev : result));
    } catch {}
  }, [codexPayloadKey]);
  useEffect(() => {
    if (codexPayloadTasks.length === 0) {
      setCodexPayloads((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const read = window.electronAPI?.getCodexPayloads;
    if (!read) return;
    let disposed = false;
    const refresh = () => {
      if (document.hidden) return;
      void read(codexPayloadTasks).then((result) => {
        if (!disposed && result) setCodexPayloads((prev) => (JSON.stringify(prev) === JSON.stringify(result) ? prev : result));
      }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [codexPayloadKey]);
  const activeCodexPayload = activeTask?.groupId === 'codex' ? codexPayloads[activeTask.id] : undefined;

  // 空闲检测：运行中的任务连续 IDLE_AFTER_MS 没有输出标为「空闲」，再有输出立即回到「运行中」。
  // 只能判断输出静默，无法区分「已完成」与「在等待确认」。
  useEffect(() => {
    if (!window.electronAPI?.onSessionData) return;
    const lastOutput = new Map<string, number>();
    const setStatus = (ids: string[], from: TaskSession['status'], to: TaskSession['status']) => {
      if (ids.length === 0) return;
      setTasks((prev) => prev.map((t) => ids.includes(t.id) && t.status === from ? { ...t, status: to } : t));
    };
    const unsub = window.electronAPI.onSessionData(({ id }) => {
      lastOutput.set(id, Date.now());
      const task = tasksRef.current.find((t) => t.id === id);
      if (task?.status === 'idle') setStatus([id], 'idle', 'running');
    });
    const timer = window.setInterval(() => {
      const now = Date.now();
      const idleIds = tasksRef.current
        .filter((t) => t.status === 'running' && now - (lastOutput.get(t.id) ?? now) > IDLE_AFTER_MS)
        .map((t) => t.id);
      // 尚无输出记录的任务从现在开始计时
      tasksRef.current.forEach((t) => { if (!lastOutput.has(t.id)) lastOutput.set(t.id, now); });
      setStatus(idleIds, 'running', 'idle');
      markUnread(idleIds);
    }, 2000);
    return () => { unsub?.(); window.clearInterval(timer); };
  }, []);

  // 折叠 / 展开文件夹
  const handleToggleFolder = (folderPath: string) => {
    setFolders((prev) => prev.map((folder) => (folderKey(folder.path) === folderKey(folderPath) ? { ...folder, isExpanded: !folder.isExpanded } : folder)));
  };

  // 选中具体某个子任务
  // startIfStopped 为 false 时只切换视图，不拉起已停止的任务（键盘轮换、关闭后接替）
  const handleSelectTask = (taskId: string, startIfStopped = false) => {
    const task = allTasks.find((item) => item.id === taskId);
    setActiveTaskId(taskId);
    if (task && ['codex', 'agy'].includes(task.groupId) && !task.accountId && !isTaskAlive(task.status)) {
      setPanelTab(task.nativeSession ? 'prompts' : 'history'); setPanelOpen(true);
    }
    // 保证该任务所在的文件夹处于展开状态
    if (task) setFolders((prev) => ensureFolder(prev, task.cwd, true));
    const cli = task && allClis.find((item) => item.id === task.groupId);
    // createSession 对已存在的 PTY 是幂等操作。每次选择都校验一次，避免界面状态
    // 与主进程真实会话脱节后，键盘输入被 writeSession 静默丢弃。
    if (window.electronAPI && task && cli && (startIfStopped || isTaskAlive(task.status))) {
      if (!isTaskAlive(task.status) || task.status === 'starting') {
        setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'starting' } : t));
      }
      startSession(task, cli).then((result) => {
        setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...startOutcome(result) } : t));
      }).catch(() => setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'error' } : t)));
    }
  };

  // 重新检测已安装的 CLI（含自定义 CLI）：新装了 CLI、增删自定义 CLI 后不必重启应用
  const redetectClis = useCallback(async () => {
    const list = await window.electronAPI?.detectClis(customClisRef.current.map(({ id, command }) => ({ id, command }))).catch(() => null);
    if (!list) return;
    setInstalled(Object.fromEntries(list.map((cli) => [cli.id, true])));
    setExtraClis((prev) => mergeDetectedExtras(prev, list, customClisRef.current));
  }, []);
  // 自定义 CLI 的 id 或命令变化后重新检测（首次检测由启动流程完成）
  const customClisKey = customClis.map((cli) => `${cli.id}\u0000${cli.command}`).join('\u0001');
  const customClisKeyRef = useRef(customClisKey);
  useEffect(() => {
    if (customClisKeyRef.current === customClisKey) return;
    customClisKeyRef.current = customClisKey;
    void redetectClis();
  }, [customClisKey, redetectClis]);

  // 增删改自定义 CLI；被删除的 CLI 的任务一并关闭并移除，避免留下看不见的终端进程
  const handleCustomClisChange = (next: CustomCli[]) => {
    const removed = new Set(customClis.filter((cli) => !next.some((item) => item.id === cli.id)).map((cli) => cli.id));
    if (removed.size > 0) {
      const doomed = tasks.filter((task) => removed.has(task.groupId));
      doomed.forEach((task) => { void window.electronAPI?.killSession(task.id); });
      setTasks((prev) => prev.filter((task) => !removed.has(task.groupId)));
      if (activeTaskId && doomed.some((task) => task.id === activeTaskId)) {
        setActiveTaskId(orderedTasks(folders, visibleTasks.filter((task) => !removed.has(task.groupId)))[0]?.id ?? null);
      }
    }
    setSettings((prev) => ({ ...prev, customClis: next }));
  };

  // 触发新建任务弹窗：在哪个文件夹里、预选哪个 CLI
  const handleOpenNewTask = (folderPath: string, cliId?: string) => {
    setNewTaskContext({ folderPath, cliId: cliId || 'terminal' });
  };

  // 添加文件夹：只把文件夹加入侧栏，不结束任何已在运行的终端
  const handleAddFolder = async () => {
    const folder = await window.electronAPI?.selectWorkspaceDirectory?.(workspacePath);
    if (!folder) return;
    setFolders((prev) => ensureFolder(prev, folder, true));
    setLastFolder(folder);
  };

  // 从侧栏移除文件夹：结束该文件夹里的全部终端并删除这些任务，历史会话不受影响
  const handleRemoveFolder = async (folderPath: string) => {
    const doomed = tasksInFolder(tasks, folderPath);
    const alive = doomed.filter((task) => isTaskAlive(task.status)).length;
    if (!await askConfirm({
      title: t('从侧栏移除文件夹'),
      message: doomed.length === 0
        ? t('把“{name}”从侧栏移除？', { name: folderName(folderPath) })
        : t('“{name}”里的 {n} 个任务会被移除{alive}。文件夹本身和 CLI 的历史会话不受影响。', { name: folderName(folderPath), n: doomed.length, alive: alive > 0 ? t('，其中 {n} 个终端进程会被终止', { n: alive }) : '' }),
      confirmLabel: t('移除'),
      danger: true,
    })) return;
    const doomedIds = new Set(doomed.map((task) => task.id));
    doomed.forEach((task) => window.electronAPI?.killSession(task.id));
    const remaining = orderedTasks(folders, visibleTasks).filter((task) => !doomedIds.has(task.id));
    setTasks((prev) => prev.map((task) => doomedIds.has(task.id) ? { ...task, status: 'stopped', closedAt: Date.now() } : task));
    setFolders((prev) => prev.filter((folder) => folderKey(folder.path) !== folderKey(folderPath)));
    if (activeTaskId && doomedIds.has(activeTaskId)) {
      const next = remaining[0];
      setActiveTaskId(next?.id ?? null);
      if (next) setFolders((prev) => ensureFolder(prev, next.cwd, true));
    }
  };

  // 创建子任务
  const handleCreateTask = useCallback(async (groupId: string, title: string, command: string, cwd: string, historyId?: string, accountId?: string, nativeSession?: NativeSessionRef, sourceTaskId?: string): Promise<{ success: boolean; error?: string }> => {
    const newTaskId = `${groupId}-task-${crypto.randomUUID()}`;
    const resolvedCwd = cwd || workspacePath;
    const account = accountId ? settings.accounts.find((item) => item.id === accountId) : undefined;
    if (accountId && !account) return { success: false, error: t('所选账号配置不存在，请在「设置 → 账号」中检查。') };
    let launchError: string | undefined;
    if (window.electronAPI) {
      const newCodexTitle = groupId === 'codex' && command === 'codex' && !account && !nativeSession && !historyId ? title : undefined;
      const result = await window.electronAPI.createSession({ id: newTaskId, nativeSession, newCodexTitle, command: command || 'powershell.exe', cwd: resolvedCwd, account: account && toSessionAccount(account) });
      if (!result.success) {
        launchError = result.error || t('终端启动失败');
        if (!result.nativeSession) return { success: false, error: launchError };
      }
      if (result.nativeSession) { nativeSession = result.nativeSession; historyId = nativeSession.id; }
    }
    const newTask: TaskSession = {
      id: newTaskId,
      groupId,
      title,
      command: command || 'powershell.exe',
      historyId,
      accountId,
      nativeSession,
      sourceTaskId,
      status: launchError ? 'error' : 'running',
      errorMessage: launchError,
      cwd: resolvedCwd,
      createdAt: Date.now(),
    };

    setTasks((prev) => [...prev, newTask]);
    setFolders((prev) => ensureFolder(prev, resolvedCwd, true));
    setActiveTaskId(newTaskId);

    return launchError ? { success: false, error: launchError } : { success: true };
  }, [workspacePath, settings.accounts]);

  // 一键新建：用默认名称、该 CLI 的默认命令在指定文件夹直接启动；失败时转到自定义弹窗修改
  const quickCreatingRef = useRef(new Set<string>());
  const handleQuickNewTask = async (folderPath: string, cliId: string, accountId?: string) => {
    const cli = allClis.find((item) => item.id === cliId);
    const lockKey = `${folderKey(folderPath)}:${cliId}`;
    if (!cli || quickCreatingRef.current.has(lockKey)) return;
    quickCreatingRef.current.add(lockKey);
    try {
      const result = await handleCreateTask(cliId, nextTaskTitle(tasksInFolder(tasks, folderPath)), cli.defaultCommand, folderPath, undefined, accountId);
      if (!result.success) {
        await notify(t('任务启动失败'), t('{reason}。可以在接下来的窗口中修改启动命令或工作目录。', { reason: result.error || t('终端启动失败') }));
        handleOpenNewTask(folderPath, cliId);
      }
    } finally {
      quickCreatingRef.current.delete(lockKey);
    }
  };

  // 关闭具体子任务
  const handleCloseTask = useCallback(async (taskId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    const task = allTasks.find((item) => item.id === taskId);
    if (task && isTaskAlive(task.status) && !await askConfirm({
      title: t('关闭任务'),
      message: t('关闭“{title}”会终止此终端及其中运行的命令。', { title: task.title }),
      confirmLabel: t('关闭并终止'),
      danger: true,
    })) return;

    if (window.electronAPI) {
      window.electronAPI.killSession(taskId);
    }

    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'stopped', closedAt: Date.now() } : t));

    if (activeTaskId === taskId) {
      // 优先切到同一文件夹内的相邻任务，再回退到侧栏里的其他任务。
      const ordered = orderedTasks(folders, visibleTasks);
      const mates = task ? ordered.filter((item) => folderKey(item.cwd) === folderKey(task.cwd)) : [];
      const index = mates.findIndex((item) => item.id === taskId);
      const remainingMates = mates.filter((item) => item.id !== taskId);
      const sameFolderTask = index >= 0 ? remainingMates[index] || remainingMates[index - 1] : undefined;
      const nextTask = sameFolderTask || ordered.filter((t) => t.id !== taskId)[0];
      setActiveTaskId(nextTask?.id || null);
      if (nextTask) setFolders((prev) => ensureFolder(prev, nextTask.cwd, true));
    }
  }, [activeTaskId, allTasks, folders, visibleTasks, askConfirm]);

  const handleRenameTask = useCallback((taskId: string, title: string) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, title, titleLocked: true } : t));
  }, []);

  // 设置 → 账号 → 登录：在该账号环境下新开一个终端任务运行 CLI 自带的登录命令，凭据由 CLI 自己写入账号目录
  const handleLoginAccount = async (account: Account) => {
    const cli = accountCli(account.cliId);
    if (!cli || !visibleClis.some((item) => item.id === account.cliId)) {
      void notify(t('无法登录'), t('本机未检测到 {name} 命令。', { name: cli?.name ?? account.cliId }));
      return;
    }
    const result = await handleCreateTask(account.cliId, t('登录 {name}', { name: account.name }), cli.loginCommand, workspacePath, undefined, account.id);
    if (result.success) setIsSettingsOpen(false);
    else void notify(t('登录任务启动失败'), result.error || t('终端启动失败'));
  };

  // 手动刷新当前选中 CLI 的真实配额
  const handleRefreshQuota = async () => {
    if (window.electronAPI) {
      const latest = await window.electronAPI.refreshQuota(currentGroup ? quotaKey(currentGroup.id, activeTask?.accountId) : undefined);
      if (latest) setQuotas(latest);
    }
  };

  // 重启指定任务，未指定时为当前任务
  const handleRestartSession = useCallback(async (taskId: string | null = activeTaskId) => {
    const task = allTasks.find((item) => item.id === taskId);
    if (!taskId || !task || task.status === 'starting') return;
    if (task.nativeSession) { if (isTaskAlive(task.status)) { await notify(t('恢复会话'), t('请先关闭当前终端，再从历史恢复为新任务。')); return; } await restoreNative(task.nativeSession, task.title, task.id); return; }
    if (['codex', 'kimi', 'agy'].includes(task.groupId)) { await notify(t('会话身份未确认'), t('身份未确认，原任务记录保留。请打开 Shell 或工具原生选择器。')); return; }
    if (isTaskAlive(task.status) && !await askConfirm({
      title: t('重启终端'),
      message: t('重启“{title}”会终止当前终端命令。', { title: task.title }),
      confirmLabel: t('重启'),
      danger: true,
    })) return;
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'starting' } : t));
    const result = await terminalViewportRef.current?.restartActiveTerminal(taskId);
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...startOutcome(result) } : t));
  }, [activeTaskId, allTasks, askConfirm]);

  // 侧栏右键「重启」：已停止的任务切过去并启动，存活的任务原地重启
  const handleRestartTask = (taskId: string) => {
    const task = allTasks.find((item) => item.id === taskId);
    if (!task) return;
    if (isTaskAlive(task.status)) void handleRestartSession(taskId);
    else if (task.nativeSession) void restoreNative(task.nativeSession, task.title, task.id);
    else if (task.groupId === 'terminal') void handleCreateTask('terminal', task.title, task.command || 'powershell.exe', task.cwd, undefined, task.accountId, undefined, task.id);
    else void notify(t('会话身份未确认'), t('身份未确认，原任务记录保留。请打开 Shell 或工具原生选择器。'));
  };

  const handleOpenDirectory = async (dir: string) => {
    if (!await window.electronAPI?.openDirectory?.(dir)) void notify(t('无法打开目录'), t('{dir} 不存在或无法访问。', { dir }));
  };

  const restoring = useRef(new Set<string>());
  const restoreNative = async (ref: NativeSessionRef, title: string, sourceTaskId?: string) => {
    const key = nativeKey(ref);
    if (restoring.current.has(key)) return;
    const live = tasksRef.current.find(task => task.nativeSession && nativeKey(task.nativeSession) === key && isTaskAlive(task.status));
    if (live) { setActiveTaskId(live.id); return; }
    restoring.current.add(key);
    try {
      if (!await askConfirm({ title: sourceTaskId && ['codex', 'agy'].includes(ref.tool) ? t('继续此对话') : t('恢复为新任务'), message: t('将在 {cwd} 恢复 {tool} 会话 {id}。请确认它没有在其他应用或终端运行。', { cwd: ref.cwd, tool: ref.tool, id: ref.id }), confirmLabel: t('原进程已关闭，恢复') })) return;
      const result = await handleCreateTask(ref.tool, title, '', ref.cwd, ref.id, undefined, ref, sourceTaskId);
      if (result.success && sourceTaskId && ['codex', 'agy'].includes(ref.tool)) {
        setTasks(prev => prev.map(task => task.id === sourceTaskId && !task.nativeSession && !task.accountId &&
          task.groupId === ref.tool && folderKey(task.cwd) === folderKey(ref.cwd) && (!task.historyId || task.historyId === ref.id)
          ? { ...task, nativeSession: ref, historyId: ref.id, title: !task.titleLocked && /^Task \d+$/.test(task.title) && title.trim() ? title : task.title } : task));
      }
      if (!result.success) await notify(t('恢复会话失败'), result.error || t('终端启动失败'));
    } finally { restoring.current.delete(key); }
  };
  const bindNative = async (entry: NativeHistoryEntry) => {
    if (!activeTask || activeTask.accountId || activeTask.nativeSession) return;
    if (!isTaskAlive(activeTask.status)) {
      if (activeTask.groupId !== entry.tool || folderKey(activeTask.cwd) !== folderKey(entry.cwd) || (activeTask.historyId && activeTask.historyId !== entry.id)) return;
      if (!await askConfirm({ title: t('关联到此任务'), message: t('将本地任务“{title}”关联到会话 {id}，以后点击该任务即可查看。', { title: activeTask.title, id: entry.id }), confirmLabel: t('确认关联') })) return;
      setTasks(prev => prev.map(task => task.id === activeTask.id ? { ...task, nativeSession: entry, historyId: entry.id, title: !task.titleLocked && /^Task \d+$/.test(task.title) && entry.title.trim() ? entry.title : task.title } : task));
      setPanelTab('prompts');
      return;
    }
    if (!await askConfirm({ title: t('关联当前终端'), message: t('请对照工具显示的会话编号，确认当前终端属于 {id}。目录相同不能证明身份。', { id: entry.id }), confirmLabel: t('编号一致，关联') })) return;
    const id = activeTask.id;
    const ref = await window.electronAPI.bindNativeSession?.(id, entry);
    if (ref) setTasks(prev => prev.map(task => task.id === id ? {
      ...task, nativeSession: ref, historyId: ref.id,
      title: !task.titleLocked && /^Task \d+$/.test(task.title) && entry.title.trim() ? entry.title : task.title,
    } : task));
  };
  const handleResumeHistory = async (entry: HistoryEntry) => {
    const entries = await window.electronAPI.listNativeSessions?.();
    const ref = entries?.find(item => item.id === entry.id && item.tool === entry.cliId && folderKey(item.cwd) === folderKey(entry.cwd));
    if (ref) await restoreNative(ref, entry.title);
    else await notify(t('无法恢复会话'), t('原生会话不可用，请刷新历史'));
  };

  // 全局快捷键。在捕获阶段处理并阻止继续传播，避免同一按键再被 xterm 发往 CLI；
  // 只占用终端程序基本不用的组合（Ctrl+Tab、Ctrl+数字、Ctrl+Shift+字母、Ctrl+,）。
  const shortcutRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  shortcutRef.current = (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return false;
    if (isNewTaskOpen || isSettingsOpen || isHistoryOpen || isUsageOpen || workReminderVisible || confirmOptions) return false;
    const ordered = orderedTasks(folders, visibleTasks);
    const key = e.key.toLowerCase();
    if (key === 'tab') {
      if (ordered.length < 2) return true;
      const index = ordered.findIndex((task) => task.id === activeTaskId);
      const next = index < 0
        ? ordered[e.shiftKey ? ordered.length - 1 : 0]
        : ordered[(index + (e.shiftKey ? -1 : 1) + ordered.length) % ordered.length];
      handleSelectTask(next.id, false);
      return true;
    }
    if (!e.shiftKey && e.code.startsWith('Digit') && e.code !== 'Digit0') {
      const target = ordered[Number(e.code.slice(5)) - 1];
      if (target) handleSelectTask(target.id, false);
      return true;
    }
    if (!e.shiftKey && key === ',') { setIsSettingsOpen(true); return true; }
    if (!e.shiftKey) return false;
    if (key === 't' || key === 'n') {
      // 沿用当前任务的 CLI，在当前文件夹新建
      const cli = currentGroup && visibleClis.some((item) => item.id === currentGroup.id) ? currentGroup : visibleClis[0];
      if (cli) {
        if (key === 't') void handleQuickNewTask(workspacePath, cli.id);
        else handleOpenNewTask(workspacePath, cli.id);
      }
      return true;
    }
    if (key === 'w') {
      if (activeTask && visibleClis.some((cli) => cli.id === activeTask.groupId)) void handleCloseTask(activeTask.id);
      return true;
    }
    if (key === 'b') { setIsSidebarCollapsed((collapsed) => !collapsed); return true; }
    if (key === 'h') { setIsHistoryOpen(true); return true; }
    if (key === 'u') { setIsUsageOpen(true); return true; }
    return false;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutRef.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // 没有活动任务时的引导：列出本机可用的 CLI，点击即进入新建任务
  // 没有活动任务时：最近 3 条历史会话（只含本机已安装的 CLI），点击直接恢复
  const recentForEmpty = [...history].filter((entry) => visibleClis.some((cli) => cli.id === entry.cliId)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const emptyState = (
    <div className="workbench-empty text-left">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="workbench-empty-mark"><AppLogo size={30} /><span className="text-sm font-semibold tracking-tight">OneTerm</span></div>
          <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-fg">{t('开始一个任务')}</h2>
        </div>
        <div className="flex max-w-[55%] items-center justify-end gap-2 pt-1 text-xs text-fg-subtle" data-empty-folder-line>
          <span className="truncate" title={workspacePath}>{t('在「{name}」', { name: folderName(workspacePath) })}</span>
          {gitBranches[folderKey(workspacePath)] && <span className="shrink-0 rounded-full border border-violet/30 bg-violet/10 px-1.5 text-2xs text-violet">{gitBranches[folderKey(workspacePath)]}</span>}
          <button type="button" onClick={() => void handleAddFolder()} className="shrink-0 rounded px-1 text-xs text-accent hover:underline">{t('换文件夹')}</button>
        </div>
      </div>
      <p className="mb-2 mt-6 px-1 text-2xs font-medium uppercase tracking-[0.08em] text-fg-faint">{t('新建任务')}</p>
      <div className={`grid grid-cols-2 gap-2 ${visibleClis.length <= 4 ? '' : 'sm:grid-cols-3'}`}>
        {visibleClis.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => void handleQuickNewTask(workspacePath, group.id)}
            onContextMenu={(e) => { e.preventDefault(); handleOpenNewTask(workspacePath, group.id); }}
            title={t('启动 {name}（右键可自定义命令与目录）', { name: group.name })}
            className="workbench-empty-card text-ui font-medium"
          >
            <BrandIcon icon={group.icon} size={18} />
            <span className="truncate">{group.name}</span>
            <Plus size={13} className="ml-auto shrink-0 text-fg-faint" />
          </button>
        ))}
      </div>
      {recentForEmpty.length > 0 && (
        <div className="mt-5" data-empty-recent>
          <p className="mb-2 px-1 text-2xs font-medium uppercase tracking-[0.08em] text-fg-faint">{t('继续上次')}</p>
          <div className="space-y-1.5">
            {recentForEmpty.map((entry) => (
              <button
                key={`${entry.cliId}:${entry.id}`}
                type="button"
                onClick={() => void handleResumeHistory(entry)}
                title={`${entry.title}
${entry.cwd}`}
                className="workbench-empty-card w-full text-ui"
              >
                <BrandIcon icon={entry.cliId} size={16} />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="shrink-0 text-xs text-fg-faint">{folderName(entry.cwd)} · {formatAgo(entry.updatedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="workbench-empty-shortcuts mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-line/60 pt-4 text-center text-2xs text-fg-faint">
        <span><kbd className="workbench-kbd">Ctrl + Shift + T</kbd> {t('新建任务')}</span>
        <span><kbd className="workbench-kbd">Ctrl + Shift + N</kbd> {t('自定义新建')}</span>
        <span><kbd className="workbench-kbd">Ctrl + Shift + H</kbd> {t('全部历史会话')}</span>
      </p>
    </div>
  );

  return (
    <div className="workbench-ui flex h-screen w-screen bg-canvas text-fg overflow-hidden">
      {/* 左侧：CLI 品牌 Logo + 多任务树状菜单 */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        clis={visibleClis}
        folders={[...folders].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))}
        tasks={visibleTasks}
        closedTasks={tasks.filter(task => task.closedAt).sort((a, b) => b.closedAt! - a.closedAt!)}
        accounts={settings.accounts}
        gitBranches={gitBranches}
        summaries={summaries}
        codexPayloads={codexPayloads}
        clockOffsetHours={settings.clockOffsetHours}
        recentFolders={recentFolders}
        activeTaskId={activeTaskId}
        onAddFolder={() => void handleAddFolder()}
        onSelectTask={id => {
          const task = allTasks.find(item => item.id === id);
          if (task?.closedAt) {
            setActiveTaskId(id);
            setPanelTab(task.nativeSession ? 'prompts' : 'history');
            setPanelOpen(true);
            return;
          }
          handleSelectTask(id);
          if (!task || isTaskAlive(task.status) || task.accountId || !['codex', 'kimi', 'agy'].includes(task.groupId)) return;
          setPanelTab(task.nativeSession ? 'prompts' : 'history');
          setPanelOpen(true);
        }}
        onToggleFolder={handleToggleFolder}
        onPinFolder={path => setFolders(prev => prev.map(folder => folderKey(folder.path) === folderKey(path) ? { ...folder, pinned: !folder.pinned } : folder))}
        onReorderFolder={reorderFolder}
        onNewTask={(folderPath, cliId, accountId) => void handleQuickNewTask(folderPath, cliId, accountId)}
        onCustomNewTask={handleOpenNewTask}
        onCloseTask={handleCloseTask}
        onRenameTask={handleRenameTask}
        onReorderTask={reorderTask}
        onRestartTask={handleRestartTask}
        onOpenFolder={(dir) => void handleOpenDirectory(dir)}
        onRemoveFolder={(dir) => void handleRemoveFolder(dir)}
        onResumeHistory={(entry) => void handleResumeHistory(entry)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        unreadTaskIds={unreadTaskIds}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* 右侧：顶栏（单行横排纯文字额度） + 终端主视窗 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        <Topbar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
          currentGroup={currentGroup}
          activeTask={activeTask}
          emptyFolder={{ name: folderName(workspacePath), branch: gitBranches[folderKey(workspacePath)] }}
          accountName={activeTask?.accountId ? (settings.accounts.find((a) => a.id === activeTask.accountId)?.name ?? t('账号已删除')) : undefined}
          quota={currentQuota}
          clockOffsetHours={settings.clockOffsetHours}
          dateVisible={settings.topbarDateVisible !== false}
          onRefreshQuota={handleRefreshQuota}
          onOpenSearch={() => terminalViewportRef.current?.openSearch()}
          onClearScreen={() => terminalViewportRef.current?.clearActiveTerminal()}
          onRestartSession={() => handleRestartSession()}
          onOpenHistory={() => setIsHistoryOpen(true)}
          onOpenUsage={() => setIsUsageOpen(true)}
          onExportLogs={async (mode) => terminalViewportRef.current?.exportActiveTerminalLog(mode) || { success: false, error: t('没有活动终端') }}
        />

        <div className="workbench-toolbar flex flex-wrap shrink-0 items-center gap-3 border-b border-line/70 px-3 py-2 text-xs">
          <div className="workbench-launchers shrink-0" role="group" aria-label={t('新建任务')}>
            {visibleClis.filter(cli => toolbarClis.includes(cli.id)).sort((a, b) => toolbarClis.indexOf(a.id) - toolbarClis.indexOf(b.id)).map(cli => <button key={cli.id} className="workbench-launch-btn" onClick={() => void handleQuickNewTask(workspacePath, cli.id)}><BrandIcon icon={cli.icon} size={14} /><span>{cli.id === 'terminal' ? 'Shell' : cli.id === 'agy' ? 'Antigravity CLI' : cli.name}</span><Plus size={11} /></button>)}
          </div>
          <button className="workbench-launch-btn shrink-0 border border-line" disabled={desktopBusy} title={t('打开 Antigravity 桌面端')} onClick={() => { if (antigravity?.installed) void openAntigravity(); else { setPanelTab('connections'); setPanelOpen(true); void refreshAntigravity(); } }}><BrandIcon icon="agy" size={14} /><span>Antigravity</span><span aria-hidden="true">↗</span></button>
          <span className="workbench-identity min-w-0 flex-1 truncate" title={activeTask?.nativeSession ? t('原生身份已关联；实时状态未验证') : activeTask && ['kimi', 'codex', 'agy'].includes(activeTask.groupId) ? t('会话身份未确认') : t('项目工作台')}>{activeTask?.nativeSession ? t('原生身份已关联；实时状态未验证') : activeTask && ['kimi', 'codex', 'agy'].includes(activeTask.groupId) ? t('会话身份未确认') : t('项目工作台')}</span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {activeCodexPayload && (
              <button
                type="button"
                data-codex-payload
                data-payload-level={activeCodexPayload.level}
                onClick={() => void refreshCodexPayloads()}
                title={t('活跃请求体 {est} MB · 活跃图片 {images} 张 · 已压缩 {compacts} 次 · 磁盘 {file} MB（点击刷新）', {
                  est: activeCodexPayload.estMb.toFixed(1),
                  images: activeCodexPayload.images,
                  compacts: activeCodexPayload.compacts,
                  file: activeCodexPayload.fileMb.toFixed(1),
                })}
                className={`workbench-small-btn inline-flex items-center gap-1.5 rounded-md border px-2.5 font-mono transition-colors ${
                  activeCodexPayload.level === 'danger'
                    ? 'border-danger/55 bg-danger/15 font-medium text-danger hover:bg-danger/20'
                    : activeCodexPayload.level === 'warn'
                      ? 'border-warning/45 bg-warning/10 text-warning hover:bg-warning/15'
                      : 'border-line bg-canvas/60 text-fg-muted hover:text-fg'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    activeCodexPayload.level === 'danger'
                      ? 'bg-danger'
                      : activeCodexPayload.level === 'warn'
                        ? 'bg-warning'
                        : 'bg-success'
                  }`}
                  aria-hidden="true"
                />
                <span>Payload {activeCodexPayload.estMb.toFixed(1)} MB</span>
                {activeCodexPayload.images > 0 && <span>· {t('{n}图', { n: activeCodexPayload.images })}</span>}
                {activeCodexPayload.compacts > 0 && <span>· c{activeCodexPayload.compacts}</span>}
                {activeCodexPayload.level === 'warn' && <span className="codex-payload-hint">· {t('建议 /compact')}</span>}
                {activeCodexPayload.level === 'danger' && <span className="codex-payload-hint">· {t('请立即 /compact')}</span>}
              </button>
            )}
            {activeTask && !isTaskAlive(activeTask.status) && <button className="btn-secondary workbench-small-btn" onClick={() => handleRestartTask(activeTask.id)}>{t('恢复会话')}</button>}
            <button className={`btn-secondary workbench-small-btn workbench-panel-toggle ${panelOpen ? 'is-active' : ''}`} aria-pressed={panelOpen} onClick={() => { setPanelOpen(!panelOpen); }}>{panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}{t('文件与历史')}</button>
          </div>
        </div>
        {/* 多实例保活终端容器（切换时不销毁，display: none 保活） */}
        <div className="workbench-content flex min-h-0 flex-1 overflow-hidden" data-main-conversation={mainConversation || undefined}>
          <TerminalViewport
            theme={resolvedTheme}
            ref={terminalViewportRef}
            tasks={allTasks.filter(task => !task.closedAt)}
            activeTaskId={activeTaskId}
            fontSize={settings.terminalFontSize}
            lineHeight={settings.terminalLineHeight}
            cursorStyle={settings.terminalCursorStyle}
            cursorBlink={settings.terminalCursorBlink}
            emptyState={emptyState}
            onPreviewFile={(cwd, path, line) => setFilePreview({ cwd, path, line, openedAt: Date.now() })}
            onPromptTitle={(id, title) => setTasks(prev => prev.map(task =>
              task.id === id && !task.titleLocked && /^Task \d+$/.test(task.title) ? { ...task, title } : task))}
          />
          {panelOpen && <WorkbenchPanel mainConversation={mainConversation} key={activeTask?.id} task={activeTask} cwd={workspacePath} tab={panelTab} antigravity={antigravity} desktopBusy={desktopBusy} onOpenAntigravity={() => void openAntigravity()} onRefreshAntigravity={() => void refreshAntigravity()} installed={installed} closed={tasks.filter(task => task.closedAt || !isTaskAlive(task.status))}
            onTab={setPanelTab} onClose={() => setPanelOpen(false)} onPreview={path => { setPanelOpen(false); setFilePreview({ cwd: workspacePath, path, openedAt: Date.now() }); }}
            onCodexPicker={async () => {
              const result = await handleCreateTask('codex', t('Codex 会话选择器'), 'codex resume', workspacePath, undefined, activeTask?.accountId);
              if (result.success) setPanelOpen(false);
              else await notify(t('任务启动失败'), result.error || t('终端启动失败'));
            }}
            onRestore={restoreNative} onBind={bindNative} restoreWorkspace={settings.restoreWorkspace === true}
            onRecoveryChange={value => setSettings(prev => ({ ...prev, restoreWorkspace: value }))} />}
          {filePreview && (
            <FilePreviewPanel
              cwd={filePreview.cwd}
              filePath={filePreview.path}
              line={filePreview.line}
              openedAt={filePreview.openedAt}
              minimap={settings.previewMinimap}
              width={previewWidth}
              onResize={setPreviewWidth}
              onClose={() => setFilePreview(null)}
            />
          )}
        </div>
      </div>

      {/* 新建子任务弹窗 */}
      <NewTaskModal
        isOpen={isNewTaskOpen}
        onClose={() => setNewTaskContext(null)}
        clis={visibleClis}
        initialCliId={newTaskContext?.cliId}
        folderPath={newTaskContext?.folderPath ?? workspacePath}
        tasks={tasks}
        accounts={settings.accounts}
        onCreate={(cliId, title, command, cwd, accountId) => handleCreateTask(cliId, title, command, cwd, undefined, accountId)}
      />

      <UsageModal isOpen={isUsageOpen} onClose={() => setIsUsageOpen(false)} accounts={settings.accounts} />

      {/* 首次启动引导：选择语言，认识各入口；完成后不再弹出 */}
      <OnboardingModal
        isOpen={!settings.onboardingDone}
        language={settings.language}
        onLanguageChange={(language) => setSettings((prev) => ({ ...prev, language }))}
        detectedClis={installed ? visibleClis.filter((cli) => cli.id !== 'terminal').map((cli) => ({ id: cli.id, name: cli.name, icon: cli.icon })) : null}
        defaultFolder={workspacePath}
        onAddFolder={() => void handleAddFolder()}
        onFinish={() => setSettings((prev) => ({ ...prev, onboardingDone: true }))}
      />

      {/* 外观与字体大小设置弹窗 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={setSettings}
        onResetDefault={async () => {
          if (!await askConfirm({
            title: t('恢复默认设置'),
            message: t('将还原外观、终端、时间与提醒的设置。账号、自定义 CLI 和界面语言保留。'),
            confirmLabel: t('恢复默认'),
            danger: true,
          })) return;
          setSettings((prev) => ({ ...DEFAULT_SETTINGS, accounts: prev.accounts, customClis: prev.customClis, language: prev.language, onboardingDone: prev.onboardingDone }));
        }}
        onLoginAccount={(account) => void handleLoginAccount(account)}
        fallbackKnownClis={[...BUILTIN_CLIS, ...extraClis].filter((cli) => cli.id !== 'terminal').map((cli) => ({ id: cli.id, name: cli.name, command: cli.defaultCommand }))}
        installed={installed}
        onCustomClisChange={handleCustomClisChange}
        onRedetectClis={redetectClis}
        accountTaskCounts={tasks.reduce<Record<string, number>>((counts, task) => { if (task.accountId) counts[task.accountId] = (counts[task.accountId] ?? 0) + 1; return counts; }, {})}
      />
      <Modal
        isOpen={workReminderVisible}
        onClose={() => setWorkReminderVisible(false)}
        titleId="work-reminder-title"
        title={t('休息提醒')}
        widthClass="max-w-sm"
        footer={<button type="button" autoFocus onClick={() => setWorkReminderVisible(false)} className="btn-primary">{t('知道了')}</button>}
      >
        <p className="text-ui leading-relaxed text-fg-muted">{workReminderText(workedHours)}</p>
      </Modal>
      <ConfirmDialog options={confirmOptions} onResolve={resolveConfirm} />
    </div>
  );
};
export default App;
