// Deterministic, editable motion design. All timing is in seconds.
const ctx = document.querySelector('canvas').getContext('2d');
const WHITE = '#f1f0e9';
const BLACK = '#080808';
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => 1 - (1 - clamp(x)) ** 4;
const enter = (t, at, length = .5) => ease((t - at) / length);
function text(value, x, y, size, weight = 700, color = WHITE, align = 'left', family = 'Inter Tight') {
  ctx.fillStyle = color; ctx.font = `${weight} ${size}px "${family}"`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(value, x, y);
}
function line(x1, y1, x2, y2, color, width = 1) {
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.stroke();
}
function box(x,y,w,h,r,fill,stroke) {
  ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fillStyle=fill; ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
}
function mark(x,y,size,color=WHITE,spread=0) {
  ctx.save();ctx.translate(x,y);ctx.scale(size/1024,size/1024);
  ctx.strokeStyle=color;ctx.lineCap='round';ctx.lineJoin='round';
  const paths=[['M320 348L140 512L320 676',96,-spread],['M704 348L884 512L704 676',96,spread],['M512 296V388',64,0],['M512 636V728',64,0],['M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619',92,0]];
  for(const [d,w,dx] of paths){ctx.save();ctx.translate(dx,0);ctx.lineWidth=w;ctx.stroke(new Path2D(d));ctx.restore();}
  ctx.restore();
}
function header(t, dark=false) {
  const color=dark?BLACK:WHITE;
  mark(58,43,66,color);text('adcode',133,90,33,650,color);
  text('IDEAS INTO REALITY',1008,83,16,400,dark?'#555':'#777','right','JetBrains Mono');
  line(72,120,1008,120,dark?'#c8c7c1':'#252525');
}
function headline(value,y,t,at,color=WHITE) {
  const p=enter(t,at,.48);
  ctx.save();ctx.beginPath();ctx.rect(60,y-190,960,220);ctx.clip();
  text(value,72,y+210*(1-p),174,800,color);ctx.restore();
}
function drawThink(t) {
  header(t);
  text('FROM A SPARK',76,267,19,400,'#92928e','left','JetBrains Mono');
  headline('Think it.',486,t,-.16);
  // An idea starts as a cursor and opens into a prompt field.
  const p=enter(t,.15,.6);
  box(76,579,928*p,134,22,'#151515','#333');
  ctx.save();ctx.globalAlpha=p;
  text('An idea worth building',111,659,34,450,'#c6c6c0','left','Inter');
  box(903,613,64,64,32,WHITE);text('↗',935,657,40,500,BLACK,'center');
  ctx.restore();
  const sweep=enter(t,.05,.9);
  line(77,824,77+925*sweep,824,'#444',2);
  ctx.fillStyle=WHITE;ctx.beginPath();ctx.arc(77+925*sweep,824,5,0,Math.PI*2);ctx.fill();
  text('YOU BRING THE VISION.',76,924,18,400,'#888','left','JetBrains Mono');
}
function drawEditor(t) {
  const p=enter(t,1.26,.5);
  ctx.save();ctx.translate(540,699+110*(1-p));ctx.rotate((1-p)*-.055);ctx.scale(.91+.09*p,.91+.09*p);ctx.translate(-540,-699);
  ctx.shadowColor='#00000024';ctx.shadowBlur=45;ctx.shadowOffsetY=24;
  box(74,472,932,429,20,'#111');ctx.shadowColor='transparent';
  box(74,472,932,58,20,'#202020');ctx.fillStyle='#202020';ctx.fillRect(74,508,932,22);
  for(let i=0;i<3;i++){ctx.fillStyle=['#777','#555','#444'][i];ctx.beginPath();ctx.arc(103+i*21,501,5,0,7);ctx.fill();}
  text('hello-world.tsx',201,508,17,400,'#aaa','left','JetBrains Mono');
  text('adcode',972,509,21,650,WHITE,'right');
  line(638,531,638,901,'#303030');
  const rows=[['01','const idea = "Something great";'],['02',''],['03','export function App() {'],['04','  return ('],['05','    <main>'],['06','      <h1>Hello, world.</h1>'],['07','    </main>'],['08','  );'],['09','}']];
  const progress=clamp((t-1.4)/.88)*rows.length;
  rows.forEach(([n,s],i)=>{text(n,98,577+i*33,15,400,'#575757','left','JetBrains Mono');text(s.slice(0,Math.ceil(clamp(progress-i)*s.length)),145,577+i*33,17,400,i===5?WHITE:'#aaa','left','JetBrains Mono');});
  text('AI ASSISTANT',668,573,14,500,'#999','left','JetBrains Mono');
  text('Let’s build your idea.',668,623,23,550,WHITE);
  const a=enter(t,1.7,.4);ctx.globalAlpha=a;
  box(668,657,306,88,12,'#202020');text('Creating your app',687,693,19,450,WHITE);text('App.tsx',687,723,15,400,'#929292','left','JetBrains Mono');
  ctx.fillStyle='#b7b7b2';ctx.fillRect(668,773,306*enter(t,1.62,.67),3);
  const done=enter(t,2.15,.2);ctx.globalAlpha=done;text('✓  Ready to preview',668,831,21,500,WHITE);
  ctx.restore();
}
function drawBuild(t) {
  ctx.fillStyle=WHITE;ctx.fillRect(0,0,1080,1080);header(t,true);
  text('TO YOUR NEXT CREATION',76,235,19,400,'#62625c','left','JetBrains Mono');
  headline('Build it.',423,t,1.04,BLACK);drawEditor(t);
  text('CODE + AI. ONE WORKSPACE.',76,983,18,400,'#55554f','left','JetBrains Mono');
}
function drawEnd(t) {
  const p=enter(t,2.95,.6);
  const glow=ctx.createRadialGradient(540,408,0,540,408,460);
  glow.addColorStop(0,'#252525');glow.addColorStop(.55,'#111111');glow.addColorStop(1,BLACK);
  ctx.fillStyle=glow;ctx.fillRect(0,0,1080,1080);
  ctx.save();ctx.globalAlpha=.35*p;ctx.strokeStyle='#484848';ctx.lineWidth=1;
  for(const r of [238,330,432]){ctx.beginPath();ctx.arc(540,405,r+25*(1-p),0,Math.PI*2);ctx.stroke();}ctx.restore();
  // Brackets assemble around the original dollar ribbon geometry.
  const size=300+50*(1-p);mark(540-size/2,249-35*(1-p),size,WHITE,(1-p)*450);
  ctx.save();ctx.globalAlpha=enter(t,3.04,.4);
  text('adcode',540,649+36*(1-p),142,750,WHITE,'center');ctx.restore();
  ctx.save();ctx.globalAlpha=enter(t,3.18,.4);
  text('Your AI-native IDE.',540,725+20*(1-p),37,450,'#bdbdb6','center','Inter');ctx.restore();
  ctx.save();const c=enter(t,3.42,.32);ctx.globalAlpha=c;
  box(353,804+15*(1-c),374,76,38,WHITE);text('Start creating  ↗',540,852+15*(1-c),28,600,BLACK,'center');
  text('adcode.bluethenics.com',540,965,23,400,'#aaa9a2','center','Inter');ctx.restore();
}
function render(t) {
  ctx.globalAlpha=1;ctx.fillStyle=BLACK;ctx.fillRect(0,0,1080,1080);
  if(t<1.03) drawThink(t);
  else if(t<2.82) drawBuild(t);
  else drawEnd(t);
  // Fast graphic shutters conceal the scene changes without a blank frame.
  for(const at of [1.03,2.82]) {
    const d=t-at;
    if(d>=0 && d<.24){const p=clamp(d/.24);ctx.fillStyle=at===1.03?BLACK:WHITE;ctx.fillRect(0,0,1080*(1-ease(p)),1080);}
  }
  // Fixed micro grain, subtly moving scanline; no random frame-to-frame flicker.
  ctx.fillStyle='#ffffff03';for(let y=0;y<1080;y+=4)ctx.fillRect(0,y,1080,1);
}
window.AD={
  async ready(){await Promise.all([document.fonts.load('800 174px "Inter Tight"'),document.fonts.load('450 34px "Inter"'),document.fonts.load('400 17px "JetBrains Mono"')]);await document.fonts.ready;render(0);},
  async render(t){render(t);await new Promise(requestAnimationFrame);}
};
await AD.ready();
if(new URLSearchParams(location.search).has('play')){const start=performance.now();function tick(now){render(((now-start)/1000)%5);requestAnimationFrame(tick);}requestAnimationFrame(tick);}
