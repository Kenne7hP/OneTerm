// Real Windows/Electron terminal lifecycle regression, using only synthetic local commands.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, '.tmp', 'pty-check-'));
  const profile = path.join(dir, 'profile');
  fs.mkdirSync(profile);
  await require('esbuild').build({
    entryPoints: [path.join(root, 'src/main/pty-manager.ts')],
    bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'node-pty'],
    outfile: path.join(dir, 'manager.cjs'),
  });
  const env = { ...process.env, USERPROFILE: profile, HOME: profile,
    APPDATA: path.join(profile, 'AppData/Roaming'), LOCALAPPDATA: path.join(profile, 'AppData/Local'),
    CODEX_HOME: path.join(profile, '.codex'), CLAUDE_CONFIG_DIR: path.join(profile, '.claude'), KIMI_CODE_HOME: path.join(profile, '.kimi-code') };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, '--harness', dir], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'checks.json'), 'utf8'));
  report.exitCode = exitCode;
  report.stderr = stderr;
  report.checks.push({ name: 'Electron exits successfully', ok: exitCode === 0 });
  report.checks.push({ name: 'native lifecycle emits no stderr errors', ok: stderr.trim() === '' });
  // Exercise immediate app shutdown separately from the diagnostic grace period.
  const shutdownDir = path.join(dir, 'shutdown');
  fs.mkdirSync(shutdownDir);
  const shutdown = spawn(require('electron'), [__filename, '--shutdown', dir, shutdownDir], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let shutdownStderr = '';
  shutdown.stdout.resume();
  shutdown.stderr.on('data', data => { shutdownStderr += data; });
  const shutdownCode = await new Promise((resolve, reject) => { shutdown.on('error', reject); shutdown.on('close', resolve); });
  const shutdownPids = JSON.parse(fs.readFileSync(path.join(shutdownDir, 'pids.json'), 'utf8'));
  const deadline = Date.now() + 5000;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
  while (shutdownPids.some(alive) && Date.now() < deadline) await pause(50);
  report.checks.push({ name: 'immediate app shutdown exits cleanly', ok: shutdownCode === 0 && shutdownStderr.trim() === '' });
  report.checks.push({ name: 'immediate shutdown leaves no observed shell', ok: shutdownPids.every(pid => !alive(pid)) });
  report.shutdown = { exitCode: shutdownCode, stderr: shutdownStderr };
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'stdout.log'), stdout);
  fs.writeFileSync(path.join(dir, 'stderr.log'), stderr);
  console.log(JSON.stringify({ report: path.join(dir, 'report.json'), ...report }, null, 2));
  process.exitCode = report.checks.every(check => check.ok) ? 0 : 1;
}

async function shutdownCheck(dir, outputDir) {
  const { app } = require('electron');
  app.setPath('userData', path.join(outputDir, 'electron-data'));
  await app.whenReady();
  const { PtyManager } = require(path.join(dir, 'manager.cjs'));
  const manager = new PtyManager();
  const pids = [];
  for (const id of ['close-A', 'close-B']) {
    const result = manager.createSession({ id, cwd: outputDir, command: 'powershell.exe -NoLogo -NoProfile' });
    if (!result.success) throw new Error(result.error);
    manager.writeSession(id, "Write-Output ('SHUTDOWN_PID=' + $PID)\r");
    const deadline = Date.now() + 12000;
    while (!/SHUTDOWN_PID=(\d+)/.test(manager.getSessionBuffer(id))) {
      if (Date.now() > deadline) throw new Error('Shutdown shell did not start');
      await pause(50);
    }
    pids.push(Number(manager.getSessionBuffer(id).match(/SHUTDOWN_PID=(\d+)/)[1]));
  }
  fs.writeFileSync(path.join(outputDir, 'pids.json'), JSON.stringify(pids));
  manager.destroyAll();
  manager.destroyAll(); // Matches closed + window-all-closed handlers in the app.
  app.quit();
}

async function verify(dir) {
  const { app } = require('electron');
  app.setPath('userData', path.join(dir, 'profile/electron-data'));
  await app.whenReady();
  const { PtyManager } = require(path.join(dir, 'manager.cjs'));
  const manager = new PtyManager();
  const checks = [], pids = new Set();
  const check = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); if (!ok) throw new Error(name); };
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 12000;
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out: ' + label); await pause(50); }
  };
  const text = id => manager.getSessionBuffer(id).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const shellPid = async id => {
    manager.writeSession(id, "Write-Output ('SHELL_PID=' + $PID)\r");
    await waitFor(() => /SHELL_PID=(\d+)/.test(text(id)), 'shell PID ' + id);
    const pid = Number(text(id).match(/SHELL_PID=(\d+)/)[1]);
    pids.add(pid);
    return pid;
  };
  try {
    check('synthetic profile is active', require('node:os').homedir() === path.join(dir, 'profile'));
    for (const id of ['A', 'B']) check('start ' + id, manager.createSession({ id, cwd: dir, command: 'powershell.exe -NoLogo -NoProfile', cols: 100, rows: 30 }).success);
    const aPid = await shellPid('A');
    let bPid = await shellPid('B');
    check('startup probe never reaches the replay buffer', ['A', 'B'].every(id =>
      !manager.getSessionBuffer(id).includes('\x1b[c') && !text(id).includes('1;2c')));
    check('distinct live OS processes', aPid !== bPid && alive(aPid) && alive(bPid));
    manager.writeSession('A', "1..4 | ForEach-Object { Write-Output ('BEAT_' + $_); Start-Sleep -Milliseconds 100 }\r");
    manager.writeSession('B', "Write-Output ('中文' + '输入')\r");
    manager.resizeSession('A', 80, 24);
    await waitFor(() => text('A').includes('BEAT_4') && text('B').includes('中文输入'), 'concurrent output');
    check('parallel Unicode output survives resize', true);
    check('reattachment preserves A', manager.createSession({ id: 'A' }).buffer.includes('BEAT_4') && alive(aPid));
    for (let cycle = 0; cycle < 3; cycle++) {
      // Run a blocking child in B's console to verify whole-console cleanup, not just map removal.
      manager.writeSession('B', "powershell.exe -NoLogo -NoProfile -Command \"Write-Output ('CHILD_PID=' + `$PID); Start-Sleep -Seconds 120\"\r");
      await waitFor(() => /CHILD_PID=(\d+)/.test(text('B')), 'child PID');
      const childPid = Number(text('B').match(/CHILD_PID=(\d+)/)[1]);
      pids.add(childPid);
      check('child is alive before restart ' + cycle, alive(childPid));
      check('restart B ' + cycle, manager.restartSession('B').success);
      await waitFor(() => !alive(bPid) && !alive(childPid), 'old shell and child exit');
      check('restart terminates old shell and child ' + cycle, true);
      bPid = await shellPid('B');
      check('A stays alive during restart ' + cycle, alive(aPid) && text('A').includes('BEAT_4'));
    }
    manager.killSession('B');
    manager.killSession('B'); // A repeated close must never call native kill twice on the same handle.
    await waitFor(() => !alive(bPid), 'B close');
    check('repeated close is safe and A remains alive', alive(aPid) && manager.aliveCount() === 1);
    manager.writeSession('A', "Write-Output ('STILL_' + 'RUNNING')\r");
    await waitFor(() => text('A').includes('STILL_RUNNING'), 'A remains interactive');
    check('A still accepts input', true);
  } catch (error) {
    checks.push({ name: 'harness error', ok: false, detail: error.message });
  } finally {
    manager.destroyAll();
    try { await waitFor(() => [...pids].every(pid => !alive(pid)), 'all observed OS processes exit'); }
    catch (error) { checks.push({ name: 'OS process cleanup', ok: false, detail: error.message }); }
    checks.push({ name: 'no observed shell or child remains', ok: [...pids].every(pid => !alive(pid)) });
    // Let the dependency's five-second fallback report errors rather than hiding them via app.exit.
    await pause(5500);
    fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify({ electron: process.versions.electron, node: process.versions.node, checks }, null, 2));
    app.exit(checks.every(check => check.ok) ? 0 : 1);
  }
}

if (process.argv.includes('--shutdown')) {
  const index = process.argv.indexOf('--shutdown');
  shutdownCheck(process.argv[index + 1], process.argv[index + 2]).catch(error => { console.error(error); require('electron').app.exit(1); });
}
else if (process.argv.includes('--harness')) verify(process.argv[process.argv.indexOf('--harness') + 1]).catch(error => { console.error(error); require('electron').app.exit(1); });
else run().catch(error => { console.error(error); process.exitCode = 1; });
