// Synthetic files only; never launch a real application or touch the clipboard.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
async function run() {
  const root = path.resolve(__dirname, '..');
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, '.tmp', 'antigravity-check-'));
  const bundle = path.join(dir, 'service.cjs');
  await build({ entryPoints: [path.join(root, 'src/main/antigravity-desktop.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
  const { AntigravityDesktop } = require(bundle);
  const cwd = path.join(dir, '中文 project & literal'); await fs.mkdir(cwd);
  const executable = path.join(cwd, 'Antigravity.exe'); await fs.writeFile(executable, 'synthetic - never execute');
  const checks = [];
  const check = async (name, fn) => { try { await fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, error: String(e) }); } };
  const launches = [], copies = [];
  const installed = async () => [{ executable, version: '2.32.1' }];
  const desktop = new AntigravityDesktop(installed, async (...args) => { launches.push(args); });
  await check('detects installed executable and version', async () => assert.deepEqual(await desktop.detect(), { installed: true, executable, version: '2.32.1', projectOpen: 'manual' }));
  await check('copies exact Unicode directory and launches only executable', async () => {
    assert.deepEqual(await desktop.open(cwd, x => copies.push(x)), { success: true, clipboardCopied: true, projectOpened: false });
    assert.deepEqual(copies, [cwd]); assert.deepEqual(launches, [[executable]]);
  });
  await check('duplicate opens launch once', async () => {
    const before = launches.length;
    await Promise.all([desktop.open(cwd, x => copies.push(x)), desktop.open(cwd, x => copies.push(x))]);
    assert.equal(launches.length, before + 1);
  });
  for (const invalid of [undefined, 1, 'relative', executable, path.join(dir, 'missing')]) {
    await check('rejects invalid project ' + String(invalid), async () => {
      const before = [launches.length, copies.length];
      const result = await desktop.open(invalid, x => copies.push(x));
      assert.equal(result.success, false); assert.equal(result.clipboardCopied, false);
      assert.deepEqual([launches.length, copies.length], before);
    });
  }
  await check('skips relative stale wrong-name and directory entries', async () => {
    const other = new AntigravityDesktop(async () => [
      { executable: 'Antigravity.exe' }, { executable: path.join(dir, 'Antigravity.exe') },
      { executable: path.join(dir, 'service.cjs') }, { executable: dir }, ...(await installed()),
    ]);
    assert.equal((await other.detect()).executable, executable);
  });
  await check('missing installation neither copies nor launches', async () => {
    const missing = new AntigravityDesktop(async () => [], async () => assert.fail('launch'));
    const result = await missing.open(cwd, () => assert.fail('clipboard'));
    assert.equal(result.success, false); assert.equal(result.clipboardCopied, false);
  });
  await check('launch failure preserves truthful clipboard state', async () => {
    const failed = new AntigravityDesktop(installed, async () => { throw new Error('synthetic launch error'); });
    assert.deepEqual(await failed.open(cwd, () => {}), { success: false, projectOpened: false, clipboardCopied: true, error: 'synthetic launch error' });
  });
  await check('clipboard failure prevents launch', async () => {
    const failed = new AntigravityDesktop(installed, async () => assert.fail('launch'));
    const result = await failed.open(cwd, () => { throw new Error('synthetic clipboard error'); });
    assert.equal(result.success, false); assert.equal(result.clipboardCopied, false);
  });
  await check('discovery exception reported without claiming installed', async () => {
    const failed = new AntigravityDesktop(async () => { throw new Error('synthetic'); });
    const info = await failed.detect(); assert.equal(info.installed, false); assert.ok(info.error);
  });
  await check('concurrent detection shares one scan', async () => {
    let scans = 0; const shared = new AntigravityDesktop(async () => { scans++; return installed(); });
    await Promise.all([shared.detect(), shared.detect()]); assert.equal(scans, 1);
  });
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ directory: dir, checks }, null, 2));
  process.exitCode = checks.every(x => x.ok) ? 0 : 1;
}
run().catch(e => { console.error(e); process.exitCode = 1; });
