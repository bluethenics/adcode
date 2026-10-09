/**
 * The soundtrack: 16.5 seconds, synthesised offline from the cue sheet the picture uses, so
 * every hit lands on its frame. Seeded noise, so it renders identically every time. Returned
 * as 16-bit stereo WAV bytes. Nothing licensed, nothing sampled. The instruments are Too Many
 * Tools'; the score is this spot's.
 *
 * The arc, in D minor until the money turns it to F major:
 *   0–2      sound on frame 0: a low hit and the chord; a shimmer on the sheen; a riser into
 *            the white, and a hit as the app arrives.
 *   2–4.95   a light groove; key ticks as the prompt types; a send; then a clock - tick,
 *            tock - for as long as the agent works.
 *   4.5      the card pops; 4.75 the coin and a bell; the +$0.04 whooshes home and lands.
 *   4.95     "Get paid to wait.": four slams, a coin on "paid"; the groove opens into F.
 *   6.9      the lift and flip; the groove holds its breath on the price; a fizzing crack;
 *            8.0 the split - boom, coin, sparkles - on a bar's downbeat.
 *   10.3     whips across the app; chimes as agents finish; a slot-machine count-up.
 *   12.75    the dive; 13.0 the point; brackets race in; 13.5 the impact; the end card rings.
 * Built to work muted too: nothing here carries information the picture does not.
 */
import { BEAT, CUE, DURATION } from "./cues.js";
import { rng } from "./shared/engine.js";

const RATE = 48000;
const N = {
  D2: 73.42, F2: 87.31, A2: 110, Bb1: 58.27, C2: 65.41, D1: 36.71,
  D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, Bb3: 233.08, C4: 261.63,
  D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, C5: 523.25, D5: 587.33,
  E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.66, F6: 1396.91,
};

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
  // No gate in this one: sound from frame 0, and a short fade at the end.
  master.gain.setValueAtTime(0.9, 0);
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

  /** One beat of groove: kick, backbeat, hats, bass on the root. `level` 0..1 thins it. */
  function groove(from, to, root, level = 1) {
    for (let t = from; t < to - 0.01; t += BEAT) {
      const beat = Math.round(t / BEAT);
      kick(t, 0.55 + 0.35 * level);
      if (level > 0.6 && beat % 2 === 1) clap(t, 0.32 * level);
      hat(t + BEAT / 2, 0.06 * level + 0.02, 0.2);
      if (level > 0.6) hat(t + BEAT / 4, 0.03, -0.2);
      bass(t, root, BEAT * 0.8, 0.12 + 0.2 * level);
    }
  }

  // 0–2: the hook. Sound on the first frame - a low hit and the chord - then air.
  boom(0, 0.6, 1.4, 64);
  kick(0, 0.85);
  pad(0, [N.D3, N.A3, N.E4], CUE.app, 0.05, 0.04, 1100);
  chime(0.02, N.D5, 0.07, -0.2);
  chime(0.1, N.A5, 0.05, 0.3);
  [N.A5, N.D6, N.F6].forEach((f, i) => send(tone(CUE.sheen[0] + 0.1 + i * 0.12, f, 0.9, 0.016, "sine"), 0.8));
  whoosh(CUE.underline[0] - 0.05, CUE.underline[1] - CUE.underline[0] + 0.05, 0.07, false, 0.2);
  for (let t = BEAT; t < CUE.punch[0]; t += BEAT) { hat(t, 0.05, 0.2); tone(t, N.D2, 0.3, 0.12, "sine", null, drums); }
  // Through the line: a riser into the white, and a hit as the app arrives.
  riser(CUE.punch[0] - 0.3, CUE.punch[1], 0.3);
  whoosh(CUE.punch[0], CUE.punch[1] - CUE.punch[0], 0.22, true);
  boom(CUE.app, 0.85, 1.1, 78);
  kick(CUE.app, 1);
  clap(CUE.app, 0.42);

  // 2–4.95: the build, in D minor. Keys as the prompt types; a send; then the clock.
  pad(CUE.app, [N.D3, N.F3, N.A3, N.C4], CUE.slam[0] - CUE.app, 0.04, 0.1, 900);
  groove(CUE.app + BEAT, CUE.slam[0], N.D2, 0.45);
  const keys = Math.round((CUE.type[1] - CUE.type[0]) * 30);
  for (let i = 0; i < keys; i += 1) tick(CUE.type[0] + i / 30, 0.05 + 0.02 * random(), 3000 + (i % 4) * 350, -0.25);
  whoosh(CUE.send - 0.05, 0.22, 0.1, true);
  pluck(CUE.send, N.A4, 0.08);
  // The wait: a clock, tick and tock, every half beat until the agent is done.
  for (let t = CUE.work, i = 0; t < CUE.done - 0.01; t += BEAT / 2, i += 1) {
    tick(t, 0.11, i % 2 ? 2100 : 3300, i % 2 ? 0.3 : -0.3);
    tone(t, i % 2 ? 1400 : 1900, 0.025, 0.035, "sine");
  }
  CUE.steps.forEach((t, i) => chime(t, [N.D5, N.F5, N.A5][i], 0.05, (i - 1) / 2));

  // 4.5: the card - a two-note pop. 4.75: the money - coin and a bell.
  tone(CUE.card, N.A5, 0.12, 0.08, "sine");
  tone(CUE.card + 0.08, N.D6, 0.3, 0.07, "sine");
  whoosh(CUE.card - 0.05, 0.25, 0.08, false, 0.5);
  coin(CUE.earn, 0.24);
  chime(CUE.earn + 0.02, N.F6, 0.06, 0.4);
  // The +$0.04 flies home across the window and lands in the sidebar.
  whoosh(CUE.fly[0], CUE.fly[1] - CUE.fly[0], 0.12, true, -0.3);
  tick(CUE.fly[1], 0.18, 4200, -0.5);
  coin(CUE.fly[1] + 0.01, 0.1, N.C6 * 2);

  // 4.95: "Get paid to wait." - four slams, the money on "paid".
  CUE.slam.forEach((t, i) => {
    kick(t, 1);
    clap(t, 0.4);
    boom(t, 0.35 + 0.1 * i, 0.6, 70 - i * 4);
    tone(t, [N.D4, N.F4, N.A4, N.D5][i], 0.18, 0.06, "square");
  });
  coin(CUE.slam[1] + 0.02, 0.16);
  // Then the groove opens out in F major; the agent finishes with a pass chime.
  pad(6.0, [N.F3, N.A3, N.C4, N.G4], CUE.lift - 6.0, 0.05, 0.05, 1800);
  groove(6.0, CUE.lift, N.F2, 1);
  chime(CUE.done, N.F5, 0.08, 0);
  chime(CUE.done + 0.09, N.C6, 0.07, 0.3);
  for (let i = 0; i < 3; i += 1) tone(CUE.done + 0.1 + i * 0.08, N.F5 * 2 ** ((i * 4) / 12), 0.07, 0.03, "triangle");

  // 6.9: the lift and the flip; the groove holds its breath on the price.
  riser(CUE.lift - 0.3, CUE.flip[1], 0.24);
  whoosh(CUE.lift, CUE.flip[1] - CUE.lift, 0.18, true);
  boom(CUE.flip[1], 0.5, 0.9, 74);
  chime(CUE.flip[1], N.C6, 0.07, 0);
  pad(CUE.flip[1], [N.Bb3 / 2, N.D3, N.F3], CUE.split - CUE.flip[1], 0.045, 0.1, 700);
  for (let t = CUE.flip[1] + BEAT / 2; t < CUE.crack; t += BEAT / 2) hat(t, 0.05, 0.2);
  // The crack: a fizzing run up to the break.
  for (let i = 0; i < 12; i += 1) tick(CUE.crack + i * ((CUE.split - CUE.crack) / 12), 0.06 + i * 0.008, 2500 + i * 400, (random() - 0.5) * 0.6);
  tone(CUE.crack, N.F4, CUE.split - CUE.crack, 0.05, "sawtooth", N.F5);
  // 8.0: the split - the money, on a bar's downbeat.
  boom(CUE.split, 0.9, 1.2, 70);
  kick(CUE.split, 1);
  clap(CUE.split, 0.5);
  coin(CUE.split + 0.01, 0.22);
  coin(CUE.split + 0.2, 0.14, N.C6 * 2);
  [N.F5, N.A5, N.C6, N.F6].forEach((f, i) => pluck(CUE.split + 0.06 + i * 0.07, f, 0.07, i % 2 ? 0.35 : -0.35));
  for (let i = 0; i < 12; i += 1) tick(CUE.split + 0.05 + random() * 0.8, 0.03, 6000 + random() * 3000, random() * 1.6 - 0.8);
  const CHORDS = [
    { at: CUE.split, to: 9.0, root: N.F2, notes: [N.F3, N.A3, N.C4, N.G4, N.C5] },
    { at: 9.0, to: 9.5, root: N.D2, notes: [N.D3, N.F3, N.A3, N.C4] },
    { at: 9.5, to: CUE.whips[0], root: N.Bb1 * 2, notes: [N.Bb3 / 2, N.D3, N.F3, N.A3] },
    { at: CUE.whips[0], to: 11.5, root: N.F2, notes: [N.F3, N.A3, N.C4, N.G4] },
    { at: 11.5, to: CUE.whips[2], root: N.D2, notes: [N.D3, N.F3, N.A3, N.C4] },
    { at: CUE.whips[2], to: CUE.dive, root: N.C2 * 2, notes: [N.C4 / 2, N.E3, N.G3, N.D4] },
  ];
  for (const chord of CHORDS) {
    pad(chord.at, chord.notes, chord.to - chord.at, 0.05, 0.04, 1800);
    groove(chord.at, chord.to, chord.root, 1);
  }

  // 10.3: the whip out, then three whips across the app.
  whoosh(CUE.whipOut, CUE.whips[0] - CUE.whipOut + 0.05, 0.22, true, 0.4);
  CUE.whips.forEach((t, i) => {
    if (i > 0) whoosh(t - 0.15, 0.3, 0.2, true, i % 2 ? -0.4 : 0.4);
    pluck(t, [N.A4, N.C5, N.F5][i], 0.09);
    tone(t, 140, 0.08, 0.3, "sine", 60, drums);
  });
  // The agents finish, the code types, the tests pass, the balance counts up.
  [10.62, 10.78, 10.9, 10.98].forEach((t, i) => chime(t, [N.C6, N.A5, N.F5, N.C6][i], 0.035, (i - 1.5) / 2));
  for (let i = 0; i < 16; i += 1) tick(CUE.whips[1] + 0.05 + i / 48 * 2, 0.04, 3200 + (i % 3) * 400, 0.2);
  chime(CUE.whips[1] + 0.55, N.F5, 0.06, 0);
  for (let i = 0; i < 14; i += 1) {
    const t = CUE.whips[2] + 0.1 + 0.5 * (1 - (1 - i / 14) ** 3);
    tone(t, N.C6 * 2 ** (i / 24), 0.04, 0.035, "square");
  }
  coin(CUE.whips[2] + 0.62, 0.14);

  // 12.75: the dive into the figure; 13.0, the point; the brackets race; 13.5 the impact.
  riser(CUE.dive - 0.2, CUE.mark, 0.22);
  whoosh(CUE.dive, CUE.mark - CUE.dive, 0.2, true);
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
  coin(CUE.tagline + 0.12, 0.08, N.C6 * 2);
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
