import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { AntigravityDesktopInfo, AntigravityOpenResult } from '../shared/workbench';
import { t } from './i18n';

type Installation = { executable: string; version?: string };
const run = promisify(execFile);

// Read only installer metadata. Never query credentials, sessions or internal services.
export async function windowsInstallations(): Promise<Installation[]> {
  if (process.platform !== 'win32') return [];
  const candidates: Installation[] = [];
  const script = `$ErrorActionPreference='Stop'; $roots=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'); $found=@(foreach($root in $roots){Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | Get-ItemProperty -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -match '^Antigravity(?:\\s|$)'} | Select-Object DisplayIcon,InstallLocation,DisplayVersion}); ConvertTo-Json -InputObject $found -Compress`;
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ' + script], { windowsHide: true, timeout: 6000, maxBuffer: 64 * 1024, encoding: 'utf8' });
    const records = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    for (const record of Array.isArray(records) ? records : []) {
      const icon = typeof record.DisplayIcon === 'string' ? record.DisplayIcon.replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '') : '';
      const version = typeof record.DisplayVersion === 'string' ? record.DisplayVersion.slice(0, 64) : undefined;
      if (icon) candidates.push({ executable: icon, version });
      if (typeof record.InstallLocation === 'string' && record.InstallLocation) candidates.push({ executable: path.join(record.InstallLocation, 'Antigravity.exe'), version });
    }
  } catch { /* Standard per-user install remains discoverable without registry access. */ }
  if (process.env.LOCALAPPDATA) candidates.push({ executable: path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'Antigravity.exe') });
  return candidates;
}

function launchDesktop(executable: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // The desktop app brings its existing window forward. No shell, project flags or prompt.
    const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export class AntigravityDesktop {
  private scanning?: Promise<AntigravityDesktopInfo>;
  private opening?: Promise<AntigravityOpenResult>;
  constructor(private discover = windowsInstallations, private launch = launchDesktop) {}
  detect(): Promise<AntigravityDesktopInfo> {
    if (this.scanning) return this.scanning;
    this.scanning = this.scan().finally(() => { this.scanning = undefined; });
    return this.scanning;
  }
  private async scan(): Promise<AntigravityDesktopInfo> {
    try {
      for (const item of await this.discover()) {
        if (!path.isAbsolute(item.executable) || path.basename(item.executable).toLowerCase() !== 'antigravity.exe') continue;
        try {
          if (!(await fs.stat(item.executable)).isFile()) continue;
          return { installed: true, executable: item.executable, version: item.version, projectOpen: 'manual' };
        } catch { /* Skip stale installer entries. */ }
      }
      return { installed: false, projectOpen: 'manual' };
    } catch { return { installed: false, projectOpen: 'manual', error: t('桌面应用检测失败，请重试') }; }
  }
  open(cwd: unknown, copy: (value: string) => void): Promise<AntigravityOpenResult> {
    if (this.opening) return this.opening;
    this.opening = this.openOnce(cwd, copy).finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private async openOnce(cwd: unknown, copy: (value: string) => void): Promise<AntigravityOpenResult> {
    let clipboardCopied = false;
    try {
      if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !(await fs.stat(cwd)).isDirectory()) throw new Error(t('项目目录不可用'));
      const info = await this.detect();
      if (!info.installed || !info.executable) throw new Error(t('未找到 Antigravity 桌面应用'));
      copy(cwd); clipboardCopied = true;
      await this.launch(info.executable);
      return { success: true, projectOpened: false, clipboardCopied };
    } catch (error) {
      return { success: false, projectOpened: false, clipboardCopied, error: error instanceof Error ? error.message : t('无法启动桌面应用') };
    }
  }
}
