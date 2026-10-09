import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const here=import.meta.dirname,out=join(here,'out');
const ffmpeg=join(here,'../ad-payback/.tools/ffmpeg.exe');
await mkdir(out,{recursive:true});
// Original five-second stereo sound design: soft pulse, swishes, resolving sonic logo.
const rate=48000,n=5*rate,samples=new Float64Array(n*2);
let seed=42;
function noise(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;}
function mix(at,dur,fn,pan=0){for(let i=0;i<dur*rate;i++){const k=Math.round(at*rate)+i;if(k>=n)break;const v=fn(i/rate,i/(dur*rate));samples[k*2]+=v*(1-pan*.3);samples[k*2+1]+=v*(1+pan*.3);}}
for(const at of [0,1.03,2.82])mix(at,.48,(t)=>Math.sin(2*Math.PI*(58*t+4*(1-Math.exp(-t*20))))*.38*Math.exp(-t*11)*Math.min(1,t*220));
for(const at of [.82,2.59]){let low=0;mix(at,.3,(t,p)=>{low=.88*low+.12*noise();return low*Math.sin(Math.PI*p)**2*.45;},.3);}
for(let j=0;j<7;j++)mix(1.38+j*.095,.06,(t)=>noise()*.055*Math.exp(-t*85),j%2?-.6:.6);
for(const [j,f] of [261.63,329.63,392,523.25].entries())mix(2.88+j*.08,2.1,(t)=>{const env=Math.min(1,t*70)*Math.exp(-t*2.5)*Math.min(1,(2.1-t)*12);return (Math.sin(2*Math.PI*f*t)+.17*Math.sin(2*Math.PI*f*2*t))*.105*env;},(j-1.5)/2);
mix(.12,2.5,(t,p)=>(Math.sin(2*Math.PI*130.815*t)+Math.sin(2*Math.PI*196*t))*.025*Math.sin(Math.PI*p)**2);
const wav=Buffer.alloc(44+n*4);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*4,40);
for(let i=0;i<n*2;i++)wav.writeInt16LE(Math.round(Math.tanh(samples[i])*30000*Math.min(1,(n-i/2)/2400)),44+i*2);
await writeFile(join(out,'soundtrack.wav'),wav);
const electron=createRequire(join(here,'../../package.json'))('electron');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
if(process.argv.includes('--stills'))env.AD_STILLS='1';
const child=spawn(electron,[join(here,'electron-main.mjs')],{env,stdio:'inherit',windowsHide:true});
const code=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});
if(code!==0)process.exit(code??1);
if(env.AD_STILLS==='1')process.exit(0);
function ff(args){const r=spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error',...args],{stdio:'inherit',windowsHide:true});if(r.status!==0)throw new Error('ffmpeg failed');}
const master=join(out,'adcode-5s-1080x1080.mp4');
ff(['-i',join(out,'picture.mp4'),'-i',join(out,'soundtrack.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=7','-c:a','aac','-b:a','192k','-ar','48000','-t','5','-movflags','+faststart',master]);
ff(['-i',master,'-vf','fps=2,scale=324:324,tile=5x2','-frames:v','1',join(out,'storyboard.jpg')]);
console.log(`Video ready: ${master}`);
