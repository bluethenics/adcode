/* Team in Vibe, in real Chromium: opening a team chat shows a skeleton in the chat's shape and
 * then the real chat with the strip above it - never the panel's own chat, not even for a frame.
 * Run by teamInChatUi.test.ts. Screenshots go to output/ for a person to look at. */
const {app,BrowserWindow}=require('electron');
const {readFileSync,mkdtempSync,writeFileSync,mkdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const esbuild=require('esbuild');
app.setPath('userData',mkdtempSync(join(tmpdir(),'adcode-team-chat-')));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1280,height:820,webPreferences:{backgroundThrottling:false}});
 const out=resolve(__dirname,'../../../../output');mkdirSync(out,{recursive:true});
 try {
  // A hidden window shows its last frame; prime the compositor before each capture.
  const capture=async()=>{await win.webContents.capturePage();await new Promise(r=>setTimeout(r,180));return win.webContents.capturePage();};
  await win.loadURL('about:blank');
  const renderer=resolve(__dirname,'../../src/renderer');
  const css=[...readFileSync(join(renderer,'main.ts'),'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)].map(m=>readFileSync(join(renderer,'styles',m[1]),'utf8')).join('\n');
  const script=esbuild.buildSync({stdin:{contents:"export {createSharedWorkspacePanel} from './collab/sharedWorkspacePanel.ts'",resolveDir:renderer},bundle:true,write:false,format:'iife',globalName:'Fixture'}).outputFiles[0].text;
  const result=await win.webContents.executeJavaScript(`(async()=>{
   ${script}
   if(!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{value:()=>Math.random().toString(36).slice(2)});
   Object.defineProperty(document,'visibilityState',{get:()=> 'visible'});
   document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}})); document.documentElement.dataset.theme='dark';
   document.body.style.margin='0';
   const wait=ms=>new Promise(r=>setTimeout(r,ms)), result={};
   const snap={id:'a'.repeat(64),name:'Aurora',repository:'team/aurora',ownerId:'owner',selfId:'owner',archived:false,memberCount:2,memberLimit:3,invite:'adproject:demo',liveInvite:null,selectedSession:'s1',hasOlder:false,members:[{uid:'owner',name:'Alex',messages:1,sessions:1},{uid:'guest',name:'Sam',messages:1,sessions:0}],sessions:[{id:'s1',title:'Launch planning',pending:false}],messages:[{seq:1,id:'m1',sessionId:'s1',authorId:'guest',authorName:'Sam',kind:'member',text:'Can we make the pricing header blue?',at:Date.now()}]};
   const aiCalls=[];
   window.adcode={account:{status:async()=>({state:'linked'}),onChanged:()=>()=>{}},clipboard:{writeText:async()=>{}},
     team:{state:async()=>({aiReplies:true,projectId:snap.id,sessionId:'s1'}),setAi:async(id,on)=>{aiCalls.push(on);return true;}},
     collab:{sharedLibrary:async()=>({projects:[snap],limits:{plan:'free',projects:1,members:3},owned:1}),sharedSnapshot:async(id,session)=>({...structuredClone(snap),selectedSession:session??snap.selectedSession}),sharedSession:async()=>structuredClone(snap),sharedMessage:async()=>structuredClone(snap),sharedManage:async()=>{},onSharedChanged:()=>()=>{}}};

   // The Vibe layout: sidebar, and the chat page holding the real chat card.
   document.body.dataset.workspaceMode='vibe'; document.body.dataset.workArea='team';
   const layout=document.createElement('main'); layout.className='vibe-workspace';
   layout.style.cssText='display:grid;grid-template-columns:280px 1fr;height:100vh;background:var(--bg-app);color:var(--text-primary);font-family:var(--font-ui)';
   const nav=document.createElement('aside'); nav.style.cssText='padding:16px 12px;border-right:1px solid var(--border-hairline);overflow:auto';
   const pageChat=document.createElement('section'); pageChat.id='vibe-page-chat'; pageChat.className='vibe-page'; pageChat.style.position='relative';
   const card=document.createElement('div'); card.className='chat-card';
   card.innerHTML='<div class="chat-transcript" style="display:flex;flex-direction:column;gap:20px;overflow:auto;flex:1"></div>';
   card.style.cssText='display:flex;flex-direction:column';
   const transcript=card.firstElementChild;
   pageChat.append(card); const host=document.createElement('div'); pageChat.append(host);
   layout.append(nav,pageChat); document.body.append(layout);

   // The chat draws a conversation a moment after it is asked to, as the real one does.
   let opening=0;
   const drawChat=async()=>{ opening++; await wait(450); transcript.innerHTML=
     '<div class="chat-bubble chat-bubble-user is-teammate" data-author="Sam">Can we make the pricing header blue?</div>'+
     '<div class="chat-bubble chat-bubble-assistant" data-asked-by="Sam">Done - the header uses the accent blue now.</div>'+
     '<div class="chat-bubble chat-bubble-user" data-author="You">Nice. Also add a FAQ section under it.</div>'; };
   let panel;
   panel=Fixture.createSharedWorkspacePanel({prompt:async()=>'x',confirm:async()=>true,signIn:()=>{},openLocalProjects:()=>{},
     openChat:async()=>{ if(panel.strip.parentElement!==pageChat) pageChat.prepend(panel.strip); await drawChat(); return 'team-s1'; },
     onModeChange:mode=>{ if(mode==='empty') delete document.body.dataset.teamChat; else document.body.dataset.teamChat=mode==='chat'?'open':'opening'; }});
   panel.mount(host,nav,()=>{});

   // Watch every frame while it opens: the panel's own chat must never be on screen.
   const shown=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
   const frames={panelChat:0,skeleton:0,cardBeforeDrawn:0,total:0};
   let watching=true;
   (function frame(){ if(!watching) return; frames.total++;
     if(shown(host.querySelector('.shared-transcript'))||shown(host.querySelector('.shared-composer'))) frames.panelChat++;
     if(shown(host.querySelector('.team-skeleton'))) frames.skeleton++;
     if(shown(card)&&transcript.children.length===0) frames.cardBeforeDrawn++;
     requestAnimationFrame(frame); })();
   panel.open();
   await wait(200);
   result.skeletonWhileOpening=shown(host.querySelector('.team-skeleton'))&&document.body.dataset.teamChat==='opening';
   window.__frames=frames; return {result};
  })()`);
  writeFileSync(join(out,'team-in-chat-opening.png'),(await capture()).toPNG());
  const after=await win.webContents.executeJavaScript(`(async()=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   await wait(900);
   const shown=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
   const strip=document.querySelector('#vibe-page-chat > .team-strip'), card=document.querySelector('#vibe-page-chat > .chat-card');
   const stripBox=strip?.getBoundingClientRect(), cardBox=card?.getBoundingClientRect();
   const header=strip?.querySelector('.team-chat-header')?.getBoundingClientRect();
   return {
     chatOpen:document.body.dataset.teamChat==='open',
     cardShown:shown(card),
     hostHidden:!shown(document.querySelector('.shared-chat-host')),
     stripAbove:!!strip&&!!card&&shown(strip)&&strip.offsetTop+strip.offsetHeight<=card.offsetTop+1,
     stripTitle:strip?.querySelector('.team-chat-title')?.textContent,
     stripHasControls:!!strip?.querySelector('.team-ai-switch')&&!!strip?.querySelector('.team-invite'),
     stripHeight:Math.round(header?.height??0),
     teammateLeft:(()=>{if(!card.querySelector('.is-teammate'))return 'no bubbles; '+document.body.dataset.teamChat+'; '+document.querySelector('.shared-chat-host')?.innerText.slice(0,200);const b=card.querySelector('.is-teammate').getBoundingClientRect(),y=card.querySelector('[data-author="You"]').getBoundingClientRect();return b.left<y.left;})(),
   };
  })()`);
  writeFileSync(join(out,'team-in-chat-open.png'),(await capture()).toPNG());
  const frames=await win.webContents.executeJavaScript(`(()=>{ return window.__frames ?? null; })()`);
  const all={...result.result,...after,frames};
  console.log('TEAM_IN_CHAT='+JSON.stringify(all));
  app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
