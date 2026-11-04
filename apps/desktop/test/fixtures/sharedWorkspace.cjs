const {app,BrowserWindow}=require('electron');
const {readFileSync,mkdtempSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const esbuild=require('esbuild');
app.setPath('userData',mkdtempSync(join(tmpdir(),'adcode-shared-ui-')));
app.whenReady().then(async()=>{
 console.log('Shared workspace fixture: ready');
 const win=new BrowserWindow({show:false,width:1140,height:840,webPreferences:{backgroundThrottling:false}});
 try {
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  console.log('Shared workspace fixture: browser ready');
  const renderer=resolve(__dirname,'../../src/renderer');
  const css=[...readFileSync(join(renderer,'main.ts'),'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)].map(m=>readFileSync(join(renderer,'styles',m[1]),'utf8')).join('\n');
  const script=esbuild.buildSync({stdin:{contents:"export {createSharedWorkspacePanel} from './collab/sharedWorkspacePanel.ts'",resolveDir:renderer},bundle:true,write:false,format:'iife',globalName:'Fixture'}).outputFiles[0].text;
  console.log('Shared workspace fixture: bundled');
  const result=await win.webContents.executeJavaScript(`(async()=>{
   ${script}
   // about:blank lacks secure-context UUIDs; ADCode's app:// origin is secure.
   if(!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{value:()=>Math.random().toString(36).slice(2)});
   Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});
   document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}})); document.documentElement.dataset.theme='dark';
   const pause=()=>new Promise(r=>setTimeout(r,100)), result={};
   let snap={id:'a'.repeat(64),name:'Aurora',repository:'team/aurora',ownerId:'owner',selfId:'owner',archived:false,memberCount:2,memberLimit:3,invite:'adproject:demo',liveInvite:null,selectedSession:'s1',hasOlder:false,members:[{uid:'owner',name:'Alex',messages:1,sessions:1},{uid:'guest',name:'Sam',messages:1,sessions:0}],sessions:[{id:'s1',title:'Launch planning',pending:false}],messages:[{seq:1,id:'m1',sessionId:'s1',authorId:'guest',authorName:'Sam',kind:'member',text:'<img src=x onerror=alert(1)>',at:Date.now()}]};
   let changed, calls=[];
   window.adcode={account:{onChanged:()=>()=>{}},clipboard:{writeText:async()=>{}},collab:{sharedLibrary:async()=>({projects:[snap],limits:{plan:'free',projects:1,members:3},owned:1}),sharedSnapshot:async(id,session)=>({...structuredClone(snap),selectedSession:session??snap.selectedSession}),sharedSession:async()=>{snap.sessions.push({id:'s2',title:'Build preview',pending:false}); snap.selectedSession='s2';return structuredClone(snap);},sharedMessage:async(id,session,text,ask,nonce)=>{calls.push({text,ask,nonce});snap.messages.push({seq:snap.messages.length+1,id:nonce,sessionId:session,authorId:'owner',authorName:'Alex',kind:'member',text,at:Date.now()});return structuredClone(snap);},sharedManage:async()=>{},onSharedChanged:cb=>{changed=cb;return()=>{};}}};
   const panel=Fixture.createSharedWorkspacePanel({prompt:async()=> 'Build preview',confirm:async()=>true,signIn:()=>{},openLocalProjects:()=>{}}); panel.open(); await pause();
   const find=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
   result.loaded=document.body.textContent.includes('1/1 owned projects')&&document.querySelectorAll('.shared-sessions button').length===1;
   result.safe=!document.querySelector('.shared-message img')&&document.querySelector('.shared-message-text').textContent.includes('<img');
   const input=document.querySelector('.shared-composer textarea');input.value='Keep my draft'; input.dispatchEvent(new Event('input')); input.focus(); changed(snap.id); await pause();
   result.draft=input===document.querySelector('textarea')&&input.value==='Keep my draft'&&document.activeElement===input;
   find('Send to team').click();await pause();result.team=calls[0].ask===false&&input.value==='';
   input.value='Please review'; input.dispatchEvent(new Event('input'));find('Ask AI').click();await pause(); result.ask=calls[1].ask===true&&calls[0].nonce!==calls[1].nonce;
   find('New session').click();await pause();result.session=document.querySelectorAll('.shared-sessions button').length===2;
   snap.messages.push({seq:4,id:'reply',sessionId:'s2',authorId:'guest',authorName:'Assistant',kind:'assistant',text:'Ready for the team.',at:Date.now()}); changed(snap.id);await pause();
   result.sharedReply=document.body.textContent.includes('Ready for the team.')&&document.body.textContent.includes('Assistant · via Sam');
   snap.selfId='guest';changed(snap.id);await pause();find('Leave project').click();await pause();result.leave=!document.querySelector('.shared-sessions button')&&!document.querySelector('.shared-member')&&document.querySelector('.shared-composer').hidden;
   snap.selfId='owner';panel.open(snap.id);await pause(); window.testPanel=panel; return result;
  })()`);
  writeFileSync(resolve(__dirname,'../../../../output/shared-projects-panel.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(420,780);await new Promise(r=>setTimeout(r,200));
  result.narrow=await win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.shared-workspace'),m=document.querySelector('.shared-main'),button=[...m.querySelectorAll('button')].find(b=>b.textContent==='Send to team');m.scrollTop=m.scrollHeight;const box=button.getBoundingClientRect(),area=m.getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1&&m.scrollWidth<=m.clientWidth+1&&box.bottom<=area.bottom&&box.top>=area.top;})()`);
  writeFileSync(resolve(__dirname,'../../../../output/shared-projects-panel-narrow.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(1140,840);
  Object.assign(result,await win.webContents.executeJavaScript(`(async()=>{
    const nav=document.createElement('aside'),host=document.createElement('section');
    const layout=document.createElement('main');layout.style.cssText='display:grid;grid-template-columns:272px 1fr;height:100vh;background:var(--bg-app);color:var(--text-primary)';
    nav.style.cssText='padding:20px;background:var(--bg-elevated);border-right:1px solid var(--border-hairline)';
    const brand=document.createElement('h2');brand.textContent='ADCode';nav.append(brand);layout.append(nav,host);document.body.append(layout);
    window.testPanel.mount(host,nav,()=>{});await new Promise(r=>setTimeout(r,100));window.testPanel.open();await new Promise(r=>setTimeout(r,100));
    return {inline:host.contains(document.querySelector('.shared-main'))&&!host.hidden,grouped:nav.querySelectorAll('.shared-project-group').length===1&&nav.querySelectorAll('.shared-history-row').length===2,beta:host.textContent.includes('Beta')&&nav.textContent.includes('Beta')};
  })()`));
  await win.webContents.executeJavaScript(`(()=>{const body=document.querySelector(".shared-message-text");if(body)body.textContent="Can you review the dark mode changes before we merge?";})()`);
  writeFileSync(resolve(__dirname,'../../../../output/shared-project-main-chat.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(result));app.exit(Object.values(result).every(Boolean)?0:1);
 }catch(error){console.error(error);app.exit(1);}
});
