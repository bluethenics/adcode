const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData',fs.mkdtempSync(join(require('node:os').tmpdir(),'adcode-account-journey-')));
app.whenReady().then(async()=>{
 const win = new BrowserWindow({show:false,width:1040,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
 try {
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const renderer=resolve(__dirname,'../../src/renderer');
  const css=[...fs.readFileSync(join(renderer,'main.ts'),'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)].map(m=>fs.readFileSync(join(renderer,'styles',m[1]),'utf8')).join('\n');
  const script=esbuild.buildSync({stdin:{contents:"export {createAccountGate} from './onboarding/accountGate.ts'; export {createAccountMenu} from './workbench/accountMenu.ts'; export {createOnboardingSheet} from './onboarding/onboardingSheet.ts'; export {showFirstOnboarding} from './onboarding/welcomeJourney.ts';",resolveDir:renderer},bundle:true,write:false,format:'iife',globalName:'Fixture'}).outputFiles[0].text;
  await win.webContents.executeJavaScript(`(()=>{
   ${script}
   window.Fixture=Fixture;
   document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}}));
   document.documentElement.dataset.theme='dark';
   let state={state:'anonymous'}, verified=false, listeners=[], sends=0, announce=false, blocked=null, attempts=[], cancellations=0; const emit=()=>listeners.forEach(cb=>cb(state));
   window.adcode={milestones:{record:()=>{}},account:{status:async()=>state,verification:async send=>{if(send)sends++;if(blocked)return new Promise(resolve=>{blocked.resolve=resolve;});if(verified&&announce){announce=false;emit();}return {verified,email:'builder@example.test',message:verified?'Email verified':'Open the ADCode verification email, then return here.'};},onChanged:cb=>{listeners.push(cb);return()=>{};},onDeviceCode:()=>()=>{},link:provider=>new Promise(resolve=>attempts.push({provider,resolve})),cancelLink:async()=>{cancellations++;},signOut:async()=>({state:'anonymous'})},aiUsage:{allowance:async()=>null},clipboard:{writeText:async()=>{}}};
   const trigger=document.createElement('button');trigger.id='account-toggle';document.body.append(trigger);
   const menu=Fixture.createAccountMenu(trigger,document.body,{ask:async()=>true});
   const gate=Fixture.createAccountGate(menu,()=>{});
   window.fixture={gate,setLinked:()=>{state={state:'linked',email:'builder@example.test',displayName:'Builder',photoUrl:null,providers:['github']};listeners.forEach(cb=>cb(state));},setVerified:()=>{verified=true;announce=true;window.dispatchEvent(new Event('focus'));},signOut:()=>{state={state:'anonymous'};listeners.forEach(cb=>cb(state));},attempts,cancellations:()=>cancellations,sends:()=>sends,block:()=>{blocked={};},resolve:()=>{const next=blocked;blocked=null;next.resolve({verified:true,message:'Verified'});},repeat:()=>emit()};
  })()`);
  await new Promise(r=>setTimeout(r,150));
  fs.writeFileSync(resolve(__dirname,'../../../../output/account-journey-signin.png'),(await win.webContents.capturePage()).toPNG());
  const result=await win.webContents.executeJavaScript(`(async()=>{
   const pause=()=>new Promise(r=>setTimeout(r,100)),result={};
   const dialog=document.querySelector('.account-gate');
   result.signIn=dialog.open&&dialog.dataset.step==='signin'&&[...dialog.querySelectorAll('button')].some(b=>b.textContent==='Continue with Google');
   const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);result.gated=cancel.defaultPrevented&&dialog.open;
   const google=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Continue with Google'),github=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Continue with GitHub');
   google.click();result.googlePending=fixture.attempts[0].provider==='google'&&google.disabled&&github.disabled&&!dialog.querySelector('.account-cancel').hidden;
   dialog.querySelector('.account-cancel').click();github.click();
   fixture.attempts[0].resolve({ok:false,message:'Old attempt'});await pause();
   result.cancelRetry=fixture.cancellations()===1&&fixture.attempts[1].provider==='github'&&github.disabled&&!dialog.textContent.includes('Old attempt');
   fixture.attempts[1].resolve({ok:false,message:'Please try again.'});await pause();
   result.providerError=!google.disabled&&!github.disabled&&dialog.textContent.includes('Please try again.');
   fixture.setLinked();await pause();result.verification=dialog.dataset.step==='verify'&&dialog.textContent.includes('builder@example.test');
   [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Send verification link').click();await pause();result.sent=fixture.sends()===1;
   return result;
  })()`);
  await new Promise(r=>setTimeout(r,300));
  fs.writeFileSync(resolve(__dirname,'../../../../output/account-journey-verification.png'),(await win.webContents.capturePage()).toPNG());
  Object.assign(result,await win.webContents.executeJavaScript(`(async()=>{
   const pause=()=>new Promise(r=>setTimeout(r,100));fixture.setVerified();await pause();
   const dialog=document.querySelector('.account-gate');
   await fixture.gate.wait();
   const ready=!dialog.open;
   fixture.repeat();await pause();const returning=!dialog.open;
   const unlocked=!dialog.open&&document.querySelector('.account-panel').parentElement===document.body;
   let completed=false;
   const welcome=Fixture.createOnboardingSheet({complete:()=>{completed=true;},aiReady:async()=>true,build:async()=>{},openFolder:()=>{},openAllProviders:()=>{},openAdSettings:()=>{}});
   const welcomeState={completed:async()=>completed,open:()=>welcome.open()};
   await Fixture.showFirstOnboarding(fixture.gate,welcomeState,async()=>{});
   const firstOnboarding=welcome.isOpen()&&document.querySelector('.onboarding').textContent.includes('What do you want to build?');
   document.querySelector('.onboarding-skip').click();await pause();
   const repeated=await Fixture.showFirstOnboarding(fixture.gate,welcomeState,async()=>{});
   const rememberedOnboarding=completed&&!repeated&&!welcome.isOpen();
   fixture.block();fixture.repeat();await pause();fixture.signOut();fixture.resolve();await pause();
   const staleBlocked=dialog.open;
   return {ready,returning,unlocked,firstOnboarding,rememberedOnboarding,staleBlocked,relocked:dialog.open&&dialog.dataset.step==='signin'};
  })()`));
  await win.loadURL('about:blank');
  Object.assign(result,await win.webContents.executeJavaScript(`(async()=>{
   ${script}
   let listener=()=>{},announced=false,ready=0;
   window.adcode={account:{status:async()=>({state:'linked',email:'returning@example.test'}),verification:async()=>{if(!announced){announced=true;listener();}return {verified:true,message:'Verified'};},onChanged:cb=>{listener=cb;}}};
   const gate=Fixture.createAccountGate({attachTo:()=>{}},()=>ready++);
   const signedInFormShown=[];
   const observer=new MutationObserver(()=>{if(document.querySelector('.account-gate').dataset.step==='signin')signedInFormShown.push(true);});
   observer.observe(document.querySelector('.account-gate'),{attributes:true});
   await Promise.race([gate.wait(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Returning account stayed gated')),1000))]);
   observer.disconnect();return {coldStartResumed:!gate.isOpen()&&ready===1,returningNoLogin:signedInFormShown.length===0};
  })()`));
  // A source checkout run for automation can switch the gate off; it must never open then.
  await win.loadURL('about:blank');
  Object.assign(result,await win.webContents.executeJavaScript(`(async()=>{
   ${script}
   let checked=0,ready=0;
   window.adcode={account:{status:async()=>{checked++;return {state:'anonymous'};},verification:async()=>({verified:false,message:''}),onChanged:()=>{}}};
   const gate=Fixture.createAccountGate({attachTo:()=>{}},()=>ready++,Promise.resolve(false));
   await Promise.race([gate.wait(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Switched-off gate held the app')),1000))]);
   return {gateOffNeverOpens:!gate.isOpen()&&!document.querySelector('.account-gate').open&&checked===0&&ready===1};
  })()`));
  // Reported on 2.4.10: a GitHub sign-in that shared no email could never be verified.
  await win.loadURL('about:blank');
  Object.assign(result,await win.webContents.executeJavaScript(`(async()=>{
   ${script}
   const css=${JSON.stringify(css)};document.head.append(Object.assign(document.createElement('style'),{textContent:css}));
   const pause=()=>new Promise(r=>setTimeout(r,100));
   let state={state:'linked',email:null,displayName:'Private',providers:['github']},listener=()=>{},linked=[];
   window.adcode={account:{status:async()=>state,verification:async()=>({verified:false,message:'Open the ADCode verification email, then return here.'}),onChanged:cb=>{listener=cb;},linkEmail:async(email,password)=>{linked.push([email,password]);state={...state,email};return {ok:true};}}};
   Fixture.createAccountGate({attachTo:()=>{}},()=>{});await pause();
   const dialog=document.querySelector('.account-gate'),form=dialog.querySelector('.account-gate-add-email');
   const offered=dialog.dataset.step==='verify'&&!form.hidden&&getComputedStyle(form).display!=='none'&&dialog.textContent.includes("didn't share an email");
   form.querySelector('input[type=email]').value=' private@example.test ';form.querySelector('input[type=password]').value='secret12';
   form.requestSubmit();await pause();await pause();
   return {noEmailOffered:offered,emailLinked:linked.length===1&&linked[0][0]==='private@example.test'&&linked[0][1]==='secret12',emailFormGone:form.hidden&&dialog.textContent.includes('private@example.test')};
  })()`));
  console.log(JSON.stringify(result));app.exit(Object.values(result).every(Boolean)?0:1);
 }catch(error){console.error(error);app.exit(1);}
});
