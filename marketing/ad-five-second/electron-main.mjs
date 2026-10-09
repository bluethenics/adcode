import {app,BrowserWindow} from 'electron';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const here=import.meta.dirname;
const out=join(here,'out');
const ffmpeg=join(here,'../ad-payback/.tools/ffmpeg.exe');
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.setPath('userData',join(here,'out/.electron'));
async function main(){
  await app.whenReady();await mkdir(out,{recursive:true});
  const win=new BrowserWindow({width:1080,height:1080,show:false,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.setFrameRate(60);win.webContents.debugger.attach('1.3');
  await win.loadFile(join(here,'stage/index.html'));await win.webContents.executeJavaScript('AD.ready()');
  async function capture(t){await win.webContents.executeJavaScript(`AD.render(${t})`);const {data}=await win.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true,clip:{x:0,y:0,width:1080,height:1080,scale:1}});return Buffer.from(data,'base64');}
  for(const t of [.55,1.9,2.5,4.5]){await writeFile(join(out,`frame-${t}.png`),await capture(t));}
  if(process.env.AD_STILLS==='1'){app.quit();return;}
  const encoder=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','image2pipe','-c:v','png','-framerate','60','-i','-','-c:v','libx264','-preset','slow','-crf','17','-tune','animation','-pix_fmt','yuv420p','-movflags','+faststart',join(out,'picture.mp4')],{stdio:['pipe','inherit','inherit'],windowsHide:true});
  const done=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(new Error(`Encoder: ${code}`)));});
  for(let frame=0;frame<300;frame++){
    const png=await capture(frame/60);
    if(!encoder.stdin.write(png))await new Promise(resolve=>encoder.stdin.once('drain',resolve));
    if(frame%60===0)console.log(`Rendered ${frame}/300 frames`);
  }
  encoder.stdin.end();await done;console.log('Rendered 300/300 frames');app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
