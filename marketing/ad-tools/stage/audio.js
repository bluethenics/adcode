/**
 * The soundtrack: 22.5 seconds, synthesised offline from the cue sheet the picture uses, so
 * every hit lands on its frame. Seeded noise, so it renders identically every time. Returned
 * as 16-bit stereo WAV bytes. Nothing licensed, nothing sampled.
 *
 * The arc, in D minor until the money turns it to F major:
 *   0–3.5    air: a pad breathing in, code glyphs ticking as the line resolves, a shimmer on
 *            the flare, six glass chimes as the tiles crystallise, the click on chat.
 *   3.5–7    the loop: a drone and a riser climbing, a kick and a whoosh on every whip, key
 *            clacks on every Ctrl C / Ctrl V, hats that go from eighths to triplets.
 *   7–7.5    nothing. The master gate holds it shut.
 *   7.5–8.3  four discs, four hits climbing D–F–A–C; a reverse swell into the white.
 *   8.8–10.6 held breath: a low pad, one tick per word.
 *   10.6     the slam. Then a groove, 120 BPM from this downbeat: Dm, F, C, Bb.
 *   12.9     five magnetic snaps climbing an F chord; keys, a send, a ding, a pass chime.
 *   15.2     the card: a pop, and the groove steps back to let the line through.
 *   16.6     the money, on a bar's downbeat: coin, bass drop, F major, sparkles.
 *   18.1     the suck into a point; brackets racing in from both sides; 18.6 the impact, on
 *            a bar downbeat. 18.85 the letters tick into place; the end card rings out.
 * Built to work muted too: nothing here carries information the picture does not.
 */
import { BEAT, CUE, DURATION, LOOP } from "./cues.js";
import { rng } from "./shared/engine.js";

const RATE = 48000;
const N = {
  D2: 73.42, F2: 87.31, A2: 110, Bb1: 58.27, C2: 65.41, D1: 36.71,
  D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, Bb3: 233.08, C4: 261.63,
  D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, C5: 523.25, D5: 587.33,
  E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.66, F6: 1396.91,
};
const CLICK = 0.42;

export async function renderSoundtrack() {
  const ctx = new OfflineAudioContext(2, Math.round(DURATION * RATE), RATE);
  const random = rng(2222);
  const noise = ctx.createBuffer(1, RATE * 2, RATE);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 - 1;

  // ── The mix: buses → glue → limiter → out, with a shared reverb ──
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = 0.006; glue.release.value = 0.2;
  const master = ctx.createGain();
  // The gate: shut at the cut to the screen, open on the first disc; a short fade at the end.
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, CUE.silence - 0.006);
  master.gain.linearRampToValueAtTime(0, CUE.silence);
  master.gain.setValueAtTime(0, CUE.discs[0] - 0.003);
  master.gain.linearRampToValueAtTime(0.9, CUE.discs[0]);
  master.gain.setValueAtTime(0.9, DURATION - 0.6);
  master.gain.linearRampToValueAtTime(0, DURATION - 0.02);
  master.connect(glue).connect(limiter).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  const tail = ctx.createBuffer(2, Math.round(RATE * 2.4), RATE);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = tail.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = (random() * 2 - 1) * (1 - i / data.length) ** 3;
  }
  reverb.buffer = tail;
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  reverb.connect(wet).connect(master);

  const drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(master);
  const fx = ctx.createGain(); fx.gain.value = 0.75; fx.connect(master);
  const music = ctx.createGain(); music.gain.value = 0.55; music.connect(master);

  const send = (node, amount) => {
    const gain = ctx.createGain(); gain.gain.value = amount;
    node.connect(gain).connect(reverb);
  };
  const env = (gain, t, level, attack, decay) => {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noiseSource = (t, duration) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.start(t, random() * 1.5, duration + 0.05);
    return source;
  };
  const filter = (type, frequency, q = 1) => {
    const node = ctx.createBiquadFilter();
    node.type = type; node.frequency.value = frequency; node.Q.value = q;
    return node;
  };
  const panner = (pan) => {
    const node = ctx.createStereoPanner(); node.pan.value = pan;
    return node;
  };

  // ── Instruments ──
  function kick(t, level = 1, low = 42) {
    const body = ctx.createOscillator(); const gain = ctx.createGain();
    body.frequency.setValueAtTime(175, t);
    body.frequency.exponentialRampToValueAtTime(low, t + 0.12);
    env(gain, t, level, 0.002, 0.42);
    body.connect(gain).connect(drums);
    body.start(t); body.stop(t + 0.5);
    const click = noiseSource(t, 0.03); const clickGain = ctx.createGain();
    env(clickGain, t, 0.25 * level, 0.001, 0.02);
    click.connect(filter("highpass", 2800)).connect(clickGain).connect(drums);
  }
  function clap(t, level = 0.45) {
    const source = noiseSource(t, 0.3); const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    for (const offset of [0, 0.011, 0.022]) {
      gain.gain.setValueAtTime(level, t + offset);
      gain.gain.exponentialRampToValueAtTime(level * 0.2, t + offset + 0.01);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    source.connect(filter("bandpass", 1500, 0.9)).connect(gain).connect(drums);
    send(gain, 0.3);
  }
  function hat(t, level = 0.08, pan = 0) {
    const source = noiseSource(t, 0.06); const gain = ctx.createGain();
    env(gain, t, level, 0.001, 0.04);
    source.connect(filter("highpass", 8000)).connect(gain).connect(panner(pan)).connect(drums);
  }
  function tone(t, frequency, duration, level, type = "sine", toFrequency = null, bus = fx) {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (toFrequency !== null) osc.frequency.exponentialRampToValueAtTime(toFrequency, t + duration);
    env(gain, t, level, 0.003, duration);
    osc.connect(gain).connect(bus);
    osc.start(t); osc.stop(t + duration + 0.05);
    return gain;
  }
  /** Glass: a sine and a quiet octave, long tail. */
  function chime(t, frequency, level = 0.08, pan = 0) {
    const a = tone(t, frequency, 1.4, level, "sine", null, music);
    const b = tone(t, frequency * 2.01, 0.6, level * 0.35, "triangle", null, music);
    const p = panner(pan);
    a.disconnect(); b.disconnect();
    a.connect(p); b.connect(p); p.connect(music);
    send(a, 0.6); send(b, 0.6);
  }
  function coin(t, level = 0.2, high = N.F6) {
    tone(t, high * 0.75, 0.07, level, "square");
    send(tone(t + 0.07, high, 0.8, level, "square"), 0.5);
  }
  /** A tick: a sliver of band-passed noise. */
  function tick(t, level = 0.05, frequency = 4200, pan = 0) {
    const source = noiseSource(t, 0.02); const gain = ctx.createGain();
    env(gain, t, level, 0.0008, 0.015);
    source.connect(filter("bandpass", frequency, 2)).connect(gain).connect(panner(pan)).connect(fx);
  }
  /** A keycap going down: a clack and a thock. */
  function clack(t, level = 0.32, pan = 0) {
    const source = noiseSource(t, 0.05); const gain = ctx.createGain();
    env(gain, t, level, 0.001, 0.035);
    source.connect(filter("bandpass", 1900, 1.4)).connect(gain).connect(panner(pan)).connect(fx);
    tone(t, 190, 0.07, level * 0.7, "sine", 90, drums);
  }
  function boom(t, level = 0.9, length = 1.6, from = 72) {
    const body = ctx.createOscillator(); const gain = ctx.createGain();
    body.frequency.setValueAtTime(from, t);
    body.frequency.exponentialRampToValueAtTime(32, t + length * 0.8);
    env(gain, t, level, 0.004, length);
    body.connect(gain).connect(fx); body.start(t); body.stop(t + length + 0.3);
    const crack = noiseSource(t, 0.8); const crackGain = ctx.createGain();
    env(crackGain, t, level * 0.35, 0.002, 0.7);
    crack.connect(filter("lowpass", 1400)).connect(crackGain).connect(fx);
    send(crackGain, 0.45);
  }
  function whoosh(t, duration, level, up = true, pan = 0) {
    const source = noiseSource(t, duration); const gain = ctx.createGain();
    const band = filter("bandpass", up ? 400 : 6500, 1.1);
    band.frequency.setValueAtTime(up ? 400 : 6500, t);
    band.frequency.exponentialRampToValueAtTime(up ? 6500 : 380, t + duration);
    env(gain, t, level, duration * 0.55, duration * 0.45);
    source.connect(band).connect(gain).connect(panner(pan)).connect(fx);
    send(gain, 0.2);
  }
  function pluck(t, frequency, level = 0.09, pan = 0) {
    const gain = ctx.createGain();
    const low = filter("lowpass", 3600, 2.5);
    low.frequency.setValueAtTime(4400, t);
    low.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    env(gain, t, level, 0.003, 0.36);
    for (const [type, cents] of [["sawtooth", -6], ["square", 6]]) {
      const osc = ctx.createOscillator(); osc.type = type;
      osc.frequency.value = frequency; osc.detune.value = cents;
      osc.connect(low); osc.start(t); osc.stop(t + 0.45);
    }
    low.connect(gain).connect(panner(pan)).connect(music);
    send(gain, 0.35);
  }
  function pad(t, frequencies, duration, level = 0.05, attack = 0.2, cutoff = 1500) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + attack);
    gain.gain.setValueAtTime(level, t + duration - 0.25);
    gain.gain.linearRampToValueAtTime(0.0001, t + duration);
    const low = filter("lowpass", cutoff, 0.6);
    for (const frequency of frequencies) {
      for (const cents of [-10, 10]) {
        const osc = ctx.createOscillator(); osc.type = "sawtooth";
        osc.frequency.value = frequency; osc.detune.value = cents;
        osc.connect(low); osc.start(t); osc.stop(t + duration + 0.1);
      }
    }
    low.connect(gain).connect(music);
    send(gain, 0.55);
  }
  function bass(t, frequency, duration, level = 0.35) {
    const osc = ctx.createOscillator(); const gain = ctx.createGain(); const low = filter("lowpass", 420, 1.2);
    osc.type = "sawtooth"; osc.frequency.value = frequency;
    env(gain, t, level, 0.006, duration);
    osc.connect(low).connect(gain).connect(music);
    osc.start(t); osc.stop(t + duration + 0.05);
    tone(t, frequency / 2, duration, level * 0.8, "sine", null, drums);
  }
  /** A riser: a drone opening up under noise that climbs to `to`. */
  function riser(from, to, level = 0.3) {
    const drone = ctx.createOscillator(); const gain = ctx.createGain();
    const low = filter("lowpass", 90, 3);
    low.frequency.setValueAtTime(90, from);
    low.frequency.exponentialRampToValueAtTime(1100, to);
    drone.type = "sawtooth"; drone.frequency.value = N.D2 / 2;
    gain.gain.setValueAtTime(0.0001, from);
    gain.gain.exponentialRampToValueAtTime(level, to - 0.05);
    drone.connect(low).connect(gain).connect(music);
    drone.start(from); drone.stop(to + 0.05);
    const source = noiseSource(from, to - from); const rise = ctx.createGain();
    const band = filter("bandpass", 500, 2);
    band.frequency.setValueAtTime(500, from);
    band.frequency.exponentialRampToValueAtTime(9500, to);
    rise.gain.setValueAtTime(0.0001, from);
    rise.gain.exponentialRampToValueAtTime(level * 0.9, to - 0.02);
    source.connect(band).connect(rise).connect(fx);
  }

  // ── The score ──

  // 0–3.5: air. The pad breathes in; the glyphs tick as the line resolves.
  pad(0, [N.D3, N.A3, N.E4], 3.6, 0.045, 1.2, 900);
  for (let t = 0; t < 0.95; t += 0.033) tick(t, 0.025 + 0.02 * random(), 3500 + random() * 3000, random() * 0.8 - 0.4);
  tone(0.9, N.D5, 1.6, 0.03, "sine", null, music);
  // The flare: a shimmer climbing, and a low swell under it.
  [N.A5, N.D6, N.F6].forEach((f, i) => send(tone(1.45 + i * 0.12, f, 1.1, 0.018, "sine"), 0.8));
  tone(1.4, N.D2, 0.9, 0.12, "sine", null, music);
  // The split: six lights leave, six tiles ring.
  const TILE_NOTES = [N.D5, N.F5, N.G5, N.A5, N.C6, N.D6];
  for (let i = 0; i < 6; i += 1) {
    whoosh(2.04 + i * 0.035, 0.34, 0.035, false, (i - 2.5) / 3);
    chime(2.42 + i * 0.05, TILE_NOTES[i], 0.07, (i - 2.5) / 3);
  }
  tone(2.72, N.D2, 0.5, 0.15, "sine", null, drums);
  tick(3.42, 0.14, 2600);

  // 3.5–7: the loop.
  riser(CUE.loop, CUE.silence, 0.3);
  LOOP.forEach((shot, i) => {
    const heat = i / (LOOP.length - 1);
    kick(shot.at, 0.6 + 0.35 * heat, 42 + i * 3);
    whoosh(shot.at - 0.02, Math.min(0.22, shot.dur * 0.5), 0.1 + 0.06 * heat, true, i % 2 ? 0.35 : -0.35);
    const press = shot.at + shot.dur * CLICK;
    shot.keys.forEach((_, k) => clack(press + k * 0.035, 0.3 + 0.1 * heat, k ? 0.2 : -0.2));
    if (i >= 3) tone(shot.at, N.D4 * 2 ** (i / 12), 0.12, 0.05, "square");
  });
  for (let t = CUE.loop; t < 4.9; t += BEAT / 2) hat(t, 0.06, 0.2);
  for (let t = 4.9; t < 6.0; t += BEAT / 4) hat(t, 0.07, t % 0.25 < 0.1 ? -0.25 : 0.25);
  for (let t = 6.0; t < CUE.silence; t += BEAT / 6) hat(t, 0.08, t % 0.33 < 0.15 ? -0.3 : 0.3);
  // The pile: keys clattering everywhere.
  for (let i = 0; i < 9; i += 1) clack(CUE.pile + 0.08 + i * 0.045, 0.22, (random() - 0.5) * 1.4);
  kick(CUE.pile, 0.9);
  whoosh(CUE.pile, 0.5, 0.16, false);

  // 7–7.5: nothing - the gate. 7.5–8.3: four discs, climbing D F A C.
  [N.D2, N.F2, N.A2, N.C2 * 2].forEach((f, i) => {
    const t = CUE.discs[i];
    boom(t, 0.55 + i * 0.1, 1.1, 90 - i * 6);
    kick(t, 0.8 + i * 0.05);
    pad(t, [f * 2, f * 3, f * 4], 0.5, 0.06, 0.01, 2400);
    chime(t + 0.005, f * 8, 0.05, (i - 1.5) / 2);
  });
  riser(CUE.front - 0.1, CUE.white, 0.24);
  whoosh(CUE.front, CUE.white - CUE.front, 0.2, true);
  // 8.8: the white; held breath, one tick per word.
  send(tone(CUE.white, N.A5, 1.2, 0.05, "sine"), 0.9);
  pad(CUE.white, [N.Bb3 / 2, N.D3, N.F3], CUE.zero - CUE.white, 0.04, 0.3, 700);
  for (let i = 0; i < 7; i += 1) tick(CUE.headline + i * 0.07, 0.05, 3000 + i * 150);
  for (let t = 9.1; t < CUE.zero - 0.2; t += BEAT) tick(t, 0.03, 5200);
  whoosh(CUE.zero - 0.4, 0.4, 0.16, true);

  // 10.6: the slam, then the groove - bars of four from this downbeat.
  boom(CUE.zero, 1, 1.6, 80);
  kick(CUE.zero, 1);
  clap(CUE.zero, 0.55);
  const grooveEnd = CUE.mark;
  const CHORDS = [
    { at: CUE.zero, root: N.D2, notes: [N.D3, N.F3, N.A3, N.C4] },
    { at: CUE.zero + 4 * BEAT, root: N.F2, notes: [N.F3, N.A3, N.C4, N.G4] },
    { at: CUE.zero + 8 * BEAT, root: N.C2, notes: [N.C4 / 2, N.E3, N.G3, N.D4] },
    { at: CUE.zero + 10 * BEAT, root: N.Bb1, notes: [N.Bb3 / 2, N.D3, N.F3, N.A3] },
    { at: CUE.fifty, root: N.F2, notes: [N.F3, N.A3, N.C4, N.G4, N.C5] },
  ];
  CHORDS.forEach((chord, i) => {
    const end = CHORDS[i + 1]?.at ?? grooveEnd;
    const breath = chord.at >= CUE.card - 0.1 && chord.at < CUE.fifty;
    pad(chord.at, chord.notes, end - chord.at, breath ? 0.035 : 0.05, 0.05, breath ? 800 : 1800);
    for (let t = chord.at; t < end - 0.01; t += BEAT) bass(t, chord.root, BEAT * 0.8, breath ? 0.18 : 0.3);
  });
  for (let beat = 1; CUE.zero + beat * BEAT < grooveEnd - 0.01; beat += 1) {
    const t = CUE.zero + beat * BEAT;
    const breath = t >= CUE.card && t < CUE.fifty;
    if (!breath || beat % 2 === 0) kick(t, breath ? 0.55 : 0.85);
    if (beat % 2 === 1 && !breath) clap(t, 0.38);
    hat(t + BEAT / 2, 0.07, 0.2);
    if (!breath) hat(t + BEAT / 4, 0.035, -0.2);
  }
  // Zero's words: a tick for the shrink, a ratchet for the slot.
  whoosh(CUE.zeroCopy - 0.05, 0.3, 0.1, false);
  for (let i = 0; i < 6; i += 1) tick(CUE.zeroTabs + i * 0.025, 0.08, 2600 + i * 200);
  pluck(CUE.zeroTabs + 0.16, N.A4, 0.08);
  whoosh(CUE.shrink - 0.1, 0.35, 0.14, false);

  // 12.9: the snaps, climbing an F chord; then the work.
  [N.F4, N.A4, N.C5, N.F5, N.A5].forEach((f, i) => {
    const t = CUE.snaps[i] + 0.12;
    tick(t, 0.2, 2200, (i - 2) / 3);
    tone(t, 120, 0.08, 0.35, "sine", 60, drums);
    pluck(t, f, 0.08, (i - 2) / 3);
  });
  [...Array(9).keys()].forEach((i) => tick(CUE.prompt + i * 0.048, 0.045, 3200 + (i % 3) * 400, -0.2));
  whoosh(CUE.prompt + 0.46, 0.18, 0.08, true);
  chime(CUE.edit, N.C6, 0.08, 0.2);
  chime(CUE.passed, N.F5, 0.08, 0);
  chime(CUE.passed + 0.09, N.C6, 0.07, 0.3);
  for (let i = 0; i < 3; i += 1) tone(CUE.passed + 0.1 + i * 0.08, N.F5 * 2 ** (i * 4 / 12), 0.07, 0.03, "triangle");

  // 15.2: the card - a two-note pop - and the groove steps back for the line.
  tone(CUE.card, N.A5, 0.12, 0.08, "sine");
  tone(CUE.card + 0.08, N.D6, 0.3, 0.07, "sine");
  whoosh(CUE.card - 0.05, 0.25, 0.08, false, 0.5);
  // 16.45: the lift and flip; 16.6, the money.
  riser(CUE.split - 0.3, CUE.fifty, 0.22);
  whoosh(CUE.split, CUE.fifty - CUE.split, 0.18, true);
  kick(CUE.fifty, 1);
  clap(CUE.fifty, 0.5);
  boom(CUE.fifty, 0.75, 1.0, 70);
  coin(CUE.fifty + 0.01, 0.22);
  coin(CUE.fifty + 0.2, 0.14, N.C6 * 2);
  [N.F5, N.A5, N.C6, N.F6].forEach((f, i) => pluck(CUE.fifty + 0.06 + i * 0.07, f, 0.07, i % 2 ? 0.35 : -0.35));
  for (let i = 0; i < 12; i += 1) tick(CUE.fifty + 0.05 + random() * 0.8, 0.03, 6000 + random() * 3000, random() * 1.6 - 0.8);

  // 17.6: the suck, the race, the impact.
  whoosh(CUE.mark - 0.02, 0.16, 0.2, false);
  tone(CUE.mark, N.F4, 0.4, 0.08, "sine", N.F5);
  whoosh(CUE.dollar - 0.28, 0.28, 0.16, true, -0.7);
  whoosh(CUE.dollar - 0.28, 0.28, 0.16, true, 0.7);
  boom(CUE.dollar, 1, 2.2, 78);
  kick(CUE.dollar, 1);
  clap(CUE.dollar, 0.5);
  coin(CUE.dollar + 0.02, 0.2);
  pad(CUE.dollar, [N.F2, N.C4 / 2, N.F3, N.A3, N.C4, N.G4, N.A4], DURATION - CUE.dollar - 0.1, 0.075, 0.02, 2200);
  bass(CUE.dollar, N.F2, 1.6, 0.35);
  [..."ADCode"].forEach((_, i) => tick(CUE.wordmark + i * 0.045, 0.06, 3600 + i * 250));
  chime(CUE.tagline, N.C6, 0.06, 0);
  [N.F5, N.A5, N.C6].forEach((f, i) => chime(CUE.end + 0.3 + i * 0.1, f, 0.05, (i - 1) / 2));
  chime(CUE.end + 0.5, N.F6, 0.04, 0);

  return wav(await ctx.startRendering());
}

/** 16-bit PCM WAV, interleaved stereo. */
function wav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const text = (at, value) => [...value].forEach((char, i) => bytes.setUint8(at + i, char.charCodeAt(0)));
  text(0, "RIFF"); bytes.setUint32(4, 36 + frames * channels * 2, true); text(8, "WAVE");
  text(12, "fmt "); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, channels, true);
  bytes.setUint32(24, buffer.sampleRate, true); bytes.setUint32(28, buffer.sampleRate * channels * 2, true);
  bytes.setUint16(32, channels * 2, true); bytes.setUint16(34, 16, true);
  text(36, "data"); bytes.setUint32(40, frames * channels * 2, true);
  const data = [...Array(channels).keys()].map((channel) => buffer.getChannelData(channel));
  let at = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][frame]));
      bytes.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      at += 2;
    }
  }
  return new Uint8Array(bytes.buffer);
}
