/**
 * Original motion film, using ADCode's exact existing agent shapes and expressions.
 * Critical copy is inside x=90..960/y=290..1220 (14% top/35% bottom/6% sides).
 * Every frame is deterministic. The product sequence is an illustrated workflow.
 */
import { BODIES, FACES } from './mascots.js';
const W=1080,H=1920,DURATION=20;
const canvas=document.getElementById('stage'), c=canvas.getContext('2d',{alpha:false});
const params=new URLSearchParams(location.search),hook=Number(params.get('hook'))===2?2:1;
const P={paper:'#fffdf8',ink:'#17181c',muted:'#66676c',line:'#e5e2dc',blue:'#3f7fe8',violet:'#7c5ce6',green:'#2e9d62',pink:'#d9468f',coral:'#e0584e',amber:'#d48a0c'};
const crew=[
 {shape:'hexagon',color:P.violet,role:'Reviewer'},
 {shape:'capsule',color:P.green,role:'Tester'},
 {shape:'drop',color:P.coral,role:'Bug fixer'},
 {shape:'cloud',color:P.pink,role:'UI polish'},
 {shape:'egg',color:P.amber,role:'Docs writer'},
];
const paths=Object.fromEntries(Object.entries(BODIES).map(([k,d])=>[k,new Path2D(d)]));
const faces=Object.fromEntries(Object.entries(FACES).map(([k,parts])=>[k,parts.map(p=>({...p,path:new Path2D(p.d)}))]));
const clamp=(v)=>Math.max(0,Math.min(1,v)),mix=(a,b,p)=>a+(b-a)*p;
const seg=(t,a,b)=>clamp((t-a)/(b-a));
const out=(p)=>1-(1-p)**4, smooth=(p)=>p*p*(3-2*p);
const pop=(t)=>t<0?0:1-Math.exp(-9*t)*Math.cos(13*t);
function rr(x,y,w,h,r=24,fill=P.paper,stroke=null){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke()}}
function text(str,x,y,size=48,color=P.ink,weight=600,align='left',family='Inter Tight'){
 c.fillStyle=color;c.font=`${weight} ${size}px "${family}"`;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(str,x,y);
}
function title(lines,y=425,size=120,color=P.ink){lines.forEach((s,i)=>text(s,520,y+i*(size*1.02),size,color,850,'center'))}
function pill(str,x,y,w,color=P.ink,bg=P.paper,size=31){rr(x-w/2,y-28,w,56,28,bg);text(str,x,y+11,size,color,650,'center')}
function mark(x,y,size=60,color=P.ink){
 c.save();c.translate(x-size/2,y-size/2);c.scale(size/1024,size/1024);c.strokeStyle=color;c.lineCap='round';c.lineJoin='round';
 for(const [d,width] of [ ['M320 348L140 512L320 676',96],['M704 348L884 512L704 676',96],['M512 296V388',64],['M512 636V728',64],['M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619',92] ]){c.lineWidth=width;c.stroke(new Path2D(d))}c.restore();
}
function brand(dark=false){mark(127,308,62,dark?P.paper:P.ink);text('adcode',174,325,45,dark?P.paper:P.ink,750);text('YOUR IDEA. AN AI CREW.',948,319,23,dark?'#a0a1a7':'#85858b',600,'right','Inter')}
function backdrop(t,dark=false){
 c.fillStyle=dark?P.ink:P.paper;c.fillRect(0,0,W,H);
 const glow=c.createRadialGradient(520,880,0,520,880,730);glow.addColorStop(0,dark?'#292a35':'#f1eee8');glow.addColorStop(1,dark?P.ink:P.paper);c.fillStyle=glow;c.fillRect(0,0,W,H);
 c.fillStyle=dark?'#ffffff08':'#17181c08';
 for(let i=0;i<42;i++){const x=(i*173+37)%1080,y=(i*257+80)%1920;c.beginPath();c.arc(x,y,2.4,0,Math.PI*2);c.fill()}
 // Quiet decorative typography in the UI-obscured regions.
 text('{ your next idea }',540,1740,42,dark?'#30313a':'#e9e6e0',600,'center','JetBrains Mono');
 brand(dark);
}
function mascot(shape,color,x,y,size,t,mood='happy',rotation=0,scale=1){
 if(scale<=0)return;
 const bob=Math.sin(t*3.1+x*0.015)*4;
 c.save();c.translate(x,y+bob);c.rotate(rotation);c.scale(scale,scale);
 c.fillStyle='#17181c12';c.beginPath();c.ellipse(0,size*.425,size*.34,size*.038,0,0,Math.PI*2);c.fill();
 c.translate(-size/2,-size/2);c.scale(size/48,size/48);
 const sx=1+Math.sin(t*4+x*.02)*.018,sy=1-Math.sin(t*4+x*.02)*.014;
 c.translate(24,42);c.scale(sx,sy);c.translate(-24,-42);
 c.fillStyle=color;c.fill(paths[shape]);c.strokeStyle=P.paper;c.fillStyle=P.paper;c.lineWidth=2.4;c.lineCap='round';c.lineJoin='round';
 const blink=Math.abs((t+x*.0005)%3.7-1.7)<.075;
 for(const p of faces[mood]){c.save();if(blink&&p.part==='eye'){c.translate(0,24);c.scale(1,.13);c.translate(0,-24)}if(p.fill)c.fill(p.path);else c.stroke(p.path);c.restore()}
 c.restore();
}
function task(str,x,y,w,t,r=0){c.save();c.translate(x,y);c.rotate(r);c.shadowColor='#17181c12';c.shadowBlur=28;c.shadowOffsetY=14;rr(-w/2,-40,w,80,20,P.paper,P.line);c.shadowColor='transparent';text(str,0,13,39,P.ink,700,'center');c.restore()}
function arrow(x1,y1,x2,y2,color=P.muted,width=4){c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();const a=Math.atan2(y2-y1,x2-x1);c.beginPath();c.moveTo(x2-14*Math.cos(a-.55),y2-14*Math.sin(a-.55));c.lineTo(x2,y2);c.lineTo(x2-14*Math.cos(a+.55),y2-14*Math.sin(a+.55));c.stroke()}
function opening(t){
 backdrop(t);title(hook===1?['Still coding','alone?']:['Your idea.','An AI crew.'],440,132);
 const shake=Math.sin(t*18)*Math.sin(Math.PI*seg(t,0,3))*.045;
 mascot('circle',P.blue,520,905,325,t,'alert',shake);
 task('UI',250+Math.sin(t*2)*13,759,162,t,-.14);
 task('BUGS',800+Math.cos(t*2)*10,815,188,t,.13);
 task('TESTS',758+Math.sin(t*2.6)*12,1059,208,t,-.09);
 for(let i=0;i<3;i++){c.fillStyle=P.blue;c.beginPath();c.arc(478+i*34,694-Math.sin(t*4+i)*5,6,0,Math.PI*2);c.fill()}
 text('Your next build could use a crew.',520,1205,44,P.muted,500,'center');
}
function meet(t){
 backdrop(t);title(['Meet your','AI crew.'],438,123);
 const u=t-3;
 const layout=[[266,773],[525,773],[785,773],[382,1050],[658,1050]];
 crew.forEach((a,i)=>{const [x,y]=layout[i],s=pop(u-i*.16);mascot(a.shape,a.color,x,y,195,t,u<1?'alert':'happy',(1-s)*.45,s);if(u>i*.16+.22){c.save();c.globalAlpha=out(seg(u,i*.16+.22,i*.16+.55));text(a.role,x,y+130,35,P.ink,650,'center');c.restore()}});
}
function prompt(t){
 backdrop(t,true);title(['Give them','a real job.'],438,117,P.paper);
 const u=t-6,s=pop(u);
 c.save();c.translate(520,853);c.scale(s,s);c.shadowColor='#0005';c.shadowBlur=60;c.shadowOffsetY=15;rr(-412,-155,824,308,36,'#f9f7f2');c.shadowColor='transparent';
 text('YOU',-365,-99,27,P.muted,600,'left','Inter');
 const message='Build a landing page.';const count=Math.floor(clamp(u/.85)*message.length);
 text(message.slice(0,count),-365,-16,62,P.ink,650);
 if(u<1.3){const wid=c.measureText(message.slice(0,count)).width;rr(-365+wid+9,-61,4,54,1,P.blue)}
 pill('Start building',218,98,255,P.paper,P.ink,31);
 c.restore();
 crew.forEach((a,i)=>mascot(a.shape,a.color,260+i*130,1112,96,t,'thinking',Math.sin(t*5+i)*.08));
 text('Illustrated workflow',520,1220,29,'#adaeb5',500,'center','Inter');
}
function check(x,y,color=P.green){c.strokeStyle=color;c.lineWidth=6;c.lineCap='round';c.lineJoin='round';c.beginPath();c.moveTo(x-9,y);c.lineTo(x-2,y+7);c.lineTo(x+13,y-10);c.stroke()}
function editor(t){
 backdrop(t,true);title(['Build together.','Review together.'],430,94,P.paper);
 const u=t-9;rr(92,620,856,494,28,'#f9f7f2');
 mark(132,664,43);text('adcode',166,676,31,P.ink,650);text('landing-page',908,674,24,P.muted,500,'right','JetBrains Mono');
 c.strokeStyle=P.line;c.lineWidth=2;c.beginPath();c.moveTo(92,700);c.lineTo(948,700);c.stroke();
 const cols=['#7c5ce6','#17181c','#3f7fe8','#2e9d62'];
 const snippets=['<main class="hero">','  <h1>Your next idea.</h1>','  <p>Make it real.</p>','  <button>Let’s go</button>','</main>'];
 snippets.forEach((s,i)=>{const p=seg(u,.1+i*.15,.55+i*.15);text(String(i+1),128,765+i*55,25,'#aaa8a4',500,'left','JetBrains Mono');text(s.slice(0,Math.floor(s.length*p)),178,765+i*55,27,cols[i%4],500,'left','JetBrains Mono')});
 const entries=[['UI polish',crew[3]],['Bug fixer',crew[2]],['Tester',crew[1]]];
 entries.forEach(([label,a],i)=>{
 const x=235+i*285;rr(x-123,1028,246,66,20,'#ece9e3');mascot(a.shape,a.color,x-81,1060,44,t,u>1+i*.4?'proud':'thinking');text(label,x-42,1069,25,P.ink,650);if(u>1+i*.4)check(x+91,1060);
 });
 text('You review the changes.',520,1174,43,P.paper,550,'center');
 text('Illustrated workflow',520,1220,29,'#adaeb5',500,'center','Inter');
}
function preview(t){
 backdrop(t);title(['Idea. Code.','Live preview.'],425,112);
 const u=t-12;rr(170,635,700,459,28,P.ink);rr(183,648,674,433,20,'#eee9e1');
 text('YOUR NEXT IDEA',238,709,21,'#68666a',650,'left','Inter');
 text('Make',235,818,85,P.ink,850);text('it real.',235,920,85,P.ink,850);
 rr(235,1000,170,48,24,P.ink);text('Let’s go',320,1033,26,P.paper,600,'center');
 mascot('circle',P.blue,713,858,208,t,'proud',Math.sin(u*2)*.07);
 for(let i=0;i<18;i++){const q=out(seg(u,0,.65)),a=i*2.399,r=40+q*(140+i%3*40),x=715+Math.cos(a)*r,y=847+Math.sin(a)*r;c.save();c.globalAlpha=(1-seg(u,.5,1.2))*.8;c.translate(x,y);c.rotate(a+u*3);rr(-4,-7,8,14,3,[P.pink,P.amber,P.green][i%3]);c.restore()}
 text('Your idea stays yours to shape.',520,1168,42,P.muted,550,'center');
 text('Illustrated workflow',520,1220,29,'#8b8984',500,'center','Inter');
}
function finale(t){
 backdrop(t);title(['Build your','first idea.'],436,120);
 crew.forEach((a,i)=>{const x=240+i*140;mascot(a.shape,a.color,x,751,147,t,'proud',Math.sin(t*2+i)*.045,pop(t-15-i*.08))});
 mark(420,914,105);text('adcode',484,950,76,P.ink,800);
 rr(135,1006,770,99,49,P.ink);text('Try Adcode · link in bio',520,1073,52,P.paper,700,'center');
 text('Free editor · Windows & Linux',520,1160,39,P.ink,600,'center');
 text('Connect your AI key or local model.',520,1220,34,P.muted,500,'center');
 // Short anticipation ends in the next opening's composition, for an intentional replay.
 if(t>19.7){c.save();c.globalAlpha=smooth(seg(t,19.7,20));opening(0);c.restore()}
}
function draw(t){c.globalAlpha=1;c.setTransform(1,0,0,1,0,0);const v=Math.max(0,Math.min(19.999,t));if(v<3)opening(v);else if(v<6)meet(v);else if(v<9)prompt(v);else if(v<12)editor(v);else if(v<15)preview(v);else finale(v)}
const painted=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
async function ready(){await Promise.all([document.fonts.load('850 132px "Inter Tight"'),document.fonts.load('600 40px "Inter"'),document.fonts.load('500 27px "JetBrains Mono"')]);await document.fonts.ready;for(const f of ['Inter Tight','Inter','JetBrains Mono'])if(!document.fonts.check(`30px "${f}"`))throw new Error(`Missing font ${f}`);draw(0);await painted();return{duration:DURATION,width:W,height:H,hook}}
window.AD={ready,async render(t){draw(Number(t));await painted();return true},async soundtrack(){const {soundtrack}=await import('./audio.js');return soundtrack()}};
function fit(){canvas.style.transform=`scale(${Math.min(innerWidth/W,innerHeight/H)})`;canvas.style.marginLeft=`${Math.max(0,(innerWidth-W*Math.min(innerWidth/W,innerHeight/H))/2)}px`}
if(params.has('fit')){addEventListener('resize',fit);fit()}
if(params.has('play'))ready().then(()=>{const start=performance.now();requestAnimationFrame(function animate(now){draw((now-start)/1000%DURATION);requestAnimationFrame(animate)})});
else if(params.has('t'))ready().then(()=>draw(Number(params.get('t'))));
