// Team's "Connect this project to GitHub" card, drawn in Chromium the way the Vibe window draws it
// (the panel mounted inline, with openChat, so its status line starts in the hidden team strip).
const {app,BrowserWindow}=require('electron');
const {readFileSync,mkdtempSync,writeFileSync,mkdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const esbuild=require('esbuild');
app.setPath('userData',mkdtempSync(join(tmpdir(),'adcode-team-github-')));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1140,height:900,webPreferences:{backgroundThrottling:false}});
 const out=resolve(__dirname,'../../../../output');
 mkdirSync(out,{recursive:true});
 const shot=async name=>{ await new Promise(r=>setTimeout(r,700)); win.webContents.invalidate(); await new Promise(r=>setTimeout(r,200)); writeFileSync(join(out,name),(await win.webContents.capturePage()).toPNG()); };
 try {
  await win.loadURL('about:blank');
  const renderer=resolve(__dirname,'../../src/renderer');
  const css=[...readFileSync(join(renderer,'main.ts'),'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)].map(m=>readFileSync(join(renderer,'styles',m[1]),'utf8')).join('\n');
  const script=esbuild.buildSync({stdin:{contents:"export {createSharedWorkspacePanel} from './collab/sharedWorkspacePanel.ts'",resolveDir:renderer},bundle:true,write:false,format:'iife',globalName:'Fixture'}).outputFiles[0].text;
  const step=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const result={};
  await step(`
   ${script}
   if(!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{value:()=>Math.random().toString(36).slice(2)});
   document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}+'*,*::before{animation:none!important}'})); document.documentElement.dataset.theme='dark'; // a hidden window never advances animations
   const t=window.T={calls:[],state:'not-repo',projects:[],remote:null};
   const read=()=>{
     const folder='site-demo';
     if(t.state==='ready') return {state:'ready',folder,repository:'demo-owner/site-demo',remote:'origin',message:'Connected to github.com/demo-owner/site-demo.'};
     if(t.state==='not-repo') return {state:'not-repo',folder,message:'"site-demo" isn\\'t tracked by Git yet, so it has no GitHub repository to share. Press Start tracking, then connect it to a repository on GitHub.'};
     return {state:'no-remote',folder,message:'"site-demo" isn\\'t connected to GitHub yet. Make an empty repository on GitHub, then paste its address here and press Connect.'};
   };
   const snap={id:'b'.repeat(64),name:'site-demo',repository:'demo-owner/site-demo',ownerId:'me',selfId:'me',archived:false,memberCount:1,memberLimit:3,invite:'adproject:x',liveInvite:null,selectedSession:null,hasOlder:false,members:[{uid:'me',name:'Alex',messages:0,sessions:0}],sessions:[],messages:[]};
   window.open=(url)=>{t.calls.push('open:'+url);return null;};
   window.adcode={account:{onChanged:()=>()=>{}},clipboard:{writeText:async()=>{}},
     git:{init:async()=>{t.calls.push('init');t.state='no-remote';return {ok:true,message:'Initialised an empty repository.'};},trust:async()=>({ok:true,message:'ok'})},
     team:{state:async()=>({aiReplies:true})},
     collab:{sharedLibrary:async()=>({projects:t.projects,limits:{plan:'free',projects:1,members:3},owned:t.projects.length}),
       sharedGitHub:async()=>read(),
       sharedConnectGitHub:async(address)=>{t.calls.push('connect:'+address); if(/locked/.test(address)) throw new Error("Error invoking remote method 'shared-project:connect-github': Error: Git couldn't add the GitHub address: could not lock config file .git/config"); t.state='ready'; return read();},
       sharedCreate:async()=>{t.calls.push('create'); if(t.state!=='ready') throw new Error('not ready'); t.projects=[snap]; return snap;},
       sharedSnapshot:async()=>structuredClone(snap),onSharedChanged:()=>()=>{}}};
   const nav=document.createElement('aside'),host=document.createElement('section');
   const layout=document.createElement('main');layout.style.cssText='display:grid;grid-template-columns:272px 1fr;height:100vh;background:var(--bg-app);color:var(--text-primary)';
   nav.style.cssText='padding:20px;background:var(--bg-elevated);border-right:1px solid var(--border-hairline)';
   layout.append(nav,host);document.body.append(layout);
   const panel=Fixture.createSharedWorkspacePanel({prompt:async()=>null,confirm:async()=>true,signIn:()=>{},openLocalProjects:()=>{},openChat:async()=>'chat-1'});
   window.P=panel; panel.mount(host,nav,()=>{}); panel.open();
   await new Promise(r=>setTimeout(r,200));
  `);
  const pause='await new Promise(r=>setTimeout(r,150));';
  const visible="el=>!!el&&el.isConnected&&!el.hidden&&el.getClientRects().length>0";
  result.emptyState=await step(`return document.body.textContent.includes('Start a team chat');`);
  // 1. Share from the empty state: before 2.6.6 this wrote one sentence into the hidden strip.
  Object.assign(result,await step(`
   [...document.querySelectorAll('.team-option button')].find(b=>b.textContent==='Share this project').click(); ${pause}
   const card=document.querySelector('.team-connect');
   return {connectCard:card?.dataset.state==='not-repo'&&card.textContent.includes('Connect this project to GitHub')&&card.textContent.includes("isn't tracked by Git"),
     startTracking:!!document.querySelector('.team-connect-step[data-status="current"] button')&&document.querySelector('.team-connect-step[data-status="current"] button').textContent==='Start tracking',
     shareLocked:[...card.querySelectorAll('button')].find(b=>b.textContent==='Share this project').disabled===true,
     noCreateYet:!T.calls.includes('create')};
  `));
  await shot('team-connect-github-1-not-tracked.png');
  // 2. Start tracking: step 1 ticks, step 2 and 3 open.
  Object.assign(result,await step(`
   document.querySelector('.team-connect-step[data-status="current"] button').click(); ${pause}
   const steps=[...document.querySelectorAll('.team-connect-step')].map(s=>s.dataset.status);
   [...document.querySelectorAll('.team-connect button')].find(b=>b.textContent==='Open GitHub').click();
   return {tracked:T.calls.includes('init')&&steps[0]==='done'&&steps[1]==='current'&&steps[2]==='current'&&document.querySelector('.team-connect').dataset.state==='no-remote',
     openGitHub:T.calls.some(c=>c==='open:https://github.com/new?name=site-demo&visibility=private')};
  `));
  // 3. A wrong address: the reason is on screen, not in a hidden element.
  Object.assign(result,await step(`
   const box=document.querySelector('.team-connect-address'); box.value='https://gitlab.com/me/site';
   [...document.querySelectorAll('.team-connect button')].find(b=>b.textContent==='Connect').click(); ${pause}
   const status=document.querySelector('.team-status');
   const shown=(${visible})(status)&&status.textContent.startsWith("That isn't a github.com repository address")&&!status.closest('.team-strip');
   return {errorVisible:shown&&!T.calls.some(c=>c.startsWith('connect:'))};
  `));
  await shot('team-connect-github-2-wrong-address.png');
  // 3b. A refusal from the main process (git could not write its config) is on screen too.
  Object.assign(result,await step(`
   const box=document.querySelector('.team-connect-address'); box.value='https://github.com/me/locked';
   [...document.querySelectorAll('.team-connect button')].find(b=>b.textContent==='Connect').click(); ${pause}
   const status=document.querySelector('.team-status');
   return {mainErrorVisible:(${visible})(status)&&status.textContent.startsWith("Git couldn't add the GitHub address")&&document.querySelector('.team-connect').dataset.state==='no-remote'};
  `));
  // 4. The real address: ready, then Share creates the project.
  Object.assign(result,await step(`
   const box=document.querySelector('.team-connect-address'); box.value='https://github.com/demo-owner/site-demo.git';
   [...document.querySelectorAll('.team-connect button')].find(b=>b.textContent==='Connect').click(); ${pause}
   const card=document.querySelector('.team-connect'), share=[...card.querySelectorAll('button')].find(b=>b.textContent==='Share this project');
   return {ready:card.dataset.state==='ready'&&card.textContent.includes('Ready to share')&&!share.disabled&&[...card.querySelectorAll('.team-connect-step')].slice(0,3).every(s=>s.dataset.status==='done')};
  `));
  await shot('team-connect-github-3-ready.png');
  Object.assign(result,await step(`
   [...document.querySelectorAll('.team-connect button')].find(b=>b.textContent==='Share this project').click(); await new Promise(r=>setTimeout(r,300));
   return {shared:T.calls.includes('create')&&!document.querySelector('.team-connect')&&document.querySelectorAll('.shared-project-group').length===1};
  `));
  // 5. The command's door: connectGitHub() opens the card even with projects listed.
  Object.assign(result,await step(`P.connectGitHub(); ${pause} return {command:document.querySelector('.team-connect')?.dataset.state==='ready'};`));
  // 6. Signed out, the Git steps still work; only sharing asks for the account.
  Object.assign(result,await step(`window.adcode.account.status=async()=>({state:'anonymous'}); P.connectGitHub(); ${pause} const buttons=[...document.querySelectorAll('.team-connect button')].map(b=>b.textContent); return {signedOutAsksToSignIn:document.querySelector('.team-connect')?.dataset.state==='ready'&&buttons.includes('Sign in to share')&&!buttons.includes('Share this project')};`));
  await shot('team-connect-github-4-signed-out.png');
  console.log(JSON.stringify(result));app.exit(Object.values(result).every(Boolean)?0:1);
 }catch(error){console.error(error);app.exit(1);}
});
