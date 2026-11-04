const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
app.setPath('userData', fs.mkdtempSync(join(require('node:os').tmpdir(), 'adcode-sidebar-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show:false, width:1440, height:1000, webPreferences:{ offscreen:true, backgroundThrottling:false } });
  try {
    await win.loadURL('about:blank');
    // Pin the viewport: an offscreen window is capped by the screen, and the layout changes at 900px.
    win.webContents.debugger.attach('1.3');
    const viewport = height => win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width:1440, height, deviceScaleFactor:1, mobile:false });
    await viewport(1000);
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = [...fs.readFileSync(join(renderer, 'main.ts'), 'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)].map(m => fs.readFileSync(join(renderer, 'styles', m[1]), 'utf8')).join('\n');
    const script = require('esbuild').buildSync({ stdin:{ contents:"export {createVibeSidebar} from './workbench/vibeSidebar.ts'", resolveDir:renderer }, bundle:true, write:false, format:'iife', globalName:'Fixture' }).outputFiles[0].text;
    const result = await win.webContents.executeJavaScript(`(async()=>{
      ${script}
      document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}+'body{display:block;margin:0} .vibe-sidebar{height:100vh;width:360px}'}));
      document.documentElement.dataset.theme='dark';document.documentElement.dataset.frame='web';document.body.dataset.workspaceMode='vibe';
      document.body.innerHTML='<button id="account-toggle">S</button><button id="open-projects" hidden>Shared projects</button>';
      const noop=()=>{};
      window.adcode={milestones:{record:noop},workspace:{onChanged:noop,onFilesChanged:noop,recents:async()=>[]},aiWorkspace:{onChanged:noop,list:async()=>[]},git:{status:async()=>null}};
      const sidebar=Fixture.createVibeSidebar({chat:{openScheduleComposer:noop},projectRoot:()=>null,search:null,more:document.createElement('button'),appMenu:null,run:noop,toggleContext:noop,showContext:noop,togglePreview:noop,showPage:noop,onPageChange:noop,openNotifications:noop,onUnreadNotifications:cb=>cb(1),onEarnings:cb=>cb('$0.14348'),onLayoutChange:noop});
      document.body.append(sidebar.element,sidebar.topbar);
      await new Promise(r=>setTimeout(r,150));
      const visible=el=>el&&getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0;
      const texts=[...document.querySelectorAll('.web-sidebar-panel .vibe-nav-text')].filter(visible).map(n=>n.textContent);
      return {labels:['New conversation','Included AI','Earnings','Invite friends, earn more','Keyboard shortcuts','Join Discord','Docs','All features'].every(t=>texts.includes(t)),footer:document.querySelectorAll('.web-link-row')[1].getBoundingClientRect().top>document.querySelectorAll('.web-link-row')[0].getBoundingClientRect().bottom,promo:visible(document.querySelector('.web-promo'))&&document.querySelector('.web-promo .vibe-ide-button')!==null,noSharedEntry:!document.querySelector('.web-rail #open-projects'),noPercentage:!document.querySelector('.web-credits-row').textContent.includes('%')};
    })()`);
    fs.writeFileSync(resolve(__dirname,'../../../../output/sidebar-restored.png'),(await win.webContents.capturePage()).toPNG());
    // A laptop-height window: Chats keeps most of the panel; the footer links stay named but compact.
    await viewport(760); await new Promise(r=>setTimeout(r,200));
    Object.assign(result, await win.webContents.executeJavaScript(`(()=>{
      const links=[...document.querySelectorAll('.web-links .web-link-row')], panel=document.querySelector('.web-sidebar-panel').getBoundingClientRect();
      const chats=document.querySelector('.vibe-history-host, .vibe-conversations').getBoundingClientRect();
      return {shortLinksOneRow:links.length===4&&links.every(l=>Math.abs(l.getBoundingClientRect().top-links[0].getBoundingClientRect().top)<1),
        shortLinksNamed:links.every(l=>l.getAttribute('aria-label')&&l.title),
        shortChatsRoomy:chats.height>=panel.height/3};
    })()`));
    fs.writeFileSync(resolve(__dirname,'../../../../output/sidebar-short-window.png'),(await win.webContents.capturePage()).toPNG());
    console.log(JSON.stringify(result));app.exit(Object.values(result).every(Boolean)?0:1);
  } catch(error) { console.error(error);app.exit(1); }
});
