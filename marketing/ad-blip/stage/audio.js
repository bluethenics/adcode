/**
 * The soundtrack, synthesised offline from the cue sheet so every hit lands on its frame.
 * Seeded noise: it renders identically every time. Returned as 16-bit stereo WAV bytes.
 * Nothing sampled, nothing licensed - original music, so the Reel carries its own audio.
 *
 *   0–5.4    night: a lonely A-minor pad, a music box, the clock ticking on the grid.
 *            Montage slams on every cut, the mug shivers, the clock ratchets, the phone swipes.
 *   5.4–8.2  the fact falls (whistle) and lands (boom); one tick per percent; a slide
 *            whistle deflates on "That's a lot of waiting."
 *   8.2–8.4  silence. The master gate holds it shut so the "!" lands in a clean room.
 *   8.4–11.2 the idea: a bell, a heartbeat under the question, a riser, a coin, a crack,
 *            two ka-chings, a snare fill.
 *  11.2      the drop, 120 BPM from this downbeat: C – G – Am – F. The sonic logo -
 *            E G A C - plays under "Get paid to wait." and comes back on the end card.
 *  13.2      six boings climbing a pentatonic as the crew lands; each act has its own sound.
 *  17.7      a gap, then "It works!": crash, stab, confetti pops, a cheer.
 *  19.2      flips, dings, a race and a fanfare.
 *  23.7      the groove falls away; the music box comes back in major. "Thanks for waiting."
 *  25.7      the end card: shimmer, the logo melody, a soft beat; 28.5 a scroll whoosh and
 *            a fade to nothing, so the loop into frame 0 is seamless.
 * Every babble syllable comes from cues.js SYLLABLES, the same list the mouths move to.
 */
import { BEAT, CAST, CUE, DROP, DURATION, SYLLABLES } from "./cues.js";

const RATE = 48000;
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "A4", "C#5", "Bb3" → Hz. */
function hz(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  const semis = NAMES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * 2 ** ((semis - 69) / 12);
}
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let v = Math.imul(state ^ (state >>> 15), 1 | state);
    v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

const FORMANTS = { a: [850, 1250], e: [450, 2100], i: [320, 2500], o: [540, 900], u: [380, 760] };
const PAN = { blip: 0, hex: -0.4, pip: 0.32, bloom: 0.5, patch: -0.22, quill: -0.55 };

export async function renderSoundtrack() {
  const ctx = new OfflineAudioContext(2, Math.round(DURATION * RATE), RATE);
  const random = rng(4242);
  const noise = ctx.createBuffer(1, RATE * 2, RATE);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 - 1;

  // ── Mix: buses → glue → limiter → out, with a shared room ──
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16; glue.knee.value = 8; glue.ratio.value = 2.6; glue.attack.value = 0.008; glue.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.9, 0.03);
  master.gain.setValueAtTime(0.9, CUE.gate - 0.01);
  master.gain.linearRampToValueAtTime(0, CUE.gate);
  master.gain.setValueAtTime(0, CUE.badge - 0.004);
  master.gain.linearRampToValueAtTime(0.9, CUE.badge);
  master.gain.setValueAtTime(0.9, DURATION - 0.25);
  master.gain.linearRampToValueAtTime(0, DURATION - 0.01);
  master.connect(glue).connect(limiter).connect(ctx.destination);

  const room = ctx.createConvolver();
  const tail = ctx.createBuffer(2, Math.round(RATE * 2.2), RATE);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = tail.getChannelData(ch);
    for (let i = 0; i < d.length; i += 1) d[i] = (random() * 2 - 1) * (1 - i / d.length) ** 3.2;
  }
  room.buffer = tail;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  room.connect(wet).connect(master);

  const bus = (level) => { const g = ctx.createGain(); g.gain.value = level; g.connect(master); return g; };
  const fx = bus(0.8);
  const voices = bus(1.15);
  const night = bus(0.55);
  // The groove bus carries drums, bass and chords from the drop to the close.
  const groove = bus(0.0);
  groove.gain.setValueAtTime(0, 0);
  groove.gain.setValueAtTime(0, DROP - 0.01);
  groove.gain.linearRampToValueAtTime(0.85, DROP);
  groove.gain.setValueAtTime(0.85, CUE.works - 0.15);
  groove.gain.linearRampToValueAtTime(0, CUE.works - 0.1);
  groove.gain.setValueAtTime(0, CUE.works - 0.005);
  groove.gain.linearRampToValueAtTime(0.85, CUE.works);
  groove.gain.setValueAtTime(0.85, CUE.close);
  groove.gain.linearRampToValueAtTime(0, CUE.close + 0.25);
  groove.gain.setValueAtTime(0, CUE.end + 0.45);
  groove.gain.linearRampToValueAtTime(0.5, CUE.end + 0.5);
  groove.gain.setValueAtTime(0.5, CUE.scroll);
  groove.gain.linearRampToValueAtTime(0, CUE.scroll + 0.3);

  const send = (node, amount) => { const g = ctx.createGain(); g.gain.value = amount; node.connect(g).connect(room); };
  const panner = (pan) => { const p = ctx.createStereoPanner(); p.pan.value = pan; return p; };
  const filter = (type, frequency, q = 1) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = q; return f; };
  const env = (gain, t, level, attack, decay) => {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noiseSource = (t, duration) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(Math.max(0, t), random() * 1.5, duration + 0.05);
    return s;
  };
  const ok = (t) => t >= 0 && t < DURATION;

  // ── Instruments ──
  function tone(t, f, dur, level, type = "sine", toF = null, out = fx, pan = 0, attack = 0.004) {
    if (!ok(t)) return null;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (toF) o.frequency.exponentialRampToValueAtTime(toF, t + dur);
    env(g, t, level, attack, dur);
    o.connect(g).connect(panner(pan)).connect(out);
    o.start(t); o.stop(t + attack + dur + 0.05);
    return g;
  }
  function kick(t, level = 1, out = groove) {
    if (!ok(t)) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    env(g, t, level, 0.002, 0.36);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.45);
    const c = noiseSource(t, 0.02); const cg = ctx.createGain();
    env(cg, t, 0.18 * level, 0.001, 0.015);
    c.connect(filter("highpass", 3000)).connect(cg).connect(out);
  }
  function clap(t, level = 0.4, out = groove) {
    if (!ok(t)) return;
    const s = noiseSource(t, 0.3); const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (const off of [0, 0.01, 0.021]) {
      g.gain.setValueAtTime(level, t + off);
      g.gain.exponentialRampToValueAtTime(level * 0.2, t + off + 0.009);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    s.connect(filter("bandpass", 1600, 0.9)).connect(g).connect(out);
    send(g, 0.25);
  }
  function snare(t, level = 0.3, out = fx) {
    if (!ok(t)) return;
    const s = noiseSource(t, 0.15); const g = ctx.createGain();
    env(g, t, level, 0.001, 0.12);
    s.connect(filter("bandpass", 2400, 0.7)).connect(g).connect(out);
    tone(t, 210, 0.08, level * 0.6, "triangle", 160, out);
  }
  function hat(t, level = 0.06, pan = 0, open = false) {
    if (!ok(t)) return;
    const s = noiseSource(t, open ? 0.25 : 0.05); const g = ctx.createGain();
    env(g, t, level, 0.001, open ? 0.2 : 0.035);
    s.connect(filter("highpass", 8200)).connect(g).connect(panner(pan)).connect(groove);
  }
  function crash(t, level = 0.3) {
    if (!ok(t)) return;
    const s = noiseSource(t, 1.8); const g = ctx.createGain();
    env(g, t, level, 0.003, 1.6);
    s.connect(filter("highpass", 5200)).connect(g).connect(fx);
    send(g, 0.4);
  }
  function boom(t, level = 0.8, dur = 1.2) {
    if (!ok(t)) return;
    tone(t, 70, dur, level, "sine", 32, fx);
    const s = noiseSource(t, dur); const g = ctx.createGain();
    env(g, t, level * 0.5, 0.004, dur * 0.6);
    s.connect(filter("lowpass", 220)).connect(g).connect(fx);
  }
  function whoosh(t, dur, level = 0.15, up = true, pan = 0) {
    if (!ok(t)) return;
    const s = noiseSource(t, dur); const g = ctx.createGain(); const f = filter("bandpass", up ? 400 : 4000, 1.4);
    f.frequency.setValueAtTime(up ? 400 : 4000, t);
    f.frequency.exponentialRampToValueAtTime(up ? 4500 : 350, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(panner(pan)).connect(fx);
  }
  function riser(t0, t1, level = 0.12) {
    if (!ok(t0)) return;
    const s = noiseSource(t0, t1 - t0); const g = ctx.createGain(); const f = filter("bandpass", 300, 2);
    f.frequency.setValueAtTime(300, t0);
    f.frequency.exponentialRampToValueAtTime(7000, t1);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t1 - 0.02);
    g.gain.linearRampToValueAtTime(0, t1);
    s.connect(f).connect(g).connect(fx);
    const o = ctx.createOscillator(); const og = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(880, t1);
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(level * 0.25, t1 - 0.02);
    og.gain.linearRampToValueAtTime(0, t1);
    o.connect(filter("lowpass", 2400)).connect(og).connect(fx);
    o.start(t0); o.stop(t1 + 0.05);
  }
  /** Marimba: a fundamental and its bright fourth partial, quick decay. */
  function pluck(t, f, level = 0.08, pan = 0, out = groove, dur = 0.5) {
    tone(t, f, dur, level, "sine", null, out, pan, 0.002);
    tone(t, f * 3.94, dur * 0.18, level * 0.35, "sine", null, out, pan, 0.001);
  }
  function musicBox(t, f, level = 0.09, pan = 0, out = night) {
    const a = tone(t, f, 1.3, level, "sine", null, out, pan, 0.002);
    tone(t, f * 2.003, 0.6, level * 0.35, "sine", null, out, pan, 0.002);
    tone(t, f * 3.01, 0.25, level * 0.12, "triangle", null, out, pan, 0.002);
    if (a) send(a, 0.5);
  }
  function bell(t, f, level = 0.1, pan = 0) {
    [[1, 1, 1.4], [2.76, 0.4, 0.8], [5.4, 0.18, 0.4], [8.93, 0.08, 0.25]].forEach(([m, l, d]) => {
      const g = tone(t, f * m, d, level * l, "sine", null, fx, pan, 0.002);
      if (g) send(g, 0.35);
    });
  }
  /** The classic two-note coin. */
  function coin(t, level = 0.09, pan = 0) {
    tone(t, hz("B5"), 0.07, level, "square", null, fx, pan, 0.001);
    const g = tone(t + 0.075, hz("E6"), 0.42, level, "square", null, fx, pan, 0.001);
    if (g) send(g, 0.2);
  }
  function pop(t, level = 0.12, pan = 0, base = 380) {
    tone(t, base, 0.07, level, "sine", base * 2.4, fx, pan, 0.002);
  }
  function boing(t, f, level = 0.1, pan = 0) {
    if (!ok(t)) return;
    const o = ctx.createOscillator(); const g = ctx.createGain(); const lfo = ctx.createOscillator(); const depth = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f * 0.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    lfo.frequency.value = 22;
    depth.gain.setValueAtTime(f * 0.08, t);
    depth.gain.exponentialRampToValueAtTime(1, t + 0.3);
    lfo.connect(depth).connect(o.frequency);
    env(g, t, level, 0.003, 0.32);
    o.connect(g).connect(panner(pan)).connect(fx);
    o.start(t); o.stop(t + 0.4); lfo.start(t); lfo.stop(t + 0.4);
  }
  function slideWhistle(t, f0, f1, dur, level = 0.08) {
    if (!ok(t)) return;
    const o = ctx.createOscillator(); const g = ctx.createGain(); const lfo = ctx.createOscillator(); const depth = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    lfo.frequency.value = 6; depth.gain.value = 14;
    lfo.connect(depth).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.04);
    g.gain.setValueAtTime(level, t + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(fx);
    o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
  }
  function tick(t, level = 0.05, f = 3200, pan = 0, out = fx) {
    if (!ok(t)) return;
    const s = noiseSource(t, 0.02); const g = ctx.createGain();
    env(g, t, level, 0.001, 0.015);
    s.connect(filter("bandpass", f, 3)).connect(g).connect(panner(pan)).connect(out);
  }
  function scribble(t, dur = 0.32, level = 0.06) {
    if (!ok(t)) return;
    const s = noiseSource(t, dur); const g = ctx.createGain(); const f = filter("bandpass", 2400, 4);
    for (let k = 0; k < 8; k += 1) f.frequency.setValueAtTime(1800 + (k % 2) * 1600, t + (k * dur) / 8);
    env(g, t, level, 0.01, dur);
    s.connect(f).connect(g).connect(fx);
  }
  function splat(t, level = 0.3) {
    boom(t, level * 0.6, 0.25);
    const s = noiseSource(t, 0.2); const g = ctx.createGain(); const f = filter("bandpass", 1800, 2);
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.18);
    env(g, t, level, 0.002, 0.18);
    s.connect(f).connect(g).connect(fx);
  }
  function pad(t0, t1, notes, level = 0.05, cutoff = 1400, out = night) {
    if (!ok(t0)) return;
    const f = filter("lowpass", cutoff, 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(level, t0 + Math.min(0.6, (t1 - t0) / 3));
    g.gain.setValueAtTime(level, Math.max(t0 + 0.6, t1 - 0.4));
    g.gain.linearRampToValueAtTime(0.0001, t1);
    f.connect(g).connect(out);
    send(g, 0.4);
    for (const n of notes) {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(n);
        o.detune.value = detune;
        o.connect(f);
        o.start(t0); o.stop(t1 + 0.05);
      }
    }
  }
  function bass(t, f, dur = 0.22, level = 0.3) {
    if (!ok(t)) return;
    const o = ctx.createOscillator(); const s = ctx.createOscillator(); const g = ctx.createGain(); const lp = filter("lowpass", 700, 1.2);
    o.type = "sine"; s.type = "sawtooth";
    o.frequency.value = f; s.frequency.value = f;
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    env(g, t, level, 0.004, dur);
    o.connect(g); s.connect(lp).connect(g);
    g.connect(groove);
    o.start(t); s.start(t); o.stop(t + dur + 0.05); s.stop(t + dur + 0.05);
  }
  /** A babble syllable: a buzzy pitched blip through two vowel formants. */
  function syllable({ who, t, d, semi, vowel, gain }) {
    if (!ok(t)) return;
    const f0 = CAST[who].voice * 2 ** (semi / 12);
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0 * 1.08, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.03);
    o.frequency.setValueAtTime(f0, t + d * 0.6);
    o.frequency.exponentialRampToValueAtTime(f0 * (semi > 4 ? 1.12 : 0.94), t + d);
    const [f1, f2] = FORMANTS[vowel].map((f) => f * 1.35);
    const a = filter("bandpass", f1, 5); const b = filter("bandpass", f2, 7); const dry = filter("lowpass", 2600);
    const ga = ctx.createGain(); ga.gain.value = 1.4;
    const gb = ctx.createGain(); gb.gain.value = 0.9;
    const gd = ctx.createGain(); gd.gain.value = 0.18;
    o.connect(a).connect(ga).connect(g);
    o.connect(b).connect(gb).connect(g);
    o.connect(dry).connect(gd).connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34 * gain, t + 0.008);
    g.gain.setValueAtTime(0.34 * gain, t + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.02);
    const p = panner(PAN[who] ?? 0);
    g.connect(p).connect(voices);
    send(g, 0.12);
    o.start(t); o.stop(t + d + 0.06);
  }

  // ════════════ 0–5.4 · Night ════════════
  pad(0, 2.0, ["A2", "E3", "A3", "C4", "E4"], 0.03, 1100);
  pad(4.0, 5.4, ["F2", "C3", "A3", "C4", "E4"], 0.03, 1000);
  for (let tt = DROP - 22 * BEAT; tt < CUE.mug; tt += BEAT) tick(tt, 0.05, tt % 1 < 0.5 ? 3600 : 2800, 0.4); // tick, tock
  for (let tt = CUE.best + 0.2; tt < CUE.fact; tt += BEAT) tick(tt, 0.05, 3200, 0.4);
  [[0.2, "A4"], [0.7, "C5"], [1.2, "E5"], [1.45, "D5"], [1.7, "C5"]].forEach(([tt, n]) => musicBox(tt, hz(n), 0.085, 0.15));
  [[4.2, "E5"], [4.7, "D5"], [4.95, "C5"], [5.2, "B4"]].forEach(([tt, n]) => musicBox(tt, hz(n), 0.085, 0.15));
  // The montage: a slam on every cut.
  for (const [tt, n] of [[CUE.mug, "A2"], [CUE.clock, "C3"], [CUE.phone, "E3"]]) {
    kick(tt, 0.9, fx);
    tone(tt, hz(n), 0.3, 0.16, "triangle", null, fx);
    tick(tt + 0.01, 0.08, 5200);
    whoosh(tt - 0.12, 0.12, 0.1, true);
  }
  // The mug goes cold: a shiver down.
  tone(CUE.mug + 0.25, 700, 0.4, 0.04, "sine", 220, fx, -0.2);
  for (let k = 0; k < 8; k += 1) tick(CUE.mug + 0.3 + k * 0.035, 0.03, 6000, (k % 2 ? 0.5 : -0.5));
  // The clock ratchets.
  for (let tt = CUE.clock + 0.04; tt < CUE.phone - 0.05; tt += 0.045) tick(tt, 0.055, Math.round((tt - CUE.clock) / 0.045) % 2 ? 4200 : 3000, 0.2);
  // The phone swipes.
  for (const tt of [CUE.phone + 0.05, CUE.phone + 0.22, CUE.phone + 0.39]) whoosh(tt, 0.14, 0.12, true, 0.3);
  // Back to Blip: a soft landing.
  tone(CUE.best, hz("A2"), 0.6, 0.1, "sine", null, fx);

  // ════════════ 5.4–8.2 · The fact ════════════
  slideWhistle(CUE.fact, 1900, 420, CUE.factLand - CUE.fact, 0.05);
  boom(CUE.factLand, 0.9, 1.0);
  kick(CUE.factLand, 1, fx);
  crash(CUE.factLand, 0.16);
  pad(CUE.factLand, CUE.gate, ["D3", "A3", "D4", "F4", "G4"], 0.028, 1300);
  for (let n = 32; n <= 59; n += 1) {
    const tt = CUE.count + (CUE.countEnd - CUE.count) * (1 - Math.cbrt(1 - (n - 31) / 28));
    tone(tt, 520 * 2 ** (((n - 31) / 28) * 1.6), 0.035, 0.04, "square", null, fx, 0.15);
  }
  bell(CUE.countEnd, hz("E6"), 0.07, 0.2);
  whoosh(CUE.countEnd + 0.02, 0.3, 0.06, true, 0.2);
  slideWhistle(CUE.lot, 900, 240, 0.6, 0.055);

  // ════════════ 8.4–11.2 · The idea ════════════
  bell(CUE.badge, hz("E6"), 0.12);
  bell(CUE.badge + 0.08, hz("B6"), 0.07, 0.2);
  pop(CUE.ask, 0.1);
  for (const tt of [8.7, 9.2, 9.7, 10.2]) { kick(tt, 0.45, fx); kick(tt + 0.16, 0.28, fx); }
  pad(CUE.ask, DROP, ["A2", "E3", "G3", "C4", "D4"], 0.024, 900);
  riser(9.7, DROP, 0.13);
  whoosh(CUE.card - 0.05, 0.25, 0.12, false, 0.6);
  pop(CUE.card + 0.2, 0.1, 0.4, 500);
  tone(CUE.coin, 300, 0.14, 0.12, "sine", 1300, fx);
  for (let k = 0; k < 9; k += 1) tone(CUE.coin + k * 0.033, k % 2 ? hz("E7") : hz("B6"), 0.03, 0.025, "sine", null, fx, (k % 2 ? 0.3 : -0.3));
  tick(CUE.split, 0.3, 2400);
  tick(CUE.split + 0.004, 0.25, 6500);
  coin(CUE.split + 0.01, 0.08);
  coin(CUE.split + 0.24, 0.07, -0.6);
  coin(CUE.split + 0.3, 0.07, 0.6);
  for (const [tt, l] of [[10.95, 0.12], [11.0, 0.14], [11.05, 0.16], [11.1, 0.18], [11.14, 0.2], [11.17, 0.22]]) snare(tt, l);

  // ════════════ 11.2–23.7 · The groove: C – G – Am – F ════════════
  const BARS = [
    ["C2", ["C4", "E4", "G4"]], ["G2", ["B3", "D4", "G4"]], ["A2", ["C4", "E4", "A4"]], ["F2", ["C4", "F4", "A4"]],
    ["C2", ["C4", "E4", "G4"]], ["G2", ["B3", "D4", "G4"]], ["A2", ["C4", "E4", "A4"]],
  ];
  const beats = Math.round((CUE.close - DROP) / BEAT);
  for (let k = 0; k < beats; k += 1) {
    const b = DROP + k * BEAT;
    const [root, chord] = BARS[Math.floor(k / 4) % BARS.length];
    kick(b, 0.95);
    if (k % 2 === 1) clap(b, 0.38);
    hat(b + BEAT / 2, 0.07, 0.25);
    hat(b, 0.03, -0.25);
    hat(b + BEAT / 4, 0.022, 0.4);
    hat(b + (3 * BEAT) / 4, 0.022, -0.4);
    bass(b, hz(root), 0.2, 0.32);
    bass(b + BEAT / 2, hz(root) * (k % 2 ? 2 : 1), 0.16, 0.24);
    chord.forEach((n, j) => pluck(b + BEAT / 2 + j * 0.012, hz(n), 0.035, (j - 1) * 0.4));
    if (k % 4 === 0) pad(b, b + 4 * BEAT, [chord[0].replace(/\d/, "3"), ...chord], 0.015, 1800, groove);
  }
  // The drop, and the sonic logo under "Get paid to wait."
  crash(DROP, 0.28);
  boom(DROP, 0.7, 0.9);
  ["E5", "G5", "A5", "C6"].forEach((n, i) => { pluck(DROP + i * 0.125, hz(n), 0.12, 0, fx, 0.7); bell(DROP + i * 0.125, hz(n), 0.03); });
  pop(DROP + 0.4, 0.06, 0, 520);

  // The crew lands, one boing each, climbing a pentatonic.
  ["C5", "D5", "E5", "G5", "A5", "C6"].forEach((n, i) => {
    boing(CUE.intro[i] + (i === 0 ? 0.17 : 0.17), hz(n) / 2, 0.11, (i % 2 ? -0.3 : 0.3));
    whoosh(CUE.intro[i] + 0.02, 0.14, 0.06, false, i % 2 ? -0.5 : 0.5);
  });
  pop(CUE.build + 0.12, 0.08, 0, 440);
  // Each one's act.
  const A = CUE.acts;
  pop(CUE.work - 0.06, 0.12, 0, 300);
  for (let k = 0; k < 7; k += 1) tick(A[0] + k * 0.045, 0.06, 2600 + (k % 3) * 500, -0.1);
  whoosh(A[1] - 0.05, 0.4, 0.07, true, -0.4);
  [0, 0.07, 0.14].forEach((d) => tick(A[2] + 0.1 + d, 0.07, 5000, 0.3));
  bell(A[2] + 0.22, hz("G6"), 0.05, 0.3);
  ["C6", "E6", "G6", "C7"].forEach((n, i) => tone(A[3] + i * 0.05, hz(n), 0.35, 0.035, "sine", null, fx, 0.5));
  splat(A[4], 0.32);
  scribble(A[5], 0.3, 0.07);
  pop(A[5] + 0.22, 0.08, -0.4, 600);
  // It works.
  crash(CUE.works, 0.32);
  boom(CUE.works, 0.6, 0.6);
  ["C4", "E4", "G4", "C5", "E5"].forEach((n, i) => pluck(CUE.works + i * 0.01, hz(n), 0.08, (i - 2) * 0.3, fx, 0.9));
  for (let k = 0; k < 22; k += 1) pop(CUE.works + 0.05 + random() * 0.8, 0.03, random() * 1.6 - 0.8, 700 + random() * 900);
  riser(CUE.news - 0.5, CUE.news, 0.09);
  // New in ADCode.
  whoosh(CUE.news - 0.02, 0.22, 0.14, true);
  pop(CUE.news + 0.08, 0.1, 0, 420);
  for (const c of CUE.cards.slice(1)) { whoosh(c - 0.13, 0.26, 0.08, false, 0.3); tick(c, 0.08, 1800); }
  bell(CUE.cards[0] + 0.2, hz("C6"), 0.05);
  [[0.7, "C6"], [0.85, "E6"], [1.05, "G6"]].forEach(([d, n]) => bell(CUE.cards[1] + 0.2 + d, hz(n), 0.05, 0.2));
  for (let k = 0; k < 16; k += 1) tick(CUE.cards[2] + 0.25 + k * 0.06, 0.035, 2200 + (k % 3) * 300, (k % 3) - 1);
  ["C5", "E5", "G5", "C6"].forEach((n, i) => tone(CUE.cards[2] + 1.1 + i * 0.09, hz(n), i === 3 ? 0.5 : 0.1, 0.05, "sawtooth", null, fx, 0));

  // ════════════ 23.7–25.7 · Thanks for waiting ════════════
  whoosh(CUE.close, 0.4, 0.08, false);
  pad(CUE.close + 0.1, CUE.end + 0.2, ["F2", "C3", "A3", "C4", "G4"], 0.034, 1200);
  ["C6", "E6", "G6"].forEach((n, i) => bell(CUE.done + i * 0.07, hz(n), 0.05, 0));
  pop(CUE.thanks - 0.05, 0.08);
  [[24.2, "C5"], [24.45, "E5"], [24.7, "G5"], [24.95, "F5"], [25.2, "E5"]].forEach(([tt, n]) => musicBox(tt, hz(n), 0.07, -0.1));
  for (let k = 0; k < 6; k += 1) tone(24.7 + k * 0.05, 2400 * 2 ** (k / 6), 0.18, 0.02, "sine", null, fx, 0.5);

  // ════════════ 25.7–29 · The end card ════════════
  pad(CUE.end, CUE.scroll + 0.3, ["C3", "G3", "E4", "D5"], 0.034, 1600);
  ["C5", "E5", "G5", "C6", "E6"].forEach((n, i) => tone(CUE.end + 0.05 + i * 0.04, hz(n), 0.6, 0.04, "sine", null, fx, (i - 2) * 0.2));
  for (let i = 0; i < 5; i += 1) boing(CUE.end + 0.15 + i * 0.05, hz("G5") / 2 * 2 ** (i / 12), 0.04, (i - 2) * 0.3);
  ["E5", "G5", "A5", "C6"].forEach((n, i) => pluck(CUE.end + 0.45 + i * 0.125, hz(n), 0.09, 0, fx, 0.7));
  pop(CUE.end + 0.75, 0.12, 0, 330);
  bell(CUE.end + 0.78, hz("C6"), 0.05);
  for (let b = DROP + Math.ceil((CUE.end + 0.5 - DROP) / BEAT) * BEAT; b < CUE.scroll; b += BEAT) {
    kick(b, 0.6);
    hat(b + BEAT / 2, 0.05, 0.2);
    bass(b, hz("C2"), 0.2, 0.22);
  }
  whoosh(CUE.scroll - 0.05, 0.45, 0.16, true);

  // ════════════ Voices ════════════
  for (const s of SYLLABLES) syllable(s);

  return wav(await ctx.startRendering());
}

/** 16-bit PCM WAV, interleaved stereo. */
function wav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const str = (at, value) => [...value].forEach((c, i) => bytes.setUint8(at + i, c.charCodeAt(0)));
  str(0, "RIFF"); bytes.setUint32(4, 36 + frames * channels * 2, true); str(8, "WAVE");
  str(12, "fmt "); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, channels, true);
  bytes.setUint32(24, buffer.sampleRate, true); bytes.setUint32(28, buffer.sampleRate * channels * 2, true);
  bytes.setUint16(32, channels * 2, true); bytes.setUint16(34, 16, true);
  str(36, "data"); bytes.setUint32(40, frames * channels * 2, true);
  const data = [...Array(channels).keys()].map((c) => buffer.getChannelData(c));
  let at = 44;
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < channels; c += 1) {
      const s = Math.max(-1, Math.min(1, data[c][f]));
      bytes.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return new Uint8Array(bytes.buffer);
}
