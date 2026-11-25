import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import config from '../tailwind.config.js';
import { spawn } from 'node:child_process';
import electron from 'electron';

const dir = await fs.mkdtemp(path.resolve('.tmp/local-ui-'));
await fs.copyFile('public/oneterm-icon.png', path.join(dir, 'oneterm-icon.png'));
await fs.copyFile('public/antigravity-logo.svg', path.join(dir, 'antigravity-logo.svg'));
await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { syncTerminalViewport, attachTerminalWheelGuard } from './src/renderer/src/components/TerminalViewport';
localStorage.clear();
localStorage.setItem('onedesktop_settings', JSON.stringify({ language:'zh-CN', onboardingDone:true, theme:'dark', restoreWorkspace:false }));
window.calls=[];window.killed=[];window.desktopCalls=[];window.desktopInstalled=true;window.openedLocalPaths=[];
window.__xtermScrollTest = { Terminal, FitAddon, syncTerminalViewport, attachTerminalWheelGuard };
const ref={tool:'codex',id:'fixture-native',cwd:'C:/synthetic/project',storageRoot:'C:/synthetic/codex'};
const tasks=[{id:'old-task',groupId:'codex',title:'Task 1',cwd:ref.cwd,status:'running',createdAt:1},{id:'old-bound',groupId:'codex',title:'Confirmed history',cwd:ref.cwd,status:'running',createdAt:2,closedAt:3,nativeSession:ref}];
tasks.push({...tasks[1],id:'saved-bound',title:'Saved bound task',closedAt:undefined});
const agyRef={tool:'agy',id:'fixture-agy',cwd:ref.cwd,storageRoot:'C:/synthetic/antigravity-cli'};
tasks.push({id:'old-agy',groupId:'agy',title:'Task 77',cwd:ref.cwd,status:'stopped',createdAt:4});
const initial={v2:{tasks,folders:[{path:ref.cwd,isExpanded:true,pinned:true},{path:'C:/synthetic/empty',isExpanded:true}],activeTaskId:'old-task',lastFolder:ref.cwd,extraClis:[]}};
const noop=()=>()=>{};
window.buffers={};
const dataListeners=new Set();
window.emitData=(id,data)=>dataListeners.forEach(fn=>fn({id,data}));
window.electronAPI={
 detectAntigravityDesktop:async()=>({installed:window.desktopInstalled,version:window.desktopInstalled?'2.32.1':undefined,projectOpen:'manual'}),
 openAntigravityDesktop:async cwd=>{window.desktopCalls.push(cwd);return {success:true,clipboardCopied:true,projectOpened:false};},
 getHomeDir:()=> 'C:/synthetic', loadWorkspaceState:()=>JSON.stringify(initial),saveWorkspaceState:s=>window.saved=JSON.parse(s),
 getAllQuotas:async()=>({}), onQuotaUpdate:noop,onSystemStats:noop,onSessionData:cb=>{dataListeners.add(cb);return ()=>dataListeners.delete(cb);},onSessionExit:noop,
 isWindowMaximized:async()=>false,onWindowMaximizedChange:noop,setLanguage:async()=>{},
 detectClis:async()=>[{id:'agy',name:'Antigravity CLI',command:'agy'},{id:'codex',name:'Codex',command:'codex'},{id:'kimi',name:'Kimi Code',command:'kimi'}],
 getGitBranches:async()=>({}),getTaskSummaries:async()=>({}),
 getCodexPayloads:async(reqs)=>Object.fromEntries((reqs||[]).map(r=>[r.taskId,r.sessionId==='fixture-native'?{estMb:5.1,fileMb:9.8,activeBytes:5065000,fileBytes:9800000,images:22,compacts:0,level:'danger',updatedAt:Date.now()}:{estMb:0.3,fileMb:0.4,activeBytes:265000,fileBytes:400000,images:0,compacts:0,level:'ok',updatedAt:Date.now()}])),
 createSession:async options=>{window.calls.push(options);return {success:true,buffer:'Synthetic terminal',nativeSession:options.newCodexTitle ? {...ref,id:'new-session-id'} : undefined};},
 getSessionBuffer:async id=>window.buffers[id]??(id.startsWith('agy-')?'':'Synthetic terminal preview — no model call.\\r\\n› 校核侧栏任务名称'),resizeSession:async()=>{},writeSession:async()=>true,killSession:async id=>{window.killed.push(id);},
 listNativeSessions:async()=>[{...agyRef,title:'Past Antigravity task',updatedAt:1},{...ref,title:'Confirmed fixture',updatedAt:Date.now()}],
 listProjectFiles:async(root,relative='',hidden=false)=>({directory:relative,entries:[{name:'README.md',path:'README.md',directory:false,link:false},{name:'src',path:'src',directory:true,link:false},{name:'blocked-link',path:'blocked-link',directory:false,link:true}],partial:false}),
 readPreviewFile:async(_cwd,p)=>({kind:'text',path:p||'README.md',size:25,content:'# Synthetic project'}),
 resolveLocalPaths:async(_cwd,cands)=>cands.map(raw=>raw.startsWith('D:/My Folder/sub dir')?{target:'D:/My Folder/sub dir',kind:'dir',matchedLength:'D:/My Folder/sub dir'.length}:raw.startsWith('D:/My Folder/doc report.md')?{target:'D:/My Folder/doc report.md',kind:'file',matchedLength:'D:/My Folder/doc report.md'.length}:null),
 openLocalPath:async p=>{window.openedLocalPaths.push(p);return true;},
 readPromptHistory:async (requested,cursor)=>cursor ? {conversation:true,items:[{role:'user',text:'Earlier fixture question',truncated:false}]} : ({conversation:true,next:'older',items:requested.id===agyRef.id ? [{role:'assistant',text:'Synthetic Antigravity reply',truncated:false}] : requested.id===ref.id && requested.tool===ref.tool && requested.storageRoot===ref.storageRoot ? [{role:'assistant',text:'Synthetic Codex answer',truncated:false},{role:'user',text:'Build a clean project workbench',truncated:false}] : [],partial:false}),
 bindNativeSession:async(id,entry)=>entry,writeClipboardText:async()=>true,openDirectory:async()=>true,
 selectWorkspaceDirectory:async()=>ref.cwd,
};
import('./src/renderer/src/App').then(({App})=>createRoot(document.getElementById('root')).render(<App/>));
` }, bundle: true, platform: 'browser', outfile: path.join(dir, 'fixture.js') });
const css = await postcss([tailwind(config)]).process(await fs.readFile('src/renderer/src/index.css', 'utf8'), { from: 'src/renderer/src/index.css' });
await fs.writeFile(path.join(dir, 'fixture.css'), css.css + await fs.readFile('node_modules/@xterm/xterm/css/xterm.css', 'utf8'));
await fs.writeFile(path.join(dir, 'fixture.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await fs.writeFile(path.join(dir, 'harness.cjs'), `
const {app,BrowserWindow}=require('electron');const fs=require('fs');const path=require('path');
app.setPath('userData',path.join(__dirname,'profile')); const errors=[];const checks=[];
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
 const run=code=>win.webContents.executeJavaScript(code);const pause=ms=>new Promise(r=>setTimeout(r,ms));
 try{
 await win.loadFile(path.join(__dirname,'fixture.html'));win.showInactive();await pause(1800);
 checks.push(...await run(\`(async()=>{const c=[];const check=(name,ok)=>c.push({name,ok}); const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const button=text=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===text);
 check('startup never launches old tasks',window.calls.length===0);
 const clickSaved=title=>document.querySelector('#oneai-sidebar button[title^="'+title+'"]')?.click();
 const oldClosed=[...document.querySelectorAll('[data-closed-tasks] button')].find(x=>x.textContent.includes('Confirmed history'));
 check('closed task visible in sidebar on load',oldClosed?.getBoundingClientRect().height>0);
 oldClosed?.click();await wait(350);
 check('closed task can be inspected without relaunch or reopening',document.querySelector('.workbench-panel')?.innerText.includes('Build a clean project workbench') && window.saved.v2.tasks.find(x=>x.id==='old-bound')?.closedAt===3 && window.calls.length===0);
 clickSaved('Saved bound task');await wait(350);
 check('opening saved bound task shows its recorded prompt without launch',document.querySelector('.workbench-panel')?.innerText.includes('Build a clean project workbench') && window.saved.v2.activeTaskId==='saved-bound' && window.calls.length===0);
 const dangerPill=document.querySelector('[data-codex-payload][data-payload-level="danger"]');
 const sidebarDanger=document.querySelector('[data-task-id="saved-bound"] [data-task-payload="danger"]');
 check('codex danger payload pill and sidebar badge render for heavy bound task',!!dangerPill && dangerPill.innerText.includes('5.1 MB') && dangerPill.innerText.includes('22图') && dangerPill.innerText.includes('请立即 /compact') && !!sidebarDanger && sidebarDanger.textContent?.trim()==='5.1M');
 const reader=document.querySelector('[aria-label="历史对话"]');
 check('saved conversation fills main area and shows question before answer',!!reader && reader.getBoundingClientRect().width>600 && reader.innerText.indexOf('Build a clean project workbench')<reader.innerText.indexOf('Synthetic Codex answer') && !reader.querySelector('details'));
 button('加载更早消息')?.click();await wait(200);
 check('older page prepends above existing messages',reader?.innerText.includes('Earlier fixture question') && reader.innerText.indexOf('Earlier fixture question')<reader.innerText.indexOf('Build a clean project workbench'));
 button('继续此对话')?.click();await wait(150);
 check('continue targets saved identity',document.querySelector('[role=dialog]')?.innerText.includes('fixture-native'));
 button('取消')?.click();await wait(150);
 clickSaved('Task 1');await wait(350);
 check('opening unbound task offers history without automatic association',document.querySelector('.workbench-panel input')?.placeholder==='搜索会话编号、标题或目录' && window.saved.v2.activeTaskId==='old-task' && !window.saved.v2.tasks.find(x=>x.id==='old-task').nativeSession && window.calls.length===0);
 button('查看对话')?.click();await wait(250);
 check('conversation opens inside One without starting a terminal',document.querySelector('.workbench-panel')?.innerText.includes('Synthetic Codex answer') && document.querySelector('.workbench-panel')?.innerText.includes('Build a clean project workbench') && window.calls.length===0);
 button('项目文件')?.click();button('文件与历史')?.click();await wait(200);
 check('project-first navigation rendered',document.body.innerText.includes('当前项目'));
 check('desktop logo asset loads',[...document.images].some(x=>x.src.includes('antigravity-logo.svg') && x.complete && x.naturalWidth>0));
 check('empty pinned project retained',window.saved.v2.folders.length===2 && window.saved.v2.folders[0].pinned);
 const desktopButton=()=>document.querySelector('button[title="打开 Antigravity 桌面端"]');
 const originalTask=window.saved.v2.activeTaskId;const originalCount=window.saved.v2.tasks.length;
 desktopButton()?.click();await wait(150);
 check('desktop confirmation explains copy and manual project selection',document.body.innerText.includes('将复制项目目录 C:/synthetic/project') && document.body.innerText.includes('不会自动打开项目或创建会话'));
 button('取消')?.click();await wait(150);
 check('cancel never opens desktop',window.desktopCalls.length===0);
 desktopButton()?.click();desktopButton()?.click();await wait(150);
 button('复制路径并打开')?.click();button('复制路径并打开')?.click();await wait(200);
 check('double desktop confirmation opens once with exact project',window.desktopCalls.length===1 && window.desktopCalls[0]==='C:/synthetic/project');
 check('desktop success does not claim project opened',document.body.innerText.includes('已发送桌面启动请求') && document.body.innerText.includes('会话与额度仍未接通'));
 document.querySelector('[role=dialog] button.btn-primary')?.click();await wait(150);
 check('desktop creates no task or terminal and preserves selection',window.calls.length===0 && window.saved.v2.activeTaskId===originalTask && window.saved.v2.tasks.length===originalCount);
 button('Shell')?.click();await wait(300);
 if(window.calls.length===0) [...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith('Shell'))?.click();await wait(350);
 check('Shell launcher starts one task',window.calls.length===1 && /powershell/.test(window.calls[0].command));
 check('non-codex active task hides codex payload pill',!document.querySelector('[data-codex-payload]'));
 const launched=window.saved.v2.activeTaskId;
 const close=[...document.querySelectorAll('button')].find(x=>x.title==='关闭并终止此终端');close?.click();await wait(150);button('关闭并终止')?.click();await wait(350);
 check('close terminates terminal',window.killed.includes(launched));
 check('close retains task record',window.saved.v2.tasks.some(x=>x.id===launched && x.closedAt && x.status==='stopped'));
 button('文件与历史')?.click();await wait(300);
 check('files panel shows local entries',document.body.innerText.includes('README.md'));
 check('directory link is disabled',[...document.querySelectorAll('button')].some(x=>x.textContent.includes('blocked-link')&&x.disabled));
 clickSaved('Task 1');await wait(200);
 button('提示词历史')?.click();await wait(300);
 check('unconfirmed identity gates prompt reading',document.body.innerText.includes('会话身份未确认。'));
 button('恢复会话')?.click();await wait(300);
 // There can be both toolbar and tab buttons; target the auxiliary panel.
 [...document.querySelectorAll('.workbench-panel button')].find(x=>x.textContent.trim()==='恢复会话')?.click();await wait(350);
 const resume=[...document.querySelectorAll('.workbench-panel button')].find(x=>x.textContent.trim()==='恢复为新任务');resume?.click();resume?.click();await wait(200);
 check('restore asks about external process ownership',document.body.innerText.includes('其他应用或终端运行'));
 button('原进程已关闭，恢复')?.click();await wait(500);
 check('double restore starts once',window.calls.length===2);
 check('restore uses and persists confirmed native identity',window.calls[1]?.nativeSession?.id==='fixture-native' && window.saved.v2.tasks.find(x=>x.id===window.saved.v2.activeTaskId)?.nativeSession?.id==='fixture-native');
 check('restore creates new local task while retaining old',window.saved.v2.tasks.some(x=>x.id==='old-bound') && window.saved.v2.activeTaskId!=='old-bound');
 [...document.querySelectorAll('.workbench-panel button')].find(x=>x.textContent.trim()==='提示词历史')?.click();await wait(350);
 check('confirmed session shows prompts',document.body.innerText.includes('Build a clean project workbench'));
 [...document.querySelectorAll('.workbench-panel button')].find(x=>x.textContent.trim()==='工具连接')?.click();await wait(250);
 check('desktop installation distinct from unverified login quota and session',document.body.innerText.includes('桌面应用已检测到') && document.body.innerText.includes('登录、额度和会话连接尚未验证'));
 window.desktopInstalled=false;button('重新检测')?.click();await wait(250);
 check('missing desktop shows disabled launch',[...document.querySelectorAll('.workbench-panel button')].some(x=>x.textContent.trim()==='复制路径并打开'&&x.disabled) && document.body.innerText.includes('未找到 Antigravity 桌面应用'));
 window.desktopInstalled=true;button('重新检测')?.click();await wait(250);
 check('refresh discovers newly available desktop',document.body.innerText.includes('桌面应用已检测到'));
 clickSaved('Task 1');await wait(200);
 button('打开 Codex 原生会话选择器')?.click();await wait(350);
 check('explicit picker opens in original project without guessing an identity',window.calls.length===3 && window.calls[2].command==='codex resume' && window.calls[2].cwd==='C:/synthetic/project' && !window.calls[2].nativeSession);
 clickSaved('Task 1');await wait(200);
 button('关联到此任务')?.click();await wait(150);button('确认关联')?.click();await wait(300);
 check('explicit link persists on original stopped task and shows reply',window.saved.v2.tasks.find(x=>x.id==='old-task')?.nativeSession?.id==='fixture-native' && document.querySelector('.workbench-panel')?.innerText.includes('Synthetic Codex answer') && window.calls.length===3);
 clickSaved('Task 77');await wait(250);
 check('stopped Antigravity task shows matching history',document.querySelector('.workbench-panel')?.innerText.includes('Past Antigravity task'));
 button('查看对话')?.click();await wait(250);
 const agyReaderText=document.querySelector('[aria-label="历史对话"]')?.innerText||'';
 check('Antigravity transcript preview',agyReaderText.includes('Synthetic Antigravity reply') && agyReaderText.includes('Antigravity') && !agyReaderText.includes('Codex'));
 button('关联到此任务')?.click();await wait(150);button('确认关联')?.click();await wait(300);
 check('stopped Antigravity task adopts native title',window.saved.v2.tasks.some(x=>x.id==='old-agy' && x.nativeSession?.id==='fixture-agy' && x.title==='Past Antigravity task'));
 const agyButton=[...document.querySelectorAll('.workbench-launch-btn')].find(x=>x.textContent.trim()==='Antigravity CLI');
 agyButton?.click();await wait(250);
 check('CLI toolbar starts agy in selected project',window.calls.length===4 && window.calls[3].command==='agy' && window.calls[3].cwd==='C:/synthetic/project');
 [...document.querySelectorAll('.workbench-launch-btn')].find(x=>x.textContent.trim()==='Codex')?.click();await wait(250);
 check('new Codex task persists returned exact session ID',window.saved.v2.tasks.find(x=>x.id===window.saved.v2.activeTaskId)?.nativeSession?.id==='new-session-id' && window.saved.v2.tasks.find(x=>x.id===window.saved.v2.activeTaskId)?.historyId==='new-session-id');
 const terminalInput=[...document.querySelectorAll('.xterm-helper-textarea')].find(x=>x.getBoundingClientRect().width>0);
 terminalInput?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
 await wait(350);
 check('submitted prompt replaces generic sidebar title',document.querySelector('#oneai-sidebar')?.textContent.includes('校核侧栏任务名称') && window.saved.v2.tasks.find(x=>x.id===window.saved.v2.activeTaskId)?.title==='校核侧栏任务名称');
 const esc=String.fromCharCode(27), crlf=String.fromCharCode(13,10), rule='─'.repeat(24);
 const sendEnter=id=>document.querySelector('#terminal-'+CSS.escape(id)+' .xterm-helper-textarea')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
 const taskTitle=id=>window.saved.v2.tasks.find(x=>x.id===id)?.title;
 agyButton?.click();await wait(250);
 const agyId=window.saved.v2.activeTaskId;
 window.emitData(agyId,esc+'[2J'+esc+'[1;1H'+rule+crlf+'> Describe your next engineering task...'+crlf+rule+esc+'[2;3H');
 await wait(150);sendEnter(agyId);await wait(200);
 check('empty agy prompt with placeholder keeps generic title',/^[T]ask [0-9]+$/.test(taskTitle(agyId)||''));
 window.emitData(agyId,esc+'[2J'+esc+'[1;1H'+rule+crlf+'> /model'+crlf+rule+esc+'[2;9H');
 await wait(150);sendEnter(agyId);await wait(200);
 const afterSlash=/^[T]ask [0-9]+$/.test(taskTitle(agyId)||'');
 window.emitData(agyId,esc+'[2J'+esc+'[1;1H'+rule+crlf+'! dir'+crlf+rule+esc+'[2;6H');
 await wait(150);sendEnter(agyId);await wait(200);
 check('agy slash and shell commands keep generic title',afterSlash && /^[T]ask [0-9]+$/.test(taskTitle(agyId)||''));
 window.emitData(agyId,esc+'[2J'+esc+'[1;1H'+rule+esc+'[3;1H'+rule+esc+'[2;1H> 核对 Antigravity 侧栏任务名称');
 await wait(150);sendEnter(agyId);await wait(300);
 check('agy single-line prompt replaces generic sidebar title',document.querySelector('#oneai-sidebar')?.textContent.includes('核对 Antigravity 侧栏任务名称') && taskTitle(agyId)==='核对 Antigravity 侧栏任务名称');
 agyButton?.click();await wait(250);
 const agyId2=window.saved.v2.activeTaskId;
 window.emitData(agyId2,esc+'[2J'+esc+'[1;1H'+rule+esc+'[4;1H'+rule+esc+'[2;1H> 目前oneterm项目暂时不显示'+esc+'[3;1H  antigravity会话的任务名称');
 await wait(150);sendEnter(agyId2);await wait(300);
 check('agy wrapped prompt replaces generic sidebar title',document.querySelector('#oneai-sidebar')?.textContent.includes('目前oneterm项目暂时不显示 antigravity会话的任务名称') && taskTitle(agyId2)==='目前oneterm项目暂时不显示 antigravity会话的任务名称');
 clickSaved('校核侧栏任务名称');await wait(200);
 const codexScrollId=window.saved.v2.activeTaskId;
 let initialScrollChunk='';for(let i=1;i<=120;i++)initialScrollChunk+='Line '+i+crlf;
 window.emitData(codexScrollId,initialScrollChunk);await wait(150);
 const visibleTerm=()=>[...document.querySelectorAll('.xterm')].find(x=>x.getBoundingClientRect().height>0);
 const vpBefore=visibleTerm()?.querySelector('.xterm-viewport');
 const scrollHeightBeforeHide=vpBefore?.scrollHeight||0;
 clickSaved('Confirmed fixture');await wait(150);
 let hiddenScrollChunk='';for(let i=1;i<=10;i++)hiddenScrollChunk+='Hidden '+i+crlf;
 window.emitData(codexScrollId,hiddenScrollChunk);await wait(350);
 clickSaved('校核侧栏任务名称');await wait(200);
 const termAfter=visibleTerm();
 const vpAfter=termAfter?.querySelector('.xterm-viewport');
 const scrollHeightGrew=!!vpAfter && vpAfter.scrollHeight>scrollHeightBeforeHide;
 for(let i=0;i<4;i++){termAfter?.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,deltaMode:0,bubbles:true,cancelable:true}));await wait(35);}
 const appScrolledUp=!!vpAfter && vpAfter.scrollTop<vpAfter.scrollHeight-vpAfter.clientHeight-40;
 for(let i=0;i<30;i++){termAfter?.dispatchEvent(new WheelEvent('wheel',{deltaY:100,deltaMode:0,bubbles:true,cancelable:true}));await wait(25);}
 const appScrolledBackToBottom=!!vpAfter && vpAfter.scrollTop>=vpAfter.scrollHeight-vpAfter.clientHeight-2;
 check('app hidden terminal flush keeps scroll back to bottom after wheel up',scrollHeightGrew && appScrolledUp && appScrolledBackToBottom);
  {
   window.emitData(codexScrollId, crlf+'Open D:/My Folder/sub dir and D:/My Folder/doc report.md'+crlf);
   await wait(250);
   const termEl=visibleTerm();
   const screen=termEl?.querySelector('.xterm-screen');
   const host=termEl?.parentElement;
   const rect=screen?.getBoundingClientRect();
   const rows=[...document.querySelectorAll('#terminal-'+CSS.escape(codexScrollId)+' .xterm-rows > div')];
   let hitY=rect ? rect.bottom - 12 : 0;
   for(let i=0;i<rows.length;i++){
    if(rows[i].textContent?.includes('Open D:/My Folder/sub dir')){
     const rr=rows[i].getBoundingClientRect();
     if(rr.height>0){ hitY=rr.top+rr.height*0.5; break; }
    }
   }
   let dirX=null, fileX=null;
   if(rect && hitY>0){
    const rowStep=Math.max(10, Math.round(rect.height/30));
    const ys=[hitY];
    for(let y=rect.bottom-8;y>=rect.top+4 && ys.length<12;y-=rowStep) ys.push(y);
    for(const y of ys){
     for(let x=rect.left+12;x<=rect.left+Math.min(rect.width-8, 700);x+=18){
      screen.dispatchEvent(new MouseEvent('mousemove',{clientX:x,clientY:y,bubbles:true}));
      await wait(20);
      if(!dirX && host?.title==='单击打开文件夹'){ dirX={x,y}; }
      else if(!fileX && host?.title==='单击打开所在文件夹（Alt + 单击预览）'){ fileX={x,y}; }
      if(dirX && fileX) break;
     }
     if(dirX && fileX) break;
    }
   }
   if(dirX){
    screen.dispatchEvent(new MouseEvent('mousemove',{clientX:dirX.x,clientY:dirX.y,bubbles:true}));
    await wait(50);
    screen.dispatchEvent(new MouseEvent('mousedown',{clientX:dirX.x,clientY:dirX.y,button:0,bubbles:true}));
    screen.dispatchEvent(new MouseEvent('mouseup',{clientX:dirX.x,clientY:dirX.y,button:0,bubbles:true}));
    screen.dispatchEvent(new MouseEvent('click',{clientX:dirX.x,clientY:dirX.y,button:0,bubbles:true}));
    await wait(100);
   }
   if(fileX){
    screen.dispatchEvent(new MouseEvent('mousemove',{clientX:fileX.x,clientY:fileX.y,bubbles:true}));
    await wait(50);
    screen.dispatchEvent(new MouseEvent('mousedown',{clientX:fileX.x,clientY:fileX.y,button:0,bubbles:true}));
    screen.dispatchEvent(new MouseEvent('mouseup',{clientX:fileX.x,clientY:fileX.y,button:0,bubbles:true}));
    screen.dispatchEvent(new MouseEvent('click',{clientX:fileX.x,clientY:fileX.y,button:0,bubbles:true}));
    await wait(100);
    screen.dispatchEvent(new MouseEvent('mousedown',{clientX:fileX.x,clientY:fileX.y,button:0,altKey:true,bubbles:true}));
    screen.dispatchEvent(new MouseEvent('mouseup',{clientX:fileX.x,clientY:fileX.y,button:0,altKey:true,bubbles:true}));
    screen.dispatchEvent(new MouseEvent('click',{clientX:fileX.x,clientY:fileX.y,button:0,altKey:true,bubbles:true}));
    await wait(200);
   }
   const previewPanel=document.querySelector('aside[aria-label="文件预览"]');
   previewPanel?.querySelector('button[aria-label="在资源管理器中打开"]')?.click();
   await wait(100);
   document.querySelector('aside[aria-label="文件预览"] button[aria-label="关闭预览"]')?.click();
   await wait(100);
   check('direct click on terminal local paths opens folder and file location without Ctrl, Alt+click previews',
    !!dirX && !!fileX &&
    window.openedLocalPaths.includes('D:/My Folder/sub dir') &&
    window.openedLocalPaths.filter(p=>p==='D:/My Folder/doc report.md').length===2 &&
    !!previewPanel);
  }
 {
  const {Terminal,FitAddon,syncTerminalViewport,attachTerminalWheelGuard}=window.__xtermScrollTest;
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:0;top:0;width:800px;height:500px;z-index:9999;background:#000;';
  document.body.appendChild(host);
  const t=new Terminal({fontFamily:'Consolas, monospace',fontSize:15,lineHeight:1.3,scrollback:5000,allowProposedApi:true,windowsPty:{backend:'conpty',buildNumber:26200}});
  const fit=new FitAddon();
  t.loadAddon(fit);
  t.open(host);
  fit.fit();
  attachTerminalWheelGuard(t);
  let s1='';for(let i=1;i<=120;i++)s1+='Direct '+i+crlf;
  await new Promise(r=>t.write(s1,r));
  await wait(100);
  host.style.display='none';
  await wait(50);
  let s2='';for(let i=1;i<=8;i++)s2+='HiddenDirect '+i+crlf;
  await new Promise(r=>t.write(s2,r));
  await wait(120);
  host.style.display='block';
  syncTerminalViewport(t);
  await wait(80);
  for(let i=0;i<4;i++){t.element.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,deltaMode:0,bubbles:true,cancelable:true}));await wait(30);}
  const movedUp=t.buffer.active.viewportY<t.buffer.active.baseY;
  for(let i=0;i<30;i++){t.element.dispatchEvent(new WheelEvent('wheel',{deltaY:100,deltaMode:0,bubbles:true,cancelable:true}));await wait(20);}
  const backToBottomFromHidden=t.buffer.active.viewportY===t.buffer.active.baseY;
  t.scrollLines(-2);
  await wait(50);
  if(t._core?.viewport)t._core.viewport._ignoreNextScrollEvent=true;
  for(let i=0;i<6;i++){t.element.dispatchEvent(new WheelEvent('wheel',{deltaY:100,deltaMode:0,bubbles:true,cancelable:true}));await wait(20);}
  const backToBottomFromIgnoreLock=t.buffer.active.viewportY===t.buffer.active.baseY;
  t.dispose();
  host.remove();
  check('direct xterm hidden-flush sync restores scroll to bottom without resize',movedUp && backToBottomFromHidden);
  check('direct xterm wheel guard clears stale ignoreNextScrollEvent lock',backToBottomFromIgnoreLock);
 }
 return c;})()\`));
 for(const width of [900,1100,1280,1600]){
 win.setContentSize(width,800);await pause(300);
 checks.push(await run(\`({name:'layout '+innerWidth+' has no horizontal overflow',ok:document.documentElement.scrollWidth<=innerWidth})\`));
 checks.push(await run(\`(()=>{const r=document.querySelector('.workbench-panel').getBoundingClientRect();const t=[...document.querySelectorAll('.xterm')].map(x=>x.getBoundingClientRect()).find(x=>x.width>0);return {name:'terminal and panel usable at '+innerWidth,ok:r.width>=250 && r.height>=170 && t && t.width>=250 && t.height>=160,terminal:t&&{width:t.width,height:t.height},panel:{width:r.width,height:r.height}};})()\`));
 fs.writeFileSync(path.join(__dirname,'window-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await run("document.querySelector('button[aria-label=设置]').click()");await pause(200);
 checks.push(await run(\`(()=>{const dlg=document.querySelector('[role=dialog]');const tab=[...dlg.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='提醒');tab?.click();return {name:'settings reminders tab exists',ok:!!tab};})()\`));await pause(150);
 checks.push(await run(\`(()=>{const sw=document.querySelector('button[role=switch][aria-label=开启工作时长提醒]');const initialOff=sw?.getAttribute('aria-checked')==='false' && JSON.parse(localStorage.getItem('onedesktop_settings')).workReminderEnabled!==true;sw?.click();return {name:'work reminder defaults off and toggles on manually',ok:initialOff};})()\`));await pause(150);
 checks.push(await run(\`(()=>{const sw=document.querySelector('button[role=switch][aria-label=开启工作时长提醒]');const toggledOn=sw?.getAttribute('aria-checked')==='true' && JSON.parse(localStorage.getItem('onedesktop_settings')).workReminderEnabled===true;sw?.click();return {name:'work reminder persists manual toggle on and off',ok:toggledOn};})()\`));await pause(150);
 checks.push(await run(\`(()=>{const sw=document.querySelector('button[role=switch][aria-label=开启工作时长提醒]');const toggledOff=sw?.getAttribute('aria-checked')==='false' && JSON.parse(localStorage.getItem('onedesktop_settings')).workReminderEnabled===false;const noMusic=!document.querySelector('[role=group][aria-label=音乐播放器]') && !document.querySelector('[role=group][aria-label=在线音乐]') && !document.querySelector('button[role=switch][aria-label=显示音乐播放器]');[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='外观')?.click();return {name:'work reminder turns back off and music player UI is absent',ok:toggledOff && noMusic};})()\`));await pause(150);
 await run("[...document.querySelectorAll('[role=dialog] button')].find(x=>x.textContent.trim()==='浅色').click()");await pause(400);
 await run("document.querySelector('[role=dialog] button[aria-label=关闭]').click()");await pause(400);
 checks.push(await run("({name:'light theme changed through settings',ok:document.documentElement.dataset.theme==='light' && JSON.parse(localStorage.getItem('onedesktop_settings')).theme==='light'})"));fs.writeFileSync(path.join(__dirname,'window-light.png'),(await win.webContents.capturePage()).toPNG());
 checks.push({name:'no renderer errors',ok:errors.length===0});
 fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({directory:__dirname,checks,errors},null,2));app.exit(checks.every(x=>x.ok)?0:1);
 }catch(e){console.error(e);app.exit(1);}
});
`);
const child = spawn(electron, [path.join(dir, 'harness.cjs')], { windowsHide: true, stdio: 'inherit' });
process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
