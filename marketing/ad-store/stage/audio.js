/**
 * The soundtrack: 20 seconds, synthesised offline from the cue sheet the picture uses, so
 * every hit lands on its frame. Seeded noise, so it renders identically every time. Nothing
 * licensed, nothing sampled. Returned as 16-bit stereo WAV bytes.
 *
 * 120 BPM. It opens on a hit - the hook is already on screen, so the sound is too - and a
 * groove in D minor that lifts to F major when the money arrives:
 *   0        the slam under "Get paid to code."; a rising shimmer as the rule draws.
 *   1.7–2    a riser into the first flash; 2.0 the downbeat.
 *   2.2–3.2  a key tick per character; Enter; three plucks climbing for the steps.
 *   4.5      the card pops in; 5.25 a coin.
 *   6.85     the whip; 7.0 downbeat; the counter ratchets; 7.9 a bell at 50.
 *   8.5      the split: a drop into F major, coins, sparkle.
 *   10.5     the flash to paper; typewriter; 11.5 the stamp.
 *   12.5     Windows: a soft chord, the window's swish, the pointer, the click, the install,
 *            a chime on Open, a pop as it pins.
 *   15.55    the dive: a riser; 16.0 the plate; 16.5 the impact; the end card rings out.
 * Works muted too: nothing here carries information the picture does not.
 */
import { BEAT, CUE, DURATION, LINES } from "./cues.js";
import { rng } from "./shared/engine.js";

const RATE = 48000;
const N = {
  D1: 36.71, Bb1: 58.27, C2: 65.41, D2: 73.42, F2: 87.31, G2: 98, A2: 110,
  D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, Bb3: 233.08, C4: 261.63,
  D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, C5: 523.25, D5: 587.33,
  E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.66, F6: 1396.91,
};

export async function renderSoundtrack() {
  const ctx = new OfflineAudioContext(2, Math.round(DURATION * RATE), RATE);
  const random = rng(5150);
  const noise = ctx.createBuffer(1, RATE * 2, RATE);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 - 1;

  // ── The mix: buses → glue → limiter → out, with a shared reverb ──
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = 0.006; glue.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, DURATION - 0.7);
  master.gain.linearRampToValueAtTime(0, DURATION - 0.02);
  master.connect(glue).connect(limiter).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  const tail = ctx.createBuffer(2, Math.round(RATE * 2.2), RATE);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = tail.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = (random() * 2 - 1) * (1 - i / data.length) ** 3;
  }
  reverb.buffer = tail;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
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
    source.start(Math.max(0, t), random() * 1.5, duration + 0.05);
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
  function tick(t, level = 0.05, frequency = 4200, pan = 0) {
    const source = noiseSource(t, 0.02); const gain = ctx.createGain();
    env(gain, t, level, 0.0008, 0.015);
    source.connect(filter("bandpass", frequency, 2)).connect(gain).connect(panner(pan)).connect(fx);
  }
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
    gain.gain.setValueAtTime(level, t + Math.max(attack, duration - 0.25));
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

  // ── The groove: bars of four from 0, the chords per stretch ──
  const CHORDS = [
    { at: 0, root: N.D2, notes: [N.D3, N.F3, N.A3, N.C4] },
    { at: CUE.flash1, root: N.Bb1, notes: [N.Bb3 / 2, N.D3, N.F3, N.A3] },
    { at: CUE.card - 0.5, root: N.F2, notes: [N.F3, N.A3, N.C4, N.E4] },
    { at: CUE.whip + 0.15, root: N.D2, notes: [N.D3, N.F3, N.A3, N.C4] },
    { at: CUE.split, root: N.F2, notes: [N.F3, N.A3, N.C4, N.G4, N.C5] },
    { at: CUE.flash2, root: N.Bb1, notes: [N.Bb3 / 2, N.D3, N.F3, N.A3] },
    { at: CUE.desktop, root: N.F2, notes: [N.F3, N.A3, N.C4, N.E4] },
    { at: CUE.click, root: N.C2, notes: [N.C4 / 2, N.E3, N.G3, N.D4] },
    { at: CUE.dollar, root: N.F2, notes: [N.F2, N.C4 / 2, N.F3, N.A3, N.C4, N.G4, N.A4] },
  ];
  CHORDS.forEach((chord, i) => {
    const end = i === CHORDS.length - 1 ? DURATION - 0.1 : CHORDS[i + 1].at;
    const quiet = chord.at === CUE.flash2;
    pad(chord.at, chord.notes, end - chord.at, i === CHORDS.length - 1 ? 0.075 : 0.05, 0.04, quiet ? 900 : 1800);
    if (i < CHORDS.length - 1) for (let t = chord.at; t < end - 0.01; t += BEAT) bass(t, chord.root, BEAT * 0.8, quiet ? 0.2 : 0.3);
  });
  bass(CUE.dollar, N.F2, 1.8, 0.35);
  // Drums from the downbeat to the dive. The paper is half-time: a breath.
  for (let beat = 0; beat * BEAT < CUE.dive[0] - 0.01; beat += 1) {
    const t = beat * BEAT;
    const paper = t >= CUE.flash2 && t < CUE.desktop;
    if (!paper || beat % 2 === 0) kick(t, paper ? 0.6 : 0.85);
    if (beat % 2 === 1 && !paper) clap(t, 0.36);
    hat(t + BEAT / 2, 0.07, 0.2);
    if (!paper) hat(t + BEAT / 4, 0.03, -0.2);
  }

  // ── The score ──
  // 0: the hook lands with the picture. The rule draws: a rising shimmer.
  boom(0, 0.9, 1.4, 80);
  clap(0, 0.5);
  tone(CUE.hookLine[0], N.D5, CUE.hookLine[1] - CUE.hookLine[0], 0.025, "sine", N.A5, music);
  // Into the first flash.
  riser(CUE.hookOut - 0.3, CUE.flash1, 0.26);
  whoosh(CUE.hookOut, CUE.flash1 - CUE.hookOut, 0.18, true);
  boom(CUE.flash1, 0.8, 1.2, 76);
  send(tone(CUE.flash1, N.A5, 1.0, 0.04, "sine"), 0.9);

  // Typing, a tick a character; Enter; the steps climb.
  const chars = LINES.prompt.text.length;
  for (let i = 0; i < chars; i += 1) tick(CUE.type[0] + (i / chars) * (CUE.type[1] - CUE.type[0]), 0.05 + 0.02 * random(), 3000 + random() * 1600, -0.15);
  clack(CUE.enter, 0.4);
  whoosh(CUE.enter, 0.3, 0.08, true);
  [N.F5, N.A5, N.C6].forEach((f, i) => pluck(CUE.steps[i], f, 0.08, (i - 1) / 2));
  whoosh(CUE.dock - 0.1, 0.5, 0.1, false);

  // The card, and the money.
  tone(CUE.card, N.A5, 0.12, 0.08, "sine");
  tone(CUE.card + 0.08, N.D6, 0.3, 0.07, "sine");
  whoosh(CUE.card - 0.05, 0.25, 0.08, false, 0.5);
  coin(CUE.earn, 0.2);
  [N.F5, N.A5, N.C6].forEach((f, i) => chime(CUE.earn + 0.05 + i * 0.06, f, 0.04, i - 1));

  // The whip; the counter ratchets; the bell at 50.
  whoosh(CUE.whip - 0.05, 0.28, 0.22, true, -0.5);
  boom(CUE.fifty, 0.6, 0.9, 70);
  for (let i = 0; i < 25; i += 1) {
    const p = 1 - (1 - i / 25) ** (1 / 3); // the count eases out, so the ticks slow down
    tick(CUE.count[0] + p * (CUE.count[1] - CUE.count[0]), 0.06, 2600 + i * 60, 0.1);
  }
  chime(CUE.count[1], N.C6, 0.09, 0);
  coin(CUE.count[1] + 0.02, 0.16, N.C6 * 2);
  // The split: drop into F major.
  riser(CUE.split - 0.4, CUE.split, 0.2);
  kick(CUE.split, 1);
  boom(CUE.split, 0.8, 1.1, 70);
  coin(CUE.split + 0.01, 0.2);
  [N.F5, N.A5, N.C6, N.F6].forEach((f, i) => pluck(CUE.split + 0.06 + i * 0.07, f, 0.07, i % 2 ? 0.35 : -0.35));
  for (let i = 0; i < 10; i += 1) tick(CUE.split + 0.05 + random() * 0.8, 0.03, 6000 + random() * 3000, random() * 1.6 - 0.8);

  // The flash to paper; the typewriter; the stamp.
  riser(CUE.flash2 - 0.35, CUE.flash2, 0.22);
  boom(CUE.flash2, 0.7, 1.0, 74);
  send(tone(CUE.flash2, N.E5, 0.9, 0.035, "sine"), 0.9);
  CUE.rows.forEach((at, r) => {
    for (let i = 0; i < 7; i += 1) clack(at + i * 0.021, 0.12 + 0.05 * random(), (r - 1) * 0.3);
    tick(at + 0.2, 0.08, 1800);
  });
  boom(CUE.stamp, 0.95, 0.5, 120);
  clack(CUE.stamp, 0.6);
  kick(CUE.stamp, 0.9, 50);
  whoosh(CUE.desktop - 0.25, 0.27, 0.2, false);

  // Windows.
  kick(CUE.desktop, 0.8);
  whoosh(CUE.store - 0.05, 0.3, 0.12, true, 0.3);
  chime(CUE.store + 0.05, N.A5, 0.05, 0.3);
  tick(CUE.pointer[1], 0.05, 2400, 0.4);
  tick(CUE.click, 0.22, 3200, 0.3);
  tone(CUE.click, 160, 0.06, 0.25, "sine", 80, drums);
  for (let i = 0; i < 9; i += 1) tick(CUE.install[0] + 0.05 + i * 0.09, 0.03, 5200 + i * 160, 0.3);
  tone(CUE.install[0], N.C5, CUE.install[1] - CUE.install[0], 0.02, "triangle", N.C6, music);
  [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => chime(CUE.open + i * 0.05, f, 0.06, 0.2));
  tone(CUE.pinned, N.G5, 0.12, 0.07, "sine");
  tone(CUE.pinned + 0.07, N.C6, 0.25, 0.06, "sine");

  // The dive, the plate, the impact, the end card.
  riser(CUE.dive[0], CUE.dive[1], 0.3);
  whoosh(CUE.dive[0], CUE.dive[1] - CUE.dive[0], 0.22, true);
  whoosh(CUE.mark, 0.4, 0.14, false);
  boom(CUE.dollar, 1, 2.2, 78);
  kick(CUE.dollar, 1);
  clap(CUE.dollar, 0.5);
  coin(CUE.dollar + 0.02, 0.2);
  [..."ADCode"].forEach((_, i) => tick(CUE.wordmark + i * 0.045, 0.06, 3600 + i * 250));
  chime(CUE.tagline, N.C6, 0.07, 0);
  coin(CUE.tagline + 0.12, 0.12, N.C6 * 2);
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
