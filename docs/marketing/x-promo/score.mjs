// The soundtrack for adcode-film.html: music and sound design synthesized from scratch, every
// hit placed on the same timestamps the picture uses. No samples, no dependencies.
//   node score.mjs score.wav
import { writeFileSync } from "fs";

const SR = 48000, DUR = 5.0, N = Math.round(SR * DUR);
const out = process.argv[2] || "score.wav";
const TAU = Math.PI * 2;

// ---- buses -----------------------------------------------------------------------
const dry = [new Float32Array(N), new Float32Array(N)];
const rev = [new Float32Array(N), new Float32Array(N)];
const dly = [new Float32Array(N), new Float32Array(N)];
const music = [new Float32Array(N), new Float32Array(N)]; // ducked by the kick
function put(bus, i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  const a = (clampf(pan, -1, 1) + 1) * Math.PI / 4;
  bus[0][i] += v * Math.cos(a); bus[1][i] += v * Math.sin(a);
}
function emit(i, v, { pan = 0, send = 0, delay = 0, bus = dry } = {}) {
  put(bus, i, v, pan); if (send) put(rev, i, v * send, pan); if (delay) put(dly, i, v * delay, pan);
}
const clampf = (v, a, b) => Math.min(b, Math.max(a, v));
const S = (t) => Math.round(t * SR);
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// RBJ biquad, coefficients refreshed as often as the caller sets them
class Biquad {
  constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set("lp", 1000, .7); }
  set(type, f, Q) {
    f = clampf(f, 10, SR * .45);
    const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q);
    let b0, b1, b2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass, 0 dB peak
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}

// ---- timing (120 BPM, eighth = 0.25 s) — mirrors the picture ------------------------------
const WORDS = [0.0, 0.125, 0.25, 0.375, 0.5];
const ZOOM = 1.0, WHIP = 2.12, ROLL1 = 2.75, PAYS = 3.25, LOGO = 3.75;
const KICKS = [1.25, 1.75, 2.25, 2.75, PAYS, LOGO];
const CLAPS = [1.75, 2.75];

// sidechain: the music dips on every kick and on the big hits
const duck = new Float32Array(N).fill(1);
for (const k of [ZOOM, ...KICKS]) {
  const big = k === PAYS || k === LOGO || k === ZOOM;
  for (let i = S(k) - S(.004); i < S(k + .45); i++) {
    if (i < 0 || i >= N) continue;
    const d = i / SR - k;
    if (d < 0) continue;
    duck[i] = Math.min(duck[i], 1 - (big ? .75 : .55) * Math.exp(-d / (big ? .16 : .11)) * Math.min(1, d / .004));
  }
}

// ---- instruments ----------------------------------------------------------------------
// warm pad: band-limited detuned saws through a moving low-pass
function pad(notes, t0, t1, { att = .3, rel = .5, gain = .05, cut = [600, 2400], q = .8 } = {}) {
  for (const m of notes) for (const det of [-7, 7]) {
    const f = mtof(m) * Math.pow(2, det / 1200), H = Math.max(1, Math.min(28, Math.floor(9000 / f)));
    const lp = new Biquad(); const pan = det < 0 ? -.55 : .55; let ph = rnd() * TAU;
    for (let i = S(t0); i < Math.min(N, S(t1 + rel)); i++) {
      const t = i / SR, local = t - t0;
      ph += TAU * f / SR;
      let x = 0; for (let h = 1; h <= H; h++) x += Math.sin(ph * h) / h;
      if ((i & 31) === 0) lp.set("lp", cut[0] + (cut[1] - cut[0]) * clampf(local / (t1 - t0), 0, 1), q);
      const env = Math.min(1, local / att) * (t > t1 ? Math.max(0, 1 - (t - t1) / rel) : 1);
      const y = lp.run(x) * env * gain;
      put(music, i, y, pan); put(rev, i, y * .5, pan);
    }
  }
}

// FM pluck / bell
function fm(t0, m, { gain = .08, ratio = 2, index = 2.5, idec = .08, dec = .35, pan = 0, send = .3, delay = 0, bus = dry } = {}) {
  const fc = mtof(m), fmod = fc * ratio;
  for (let i = S(t0); i < Math.min(N, S(t0 + dec * 6)); i++) {
    const t = i / SR - t0;
    const I = index * Math.exp(-t / idec);
    const y = Math.sin(TAU * fc * t + I * Math.sin(TAU * fmod * t)) * Math.exp(-t / dec) * Math.min(1, t / .002);
    emit(i, y * gain, { pan, send, delay, bus });
  }
}

// sub bass with a little saturation so it survives phone speakers
function bass(t0, t1, m, gain = .2) {
  const f = mtof(m); const lp = new Biquad().set("lp", 420, .7); let ph = 0;
  for (let i = S(t0); i < Math.min(N, S(t1)); i++) {
    const t = i / SR - t0, len = t1 - t0;
    ph += TAU * f / SR;
    const env = Math.min(1, t / .006) * Math.min(1, (len - t) / .03);
    const y = lp.run(Math.tanh(2.2 * Math.sin(ph)) * .8 + Math.sin(ph * 2) * .15);
    put(music, i, y * env * gain, 0);
  }
}

function kick(t0, { gain = .9, big = false } = {}) {
  let ph = 0;
  for (let i = S(t0); i < Math.min(N, S(t0 + (big ? 1.1 : .5))); i++) {
    const t = i / SR - t0;
    const f = (big ? 38 : 46) + (big ? 150 : 120) * Math.exp(-t / (big ? .05 : .032));
    ph += TAU * f / SR;
    const body = Math.sin(ph) * Math.exp(-t / (big ? .42 : .2));
    const click = rnd() * Math.exp(-t / .0025) * .35;
    emit(i, Math.tanh(1.6 * (body + click)) * gain, { send: big ? .08 : 0 });
  }
}

function clap(t0, gain = .32) {
  const bp = new Biquad().set("bp", 1500, 1.1), hp = new Biquad().set("hp", 600, .7);
  for (let i = S(t0); i < Math.min(N, S(t0 + .35)); i++) {
    const t = i / SR - t0;
    let env = 0; for (const o of [0, .011, .022]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) / .007));
    env = Math.max(env, t > .022 ? Math.exp(-(t - .022) / .09) * .55 : 0);
    const y = hp.run(bp.run(rnd())) * env * gain * 2.4;
    emit(i, y, { pan: .05, send: .35 });
  }
}

function hat(t0, { gain = .07, dec = .035, pan = 0 } = {}) {
  const hp = new Biquad().set("hp", 7500, .8);
  for (let i = S(t0); i < Math.min(N, S(t0 + dec * 8)); i++) {
    const t = i / SR - t0;
    emit(i, hp.run(rnd()) * Math.exp(-t / dec) * gain, { pan, send: .05 });
  }
}

// filtered-noise movement: whoosh, riser, swish
function noiseSweep(t0, t1, { f0, f1, q = 2, gain = .2, shape = "bell", pan0 = 0, pan1 = 0, send = .2, tone = 0 }) {
  const bp = new Biquad(); let ph = 0;
  for (let i = S(t0); i < Math.min(N, S(t1)); i++) {
    const x = (i / SR - t0) / (t1 - t0);
    const f = f0 * Math.pow(f1 / f0, x);
    if ((i & 15) === 0) bp.set("bp", f, q);
    const env = shape === "rise" ? Math.pow(x, 2.2) : shape === "fall" ? Math.pow(1 - x, 1.6) : Math.pow(Math.sin(Math.PI * x), 1.5);
    let y = bp.run(rnd()) * 2.2;
    if (tone) { ph += TAU * f * .25 / SR; y += Math.sin(ph) * tone; }
    emit(i, y * env * gain, { pan: pan0 + (pan1 - pan0) * x, send });
  }
}

// sub boom + rumble for the cuts that land hardest
function boom(t0, { gain = .55, f0 = 95, f1 = 34, dec = .9 } = {}) {
  let ph = 0; const lp = new Biquad().set("lp", 180, .7);
  for (let i = S(t0); i < Math.min(N, S(t0 + dec * 3)); i++) {
    const t = i / SR - t0;
    ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / .12)) / SR;
    const y = Math.sin(ph) * Math.exp(-t / dec) + lp.run(rnd()) * Math.exp(-t / .3) * .5;
    emit(i, Math.tanh(1.3 * y) * gain, { send: .15 });
  }
}

// interface sounds
function tick(t0, { gain = .14, f = 2600, pan = 0 } = {}) {
  const bp = new Biquad().set("bp", f, 3);
  for (let i = S(t0); i < Math.min(N, S(t0 + .05)); i++) {
    const t = i / SR - t0;
    emit(i, (bp.run(rnd()) * 3 + Math.sin(TAU * f * .5 * t) * .5) * Math.exp(-t / .006) * gain, { pan, send: .15 });
  }
}
function key(t0, pan) {
  const bp = new Biquad().set("bp", 3200 + rnd() * 900, 2.5);
  for (let i = S(t0); i < Math.min(N, S(t0 + .03)); i++) {
    const t = i / SR - t0;
    emit(i, (bp.run(rnd()) * 2 * Math.exp(-t / .004) + Math.sin(TAU * 190 * t) * Math.exp(-t / .01) * .4) * .06, { pan, send: .05 });
  }
}
function pop(t0, gain = .2) {
  let ph = 0;
  for (let i = S(t0); i < Math.min(N, S(t0 + .16)); i++) {
    const t = i / SR - t0;
    ph += TAU * (520 + 900 * (1 - Math.exp(-t / .02))) / SR;
    emit(i, Math.sin(ph) * Math.exp(-t / .045) * Math.min(1, t / .002) * gain, { send: .3, pan: -.25 });
  }
}

// ---- the arrangement ----------------------------------------------------------------
// harmony: Am9 (open) → Fmaj7 (product) → G (comparison) → Cmaj9 (pays you, logo)
pad([45, 52, 55, 59, 60], 0.0, 1.0, { att: .2, rel: .08, gain: .042, cut: [500, 2800] });
pad([41, 48, 52, 57, 60], 1.0, 2.25, { att: .02, rel: .06, gain: .03, cut: [900, 2200] });
pad([43, 50, 55, 59, 62], 2.25, 3.25, { att: .02, rel: .06, gain: .03, cut: [1000, 2800] });
pad([48, 52, 55, 59, 62, 64], 3.25, 4.4, { att: .02, rel: .6, gain: .032, cut: [1600, 3800] });

// bass, eighth notes, pumping
const bassPlan = [[1.0, 2.25, 29], [2.25, 3.25, 31], [3.25, 3.75, 36]];
for (const [a, b, m] of bassPlan) for (let t = a; t < b - 1e-6; t += .25) bass(t, Math.min(b, t + .22), m, .17);
bass(LOGO, 4.9, 36, .11);

// sparkle arpeggio, sixteenths, up the chord tones, ping-ponging through the delay
const arpNotes = (t) => (t < 2.25 ? [77, 81, 84, 88] : t < 3.25 ? [79, 83, 86, 91] : [84, 88, 91, 96]);
let n = 0;
for (let t = 1.25; t < 3.74; t += .125, n++) {
  const notes = arpNotes(t);
  fm(t, notes[n % 4], { gain: .045, ratio: 2, index: 2.2, idec: .05, dec: .14, pan: n % 2 ? .45 : -.45, send: .25, delay: .5, bus: music });
}

// drums
for (const k of KICKS) kick(k, { gain: k >= PAYS ? 1 : .85, big: k >= PAYS });
for (const c of CLAPS) clap(c);
for (let t = 1.375; t < 3.74; t += .25) hat(t, { gain: .075, pan: .2 });
for (let t = 1.25; t < 3.74; t += .125) hat(t + .0625, { gain: .025, dec: .015, pan: -.2 });
hat(3.0, { gain: .07, dec: .18, pan: .1 });

// 1 — words land: soft ticks rising in pitch, under a swelling riser
WORDS.forEach((t, i) => tick(t + .02, { gain: .26, f: 2000 + i * 300, pan: -.3 + i * .15 }));
noiseSweep(.35, ZOOM, { f0: 400, f1: 7000, q: 1.6, gain: .22, shape: "rise", send: .3, tone: .25 });

// zoom through the "AI." into the product
boom(ZOOM, { gain: .5 });
noiseSweep(ZOOM - .02, ZOOM + .45, { f0: 5000, f1: 300, q: 1.2, gain: .2, shape: "fall", send: .25 });

// 2 — AI writes the code; keystrokes, accept, the earnings card
tick(1.18, { gain: .12, f: 1800, pan: .4 });
for (let t = 1.28, i = 0; t < 1.66; t += .034 + (rnd() + 1) * .008, i++) key(t, -.2 + rnd() * .2);
tick(1.7, { gain: .2, f: 3200, pan: .1 });
pop(1.76, .22);
fm(1.84, 84, { gain: .06, ratio: 3.5, index: 1.2, idec: .2, dec: .5, pan: -.3, send: .45 });
fm(1.9, 91, { gain: .045, ratio: 3.5, index: 1.2, idec: .2, dec: .5, pan: -.1, send: .45 });

// whip-pan to the comparison: right-to-left whoosh
noiseSweep(WHIP - .14, WHIP + .26, { f0: 600, f1: 4500, q: 1.4, gain: .3, pan0: .7, pan1: -.7, send: .2 });

// the two rolls
noiseSweep(ROLL1 - .06, ROLL1 + .14, { f0: 1500, f1: 6000, q: 2, gain: .13, send: .1 });
noiseSweep(PAYS - .06, PAYS + .14, { f0: 1500, f1: 6000, q: 2, gain: .13, send: .1 });

// 3 — "pays you.": impact + a quick rising bell flourish
boom(PAYS, { gain: .45, f0: 110, f1: 40, dec: .5 });
[84, 88, 91, 96, 100].forEach((m, i) => fm(PAYS + .02 + i * .035, m, { gain: .07 - i * .006, ratio: 3.5, index: 1.6, idec: .15, dec: .6, pan: -.4 + i * .2, send: .5 }));
noiseSweep(PAYS, PAYS + .9, { f0: 9000, f1: 12000, q: .7, gain: .05, shape: "fall", send: .6 });

// reverse swell into the logo
noiseSweep(3.45, LOGO, { f0: 1200, f1: 9000, q: .9, gain: .16, shape: "rise", send: .2 });

// 4 — logo sting: the resolution
boom(LOGO, { gain: .6, f0: 90, f1: 32, dec: 1.0 });
[60, 67, 72, 76, 79, 84].forEach((m, i) => fm(LOGO + .015 + i * .028, m, { gain: .085 - i * .007, ratio: 3.5, index: 1.1, idec: .3, dec: 1.1, pan: -.5 + i * .2, send: .6 }));
fm(4.12, 88, { gain: .035, ratio: 3.5, index: .8, idec: .3, dec: .7, pan: .3, send: .6 });   // tick strokes land
noiseSweep(4.42, 4.95, { f0: 5000, f1: 11000, q: 1.2, gain: .04, send: .4 });                 // URL shine

// ---- effects ------------------------------------------------------------------------
// stereo ping-pong delay, dotted eighth
{
  const d = S(.375), fb = .38;
  for (let i = 0; i < N; i++) {
    const l = i >= d ? dly[1][i - d] * fb : 0, r = i >= d ? dly[0][i - d] * fb : 0;
    dly[0][i] += l; dly[1][i] += r;
  }
  for (let i = 0; i < N; i++) { music[0][i] += dly[1][i] * .5; music[1][i] += dly[0][i] * .5; }
}
// Freeverb
function freeverb(input, spread) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((x) => Math.round((x + spread) * SR / 44100));
  const aps = [556, 441, 341, 225].map((x) => Math.round((x + spread) * SR / 44100));
  const fb = .86, damp = .25, o = new Float32Array(N);
  const cb = combs.map((L) => ({ b: new Float32Array(L), i: 0, s: 0 }));
  const ab = aps.map((L) => ({ b: new Float32Array(L), i: 0 }));
  for (let n = 0; n < N; n++) {
    const x = input[n] * .015; let y = 0;
    for (const c of cb) { const v = c.b[c.i]; c.s = v * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * fb; c.i = (c.i + 1) % c.b.length; y += v; }
    for (const a of ab) { const v = a.b[a.i]; a.b[a.i] = y + v * .5; a.i = (a.i + 1) % a.b.length; y = v - y; }
    o[n] = y;
  }
  return o;
}
const wetL = freeverb(rev[0], 0), wetR = freeverb(rev[1], 23);

// ---- master -------------------------------------------------------------------------
const L = new Float32Array(N), R = new Float32Array(N);
const hpL = new Biquad().set("hp", 28, .7), hpR = new Biquad().set("hp", 28, .7);
for (let i = 0; i < N; i++) {
  L[i] = hpL.run(dry[0][i] + music[0][i] * duck[i] + wetL[i] * 2.2);
  R[i] = hpR.run(dry[1][i] + music[1][i] * duck[i] + wetR[i] * 2.2);
}
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const drive = 1.6 / peak;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / .004) * Math.min(1, (DUR - t) / .12);
  L[i] = Math.tanh(L[i] * drive) * .89 * fade; R[i] = Math.tanh(R[i] * drive) * .89 * fade;
}

// ---- 24-bit WAV ------------------------------------------------------------------------
const buf = Buffer.alloc(44 + N * 6);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 6, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 6, 28); buf.writeUInt16LE(6, 32); buf.writeUInt16LE(24, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 6, 40);
for (let i = 0; i < N; i++) for (let c = 0; c < 2; c++) {
  const v = Math.round(clampf(c ? R[i] : L[i], -1, 1) * 8388607);
  buf.writeIntLE(v, 44 + i * 6 + c * 3, 3);
}
writeFileSync(out, buf);
console.log("wrote", out, "peak before master", peak.toFixed(3));
