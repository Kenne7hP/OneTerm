// Synthetic, local-only fixtures. Never open real tool homes. Preserve test artifacts.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
async function run() {
  const root = path.resolve(__dirname, '..');
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, '.tmp', 'workbench-check-'));
  const bundle = path.join(dir, 'services.cjs');
  await build({ stdin: { contents: "export * from './src/main/native-sessions'; export * from './src/main/cli-detect'; export * from './src/main/native-launch'; export * from './src/main/project-files'; export * from './src/main/codex-payload'; export * from './src/main/codex-history'; export * from './src/renderer/src/workspaceState'; export * from './src/shared/local-paths'; export * from './src/main/local-paths';", resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: bundle });
  const { NativeSessions, NativeLaunch, listProjectFiles, normalizeState, readCodexPayloads, measureCodexRolloutFile, resolveCodexExecutable, extractLocalPathCandidates, resolveLocalPaths, clearLocalPathCache } = require(bundle);
  const roots = { codex: path.join(dir, 'codex'), kimi: path.join(dir, 'kimi') };
  const cwd = path.join(dir, 'project'); await fs.mkdir(cwd);
  const put = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };
  const meta = id => ({ type: 'session_meta', payload: { id, cwd, source: 'cli' } });
  const prompt = text => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  const lines = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const codexFile = path.join(roots.codex, 'sessions', '2026', '11', '16', 'one.jsonl');
  await put(path.join(roots.codex, 'session_index.jsonl'), lines([{id:'c1',thread_name:'Repair sidebar titles'}]));
  await put(codexFile, lines([meta('c1'), prompt('first'), prompt('# AGENTS.md instructions hidden'), { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'input_text', text: 'not user' }] } }, prompt('second')]));
  await put(path.join(roots.codex, 'sessions', 'two.jsonl'), lines([meta('c2'), prompt('other same directory')]));
  const kimiBase = path.join(roots.kimi, 'sessions', 'project-key', 'k1');
  await put(path.join(kimiBase, 'state.json'), JSON.stringify({ id: 'k1', cwd, title: 'Kimi fixture' }));
  await put(path.join(kimiBase, 'agents/main/wire.jsonl'), lines([{ type: 'turn.prompt', origin: { kind: 'user' }, input: [{ type: 'text', text: 'kimi input' }, { type: 'text', text: 'hook secret', meta: { source: 'skill activation' } }] }, { type: 'turn.prompt', origin: { kind: 'agent' }, input: 'agent hidden' }]));
  const native = new NativeSessions(roots, async () => ({ data: [] })), checks = [];
  const check = async (name, fn) => { try { await fn(); checks.push({ name, ok: true }); } catch(e) { checks.push({ name, ok: false, error: String(e) }); } };
  await check('Antigravity CLI and Desktop titles, fallback, transcript pages and resume', async () => {
    const prior = process.env.LOCALAPPDATA;
    const local = path.join(dir,'local');
    const executable = path.join(local,'agy','bin','agy.exe');
    await put(executable,'synthetic');
    try {
      process.env.LOCALAPPDATA = local;
      assert.deepEqual(require(bundle).windowsAgyLaunch('agy --conversation first'), {file:executable,args:['--conversation','first']});
    } finally { if (prior === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = prior; }
    const agy = path.join(dir,'gemini');
    const cli = path.join(agy,'antigravity-cli');
    await fs.mkdir(path.join(agy,'antigravity'), {recursive:true});
    const uri = require('node:url').pathToFileURL(cwd).href;
    const summary = (ID, AppDataDir, extra = {}) => ({summary:{ID,AppDataDir,Title:ID+' title',WorkspaceURIs:[uri],NumSteps:2,...extra}});
    await put(path.join(cli,'cache/conversation_metadata.json'), JSON.stringify({conversations:{
      first:summary('first','antigravity-cli'), second:summary('second','antigravity'),
      internal:{...summary('internal','antigravity'),is_internal:true},
      stale:{...summary('stale','antigravity-cli',{NumSteps:0})},
      epoch:{...summary('epoch','antigravity-cli',{UpdatedAt:'0001-01-01T00:00:00Z'}),last_modified_time:'2026-11-21T08:00:00Z'}
    }}));
    await put(path.join(cli,'history.jsonl'),lines([
      {conversationId:'fresh',workspace:cwd,display:'fallback'},
      {conversationId:'stale',workspace:cwd,display:'stale fallback',timestamp:1795233000000},
      {conversationId:'internal',workspace:cwd,display:'should stay hidden'}
    ]));
    await put(path.join(cli,'annotations/fresh.pbtxt'),'title: "Fresh title"');
    await put(path.join(cli,'annotations/stale.pbtxt'),'title: "\\344\\270\\255\\346\\226\\207\\344\\274\\232\\350\\257\\235"');
    const file = path.join(cli,'brain/first/.system_generated/logs/transcript.jsonl');
    await put(file,lines([{type:'USER_INPUT',content:'meta<USER_REQUEST>question</USER_REQUEST>'},
      ...Array.from({length:2200},()=>({type:'GENERIC',content:'x'.repeat(1024)})),
      {type:'PLANNER_RESPONSE',thinking:'hidden',content:'answer'}]));
    const tailGapFile = path.join(cli,'brain/epoch/.system_generated/logs/transcript_full.jsonl');
    const longAnswer = 'A'.repeat(16500);
    await put(tailGapFile,lines([
      {type:'USER_INPUT',content:'plain question<ADDITIONAL_METADATA>secret meta</ADDITIONAL_METADATA><USER_SETTINGS_CHANGE>changed</USER_SETTINGS_CHANGE>'},
      {type:'PLANNER_RESPONSE',status:'DONE',content:longAnswer},
      ...Array.from({length:2300},()=>({type:'GENERIC',content:'g'.repeat(1024)}))
    ]));
    const service = new NativeSessions({...roots,agy},async()=>({data:[]}));
    const rows = (await service.list()).filter(e=>e.tool==='agy');
    assert.deepEqual(rows.map(e=>e.title).sort(),['Fresh title','epoch title','first title','second title','中文会话']);
    assert.equal(rows.some(e=>e.id==='internal'),false);
    const epochEntry = rows.find(e=>e.id==='epoch');
    assert.equal(epochEntry.updatedAt, Date.parse('2026-11-21T08:00:00Z'));
    const epochPage = await service.prompts(epochEntry);
    assert.equal(epochPage.lastTurn,'completed');
    assert.equal(epochPage.items.length,2);
    assert.equal(epochPage.items[0].role,'assistant');
    assert.equal(epochPage.items[0].truncated,true);
    assert.equal(epochPage.items[0].text.length,16000);
    assert.deepEqual([epochPage.items[1].role,epochPage.items[1].text],['user','plain question']);
    const first = rows.find(e=>e.id==='first');
    const page = await service.prompts(first);
    assert.equal(page.conversation,true);
    assert.deepEqual(page.items.map(x=>[x.role,x.text]),[['assistant','answer']]);
    assert.deepEqual((await service.prompts(first,page.next)).items.map(x=>[x.role,x.text]),[['user','question']]);
    let command;
    const launch = new NativeLaunch(service,{hasSession:()=>false,createSession:o=>{command=o.command;return {success:true}}});
    assert.equal((await launch.create({nativeSession:first,id:'test',cwd})).success,true);
    assert.equal(command,'agy --conversation first');
  });
  const entries = await native.list(true), c1 = entries.find(x => x.id === 'c1'), c2 = entries.find(x => x.id === 'c2'), k1 = entries.find(x => x.id === 'k1');
  await check('indexes Codex and current Kimi identities', () => assert.equal(entries.length, 3));
  await check('thread name belongs to exact Codex session', () => {
    assert.equal(c1.title, 'Repair sidebar titles');
    assert.notEqual(c2.title, c1.title);
  });
  await check('same directory never mixes sessions', async () => assert.deepEqual((await native.prompts(c1)).items.map(x => x.text), ['second', 'first']));
  await check('Kimi excludes agent and hook inputs', async () => assert.deepEqual((await native.prompts(k1)).items.map(x => x.text), ['kimi input']));
  await check('mismatched cwd rejected', async () => assert.ok((await native.prompts({ ...c1, cwd: dir })).error));
  await check('untrusted root rejected', async () => assert.ok((await native.prompts({ ...c1, storageRoot: dir })).error));
  await check('unknown identity rejected', async () => assert.ok((await native.prompts({ ...c1, id: 'unknown' })).error));
  const live = new Map(), calls = [];
  const pty = { hasSession: id => live.has(id), getSessionOptions: id => live.get(id), createSession: options => { if (!live.has(options.id)) { calls.push(options); live.set(options.id, options); } return { success: true }; } };
  const launcher = new NativeLaunch(native, pty);
  await check('concurrent resume requests create one process', async () => {
    const results = await Promise.all(['task1', 'task2'].map(id => launcher.create({ id, cwd, nativeSession: c1 })));
    assert.equal(results.filter(x => x.success).length, 1); assert.equal(calls.length, 1); assert.equal(calls[0].command, 'codex resume c1');
  });
  await check('repeating same request is idempotent', async () => { assert.ok((await launcher.create({ id: 'task1', cwd, nativeSession: c1 })).success); assert.equal(calls.length, 1); });
  await check('same task ID cannot change native identity', async () => assert.equal((await launcher.create({ id: 'task1', cwd, nativeSession: c2 })).success, false));
  await check('different native session in same cwd allowed', async () => assert.ok((await launcher.create({ id: 'task3', cwd, nativeSession: c2 })).success));
  await check('closed session restores to new task', async () => { live.delete('task1'); assert.ok((await launcher.create({ id: 'task4', cwd, nativeSession: c1 })).success); assert.equal(calls.at(-1).id, 'task4'); });
  await check('non-default account refuses fallback', async () => assert.equal((await launcher.create({ id: 'account', cwd, nativeSession: k1, account: { configDir: dir } })).success, false));
  await check('binding missing terminal rejected', async () => assert.rejects(launcher.bind('missing', k1)));
  live.set('shell', { command: 'powershell.exe', cwd });
  await check('binding wrong tool rejected', async () => assert.rejects(launcher.bind('shell', k1)));
  live.set('kimi', { command: 'kimi', cwd });
  await check('explicit matching binding succeeds', async () => assert.equal((await launcher.bind('kimi', k1)).id, 'k1'));
  await check('binding prevents second process', async () => assert.equal((await launcher.create({ id: 'kimi2', cwd, nativeSession: k1 })).success, false));
  for (let i = 0; i < 3; i++) await put(path.join(roots.codex, 'sessions', `duplicate-${i}.jsonl`), lines([meta('duplicate')]));
  await put(path.join(roots.codex, 'sessions', 'paged.jsonl'), lines([{ ...meta('paged'), payload: { ...meta('paged').payload, history_mode: 'paginated' } }]));
  await check('three duplicate IDs remain ambiguous', async () => assert.equal((await native.list(true)).some(x => x.id === 'duplicate'), false));
  await check('unsupported paginated identities are not guessed', async () => assert.equal((await native.list(true)).some(x => x.id === 'paged'), false));
  const indexed = new NativeSessions(roots, async (root, method, params) => {
    assert.equal(root, roots.codex);
    if (method === 'thread/list') return {data:[{id:'logical-thread',cwd:path.toNamespacedPath(cwd),name:'Indexed thread',updatedAt:10}]};
    assert.equal(method, 'thread/turns/list');
    assert.equal(params.threadId, 'logical-thread');
    assert.equal(params.itemsView, 'full');
    if (params.cursor) return {data:[{items:[{type:'userMessage',content:[{type:'text',text:'Earlier'}]}]}]};
    return {data:[{items:[{type:'userMessage',content:[{type:'text',text:'Question'}]},{type:'reasoning',text:'Hidden'},{type:'agentMessage',text:'Answer'}]}],nextCursor:'older'};
  });
  await check('indexed thread pages show both speakers with exact identity', async () => {
    const entry=(await indexed.list()).find(x=>x.id==='logical-thread');
    assert.equal(entry.cwd,cwd);
    const first=await indexed.prompts(entry);
    assert.deepEqual(first.items.map(x=>[x.role,x.text]),[['assistant','Answer'],['user','Question']]);
    assert.equal((await indexed.prompts(entry,first.next)).items[0].text,'Earlier');
    assert.ok((await indexed.prompts({...entry,cwd:dir})).error);
  });
  // Multibyte records spanning the 2 MiB page boundary must not disappear or duplicate.
  const expected = Array.from({ length: 240 }, (_, i) => `${i}:` + '中文'.repeat(2200));
  await put(codexFile, lines([meta('c1'), ...expected.map(prompt)]));
  let page = await native.prompts(c1), cursor = page.next, collected = [...page.items];
  for (let n = 0; cursor && n < 10; n++) { page = await native.prompts(c1, cursor); assert.equal(page.error, undefined); collected.push(...page.items); cursor = page.next; }
  await check('UTF-8 paging crosses boundaries without loss', () => assert.deepEqual(collected.map(x => x.text), expected.reverse()));
  page = await native.prompts(c1); const oldCursor = page.next;
  await fs.appendFile(codexFile, lines([prompt('appended')]));
  await check('changed file invalidates page cursor', async () => assert.ok((await native.prompts(c1, oldCursor)).error));
  await check('cursor cannot cross identities', async () => assert.ok((await native.prompts(c2, oldCursor)).error));
  await put(path.join(cwd, 'hello.txt'), 'hello'); await put(path.join(cwd, '.hidden'), 'hidden'); await fs.mkdir(path.join(cwd, 'sub'));
  await check('file browser lists bounded project', async () => { const l = await listProjectFiles(cwd); assert.ok(l.entries.some(x => x.name === 'hello.txt')); assert.equal(l.entries.some(x => x.name === '.hidden'), false); });
  await check('hidden files require opt-in', async () => assert.ok((await listProjectFiles(cwd, '', true)).entries.some(x => x.name === '.hidden')));
  await check('parent traversal rejected', async () => assert.ok((await listProjectFiles(cwd, '..')).error));
  await fs.symlink(dir, path.join(cwd, 'outside'), 'junction');
  await check('junction escape rejected', async () => assert.ok((await listProjectFiles(cwd, 'outside')).error));
  await fs.symlink(cwd, path.join(cwd, 'loop'), 'junction');
  await check('directory links flagged; no recursive cycles', async () => assert.ok((await listProjectFiles(cwd)).entries.find(x => x.name === 'loop').link));
  await check('closed tasks, native IDs and folder pins survive reload', () => {
    const normalized = normalizeState({ tasks: [{ id: 'retained', groupId: 'codex', cwd, createdAt: 1, closedAt: 2, nativeSession: c1, futureField: 'keep' }], folders: [{ path: cwd, isExpanded: true, pinned: true, futureField: 'keep' }] }, cwd);
    assert.equal(normalized.tasks[0].status, 'stopped'); assert.equal(normalized.tasks[0].closedAt, 2); assert.equal(normalized.tasks[0].nativeSession.id, 'c1'); assert.equal(normalized.tasks[0].futureField, 'keep'); assert.equal(normalized.folders[0].pinned, true); assert.equal(normalized.folders[0].futureField, 'keep');
  });
  const payloadFile = path.join(roots.codex, 'sessions', '2026', '11', '21', 'rollout-2026-11-21T10-00-00-p1.jsonl');
  await put(payloadFile, lines([meta('p1'), prompt('hello small')]));
  await check('small codex rollout reports ok level with zero compacts', async () => {
    const res = await readCodexPayloads([{ taskId: 't1', sessionId: 'p1' }], roots.codex);
    assert.equal(res.t1?.level, 'ok');
    assert.equal(res.t1?.compacts, 0);
    assert.equal(res.t1?.images, 0);
  });
  const compactedFile = path.join(roots.codex, 'sessions', '2026', '11', '21', 'rollout-2026-11-21T10-01-00-p2.jsonl');
  const preCompactBig = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'data:image/png;base64,' + 'A'.repeat(200000) }] } };
  await put(compactedFile, lines([meta('p2'), preCompactBig, preCompactBig, { type: 'compacted', payload: { message: 'summary' } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'data:image/jpeg;base64,after' }] } }]));
  await check('compacted codex rollout resets active bytes and image count', async () => {
    const res = await readCodexPayloads([{ taskId: 't2', sessionId: 'p2' }], roots.codex);
    assert.equal(res.t2?.compacts, 1);
    assert.equal(res.t2?.images, 1);
    assert.equal(res.t2?.level, 'ok');
    assert.ok(res.t2.fileBytes > res.t2.activeBytes);
  });
  await fs.appendFile(compactedFile, lines(Array.from({ length: 10 }, () => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'data:image/png;base64,extra' }] } }))));
  await check('incremental append updates cached payload to danger', async () => {
    const m = await measureCodexRolloutFile(compactedFile);
    assert.equal(m?.images, 11);
    assert.equal(m?.level, 'danger');
  });
  await check('invalid, missing or escaped codex payload requests are omitted', async () => {
    const res = await readCodexPayloads([
      { taskId: 'bad1', sessionId: '../escape' },
      { taskId: 'bad2', sessionId: 'missing-id' },
      { taskId: 'bad3', sessionId: 'p1', storageRoot: 'relative/path' },
    ], roots.codex);
    assert.deepEqual(res, {});
  });
  await check('standalone codex.exe takes priority over PATH', async () => {
    const base = path.join(dir, 'codex-bin-standalone');
    const localAppData = path.join(base, 'localappdata');
    const standaloneExe = path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
    const pathDir = path.join(base, 'path-bin');
    await put(standaloneExe, 'standalone');
    await put(path.join(pathDir, 'codex.exe'), 'path-exe');
    const resolved = resolveCodexExecutable({ LOCALAPPDATA: localAppData, PATH: pathDir, Path: pathDir }, 'win32', 'x64');
    assert.equal(resolved, standaloneExe);
  });
  await check('direct codex.exe on PATH resolves when standalone install is absent', async () => {
    const base = path.join(dir, 'codex-bin-path');
    const pathExe = path.join(base, 'bin', 'codex.exe');
    await put(pathExe, 'direct');
    const resolved = resolveCodexExecutable({ LOCALAPPDATA: path.join(base, 'missing'), PATH: path.dirname(pathExe), Path: path.dirname(pathExe) }, 'win32', 'x64');
    assert.equal(resolved, pathExe);
  });
  await check('npm codex.cmd on PATH resolves bundled x64 and hoisted arm64 native codex.exe', async () => {
    const base = path.join(dir, 'codex-bin-npm');
    const npmDir = path.join(base, 'npm');
    await put(path.join(npmDir, 'codex.cmd'), '@echo off');
    const x64Exe = path.join(npmDir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    await put(x64Exe, 'x64');
    assert.equal(resolveCodexExecutable({ LOCALAPPDATA: base, PATH: npmDir, Path: npmDir }, 'win32', 'x64'), x64Exe);
    const arm64Exe = path.join(npmDir, 'node_modules', '@openai', 'codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe');
    await put(arm64Exe, 'arm64');
    assert.equal(resolveCodexExecutable({ LOCALAPPDATA: base, PATH: npmDir, Path: npmDir }, 'win32', 'arm64'), arm64Exe);
  });
  await check('APPDATA npm fallback resolves bundled codex.exe when PATH has no codex', async () => {
    const base = path.join(dir, 'codex-bin-appdata');
    const appData = path.join(base, 'roaming');
    const bundledExe = path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    await put(bundledExe, 'appdata');
    assert.equal(resolveCodexExecutable({ LOCALAPPDATA: base, APPDATA: appData, PATH: path.join(base, 'empty'), Path: path.join(base, 'empty') }, 'win32', 'x64'), bundledExe);
  });
  await check('resolveCodexExecutable falls back per platform when no binary exists', () => {
    const emptyEnv = { LOCALAPPDATA: path.join(dir, 'none'), APPDATA: path.join(dir, 'none'), PATH: '', Path: '' };
    assert.equal(resolveCodexExecutable(emptyEnv, 'win32', 'x64'), 'codex.exe');
    assert.equal(resolveCodexExecutable(emptyEnv, 'darwin', 'arm64'), 'codex');
  });
  await check('local path extraction and resolution support spaces, CJK, folders, lines, file URIs and relative paths', async () => {
    clearLocalPathCache();
    const spaceDir = path.join(dir, 'My Folder', '文档 目录');
    const docFile = path.join(spaceDir, 'doc report.md');
    const relSubDir = path.join(cwd, 'sub dir');
    const relFile = path.join(relSubDir, 'notes.txt');
    await put(docFile, '# report');
    await put(relFile, 'notes');

    const proseLine = `Saved to ${docFile} successfully and visit https://example.com/a/b.md`;
    const proseCands = extractLocalPathCandidates(proseLine);
    assert.equal(proseCands.some(c => c.raw.includes('example.com')), false);
    const proseRes = await resolveLocalPaths(cwd, proseCands.map(c => c.raw));
    const docHit = proseRes.find(Boolean);
    assert.ok(docHit);
    assert.equal(docHit.kind, 'file');
    assert.equal(docHit.target, path.resolve(docFile));
    assert.equal(docHit.matchedLength, docFile.length);

    const dirLine = `Folder: ${spaceDir}, next`;
    const dirCands = extractLocalPathCandidates(dirLine);
    const dirRes = await resolveLocalPaths(cwd, dirCands.map(c => c.raw));
    const dirHit = dirRes.find(Boolean);
    assert.ok(dirHit);
    assert.equal(dirHit.kind, 'dir');
    assert.equal(dirHit.target, path.resolve(spaceDir));
    assert.equal(dirHit.matchedLength, spaceDir.length);

    const lineColStr = `${docFile}:42:3`;
    const lineCands = extractLocalPathCandidates(lineColStr);
    const lineRes = await resolveLocalPaths(cwd, lineCands.map(c => c.raw));
    assert.equal(lineRes[0]?.kind, 'file');
    assert.equal(lineRes[0]?.line, 42);
    assert.equal(lineRes[0]?.matchedLength, lineColStr.length);

    const uriStr = `${require('node:url').pathToFileURL(docFile).href}#L12`;
    const uriCands = extractLocalPathCandidates(`Open ${uriStr}`);
    const uriRes = await resolveLocalPaths(cwd, uriCands.map(c => c.raw));
    assert.equal(uriRes[0]?.kind, 'file');
    assert.equal(uriRes[0]?.target, path.resolve(docFile));
    assert.equal(uriRes[0]?.line, 12);

    const relCands = extractLocalPathCandidates('Look at "sub dir/notes.txt" and ./sub_plain');
    const relPlainDir = path.join(cwd, 'sub_plain');
    await fs.mkdir(relPlainDir, { recursive: true });
    const relRes = await resolveLocalPaths(cwd, relCands.map(c => c.raw));
    const hitTargets = relRes.filter(Boolean).map(x => `${x.kind}:${x.target}`);
    assert.ok(hitTargets.includes(`file:${path.resolve(relFile)}`));
    assert.ok(hitTargets.includes(`dir:${path.resolve(relPlainDir)}`));

    const dirOnlyCands = extractLocalPathCandidates('Check ./sub\\dir');
    assert.equal(dirOnlyCands.length, 1);

    const uncOrMissing = await resolveLocalPaths(cwd, ['\\\\server\\share\\file.txt', path.join(dir, 'does-not-exist.md')]);
    assert.deepEqual(uncOrMissing, [null, null]);
  });
  const report = { checks, passed: checks.filter(x => x.ok).length, total: checks.length };
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ directory: dir, ...report }, null, 2));
  process.exitCode = checks.every(x => x.ok) ? 0 : 1;
}
run().catch(e => { console.error(e); process.exitCode = 1; });
