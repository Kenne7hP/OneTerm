const fs = require('node:fs');

const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  if (!process.argv[2]) {
    const executable = path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe');
    const dir = fs.mkdtempSync(path.resolve('.tmp', 'agy project '));
    const profile = path.join(dir, 'profile');
    fs.mkdirSync(profile);
    const bundle = path.join(dir, 'manager.cjs');
    await require('esbuild').build({entryPoints:['src/main/pty-manager.ts'], bundle:true,
      platform:'node', format:'cjs', external:['node-pty','electron'], outfile:bundle});
    const env = {...process.env, HOME:profile, USERPROFILE:profile,
      LOCALAPPDATA:path.join(profile,'Local'), APPDATA:path.join(profile,'Roaming'),
      Path:path.dirname(executable) + path.delimiter + process.env.Path, ELECTRON_RUN_AS_NODE:'1'};
    const result = spawnSync(require('electron'), [__filename, bundle, executable], {cwd:dir, env, stdio:'inherit', timeout:40000});
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }
  const pty = require('node-pty');
  const original = pty.spawn;
  let started;
  pty.spawn = function(file,args,options) {
    const session = original(file,args,options);
    started = {file,cwd:options.cwd,args,pid:session.pid};
    return session;
  };
  const {PtyManager} = require(process.argv[2]);
  const manager = new PtyManager();
  try {
    const result = manager.createSession({id:'agy-smoke', command:'agy', cwd:process.cwd()});
    if (!result.success) throw new Error(result.error);
    if (started.file.toLowerCase() !== process.argv[3].toLowerCase() || started.cwd !== process.cwd() || started.args.length) throw new Error('Unexpected launch arguments');
    for (let i=0;i<100;i++) {
      await new Promise(resolve=>setTimeout(resolve,200));
      const screen = manager.getSessionBuffer('agy-smoke').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
      if (/sign in|log in|authenticate|welcome|trust this|select.*theme/i.test(screen)) {
        console.log('PASS: installed agy displayed its interactive startup screen in the selected test directory.');
        return;
      }
    }
    throw new Error('Interactive startup screen was not recognized');
  } finally {
    manager.destroyAll();
    if (started) {
      let exited = false;
      for (let i = 0; i < 50; i++) {
        try { process.kill(started.pid, 0); }
        catch (error) { if (error.code !== 'ESRCH') throw error; exited = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!exited) throw new Error('agy remained alive after terminal teardown');
    }
  }
}

main().then(()=>process.exit(process.exitCode ?? 0),error=>{console.error(error);process.exit(1);});
