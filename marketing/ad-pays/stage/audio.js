/**
 * The soundtrack: 10 seconds at 120 BPM in F, synthesised offline from the cue sheet the
 * picture uses, so every hit lands on its frame. Seeded noise, so it renders identically
 * every time. Returned as 16-bit stereo WAV bytes. Nothing licensed, nothing sampled.
 *
 * Built for a feed: a hit on frame 0 (for the few who have sound on, the first thing they
 * hear is the hook landing), the counter's coin tick on every eighth note while it is on
 * screen, a whoosh as the hook flies out and a hit as the window lands, typing and a stream
 * of ticks as the AI writes, a pop for the card, a rising whoosh and a coin as the money
 * flies into the chip, a hit on each of the four cuts, the mark's boom on 6.5, and a groove
 * that carries the end card and dies away into the loop. F, C, Dm, Bb, then C - the last
 * bar leans back into the F the ad opens on, so the replay lands home.
 * Built to work muted too: nothing here carries information the picture does not.
 */
import { BEAT, COUNTER, CUE, DURATION } from "./cues.js";
import { rng } from "./shared/engine.js";

const RATE = 48000;
const N = {
  Bb1: 58.27, C2: 65.41, D2: 73.42, F2: 87.31, A2: 110,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, Bb3: 233.08, C4: 261.63,
  D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, C5: 523.25, D5: 587.33,
  E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.66, F6: 1396.91,
};

export async function renderSoundtrack() {
  const ctx = new OfflineAudioContext(2, Math.round(DURATION * RATE), RATE);
  const random = rng(1080);
  const noise = ctx.createBuffer(1, RATE * 2, RATE);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 - 1;

  // ── The mix: buses → glue → limiter → out, with a shared reverb ──
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = 0.006; glue.release.value = 0.2;
  const master = ctx.createGain();
  // A few milliseconds of fade at the very end, so the loop never clicks.
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, DURATION - 0.05);
  master.gain.linearRampToValueAtTime(0, DURATION - 0.015);
  master.connect(glue).connect(limiter).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  const tail = ctx.createBuffer(2, Math.round(RATE * 1.8), RATE);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = tail.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = (random() * 2 - 1) * (1 - i / data.length) ** 3;
  }
  reverb.buffer = tail;
  const wet = ctx.createGain();
  wet.gain.value = 0.28;
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
  const bars = [
    { at: 0, root: N.F2, notes: [N.F3, N.A3, N.C4, N.G4] },
    { at: 2, root: N.C2, notes: [N.C4 / 2, N.E3, N.G3, N.D4] },
    { at: 4, root: N.D2, notes: [N.D3, N.F3, N.A3, N.C4] },
    { at: 6, root: N.Bb1, notes: [N.Bb3 / 2, N.D3, N.F3, N.A3] },
    { at: 8, root: N.C2, notes: [N.C4 / 2, N.E3, N.G3, N.D4] },
  ];
  // The bed: a pad and a pulsing bass under every bar, quieter under the end card.
  bars.forEach((bar) => {
    const late = bar.at >= CUE.end;
    pad(bar.at, bar.notes, 2, late ? 0.04 : 0.05, 0.03, late ? 1300 : 1900);
    for (let t = bar.at; t < bar.at + 2 - 0.01; t += BEAT / 2) bass(t, bar.root, BEAT * 0.4, t % BEAT < 0.01 ? 0.3 : 0.18);
  });
  // Drums: four on the floor, claps on two and four, hats on the offbeats; thinner at the end.
  for (let beat = 0; beat * BEAT < DURATION - 0.05; beat += 1) {
    const t = beat * BEAT;
    const late = t >= CUE.end + 1;
    if (!late || beat % 2 === 0) kick(t, late ? 0.6 : 0.85);
    if (beat % 2 === 1) clap(t, late ? 0.25 : 0.38);
    hat(t + BEAT / 2, late ? 0.05 : 0.08, 0.2);
    if (!late) hat(t + BEAT / 4, 0.035, -0.2);
  }

  // 0: the hook lands.
  boom(0, 0.7, 0.9, 80);
  clap(0, 0.5);
  tone(0, N.F2, 0.6, 0.35, "sine", null, drums);
  // The counter: a small coin on every eighth note while the chip is the thing to look at.
  for (let t = COUNTER.every; t < CUE.flyOut; t += COUNTER.every) coin(t, 0.07, N.C6 * 2 ** ((Math.round(t / COUNTER.every) % 4) * 2 / 12));
  // The fly-out, and the window landing.
  whoosh(CUE.flyOut - 0.12, CUE.product - CUE.flyOut + 0.12, 0.2, true);
  clap(CUE.product, 0.5);
  tone(CUE.product, 150, 0.12, 0.4, "sine", 70, drums);
  tick(CUE.product + 0.02, 0.12, 2400);

  // AI writes the code: keys for the prompt, a send, then a stream of soft ticks.
  for (let i = 0; i < 10; i += 1) tick(CUE.prompt + i * 0.026, 0.05, 3000 + (i % 3) * 400, -0.25);
  whoosh(CUE.send - 0.02, 0.16, 0.08, true, -0.3);
  for (let t = CUE.stream[0]; t < CUE.stream[1]; t += 0.045) tick(t, 0.03 + 0.015 * random(), 4200 + random() * 2400, 0.25);
  chime(CUE.stream[1], N.A5, 0.06, 0.2);

  // The money: the card's pop, the flight up, the coin as it lands, the list opening.
  tone(CUE.card, N.A5, 0.12, 0.08, "sine");
  tone(CUE.card + 0.08, N.D6, 0.3, 0.07, "sine");
  whoosh(CUE.card - 0.06, 0.25, 0.08, false, 0.5);
  whoosh(CUE.payout, CUE.landed - CUE.payout, 0.16, true, 0.3);
  tone(CUE.payout, N.C5, CUE.landed - CUE.payout, 0.05, "triangle", N.C6);
  coin(CUE.landed, 0.24);
  coin(CUE.landed + 0.16, 0.14, N.C6 * 2);
  [N.F5, N.A5, N.C6].forEach((f, i) => pluck(CUE.landed + 0.04 + i * 0.06, f, 0.06, i % 2 ? 0.3 : -0.3));
  tick(CUE.row, 0.1, 2800);

  // Four cuts: a hit and a whoosh each, and the sound of each thing working.
  CUE.cuts.forEach((t, i) => {
    whoosh(t - 0.1, 0.12, 0.12, true, i % 2 ? -0.5 : 0.5);
    kick(t, 0.9);
    tone(t, 120 + i * 15, 0.1, 0.35, "sine", 60, drums);
    tick(t + 0.01, 0.12, 2000 + i * 300);
  });
  chime(CUE.cuts[0] + 0.32, N.G5, 0.05, 0.3);
  chime(CUE.cuts[1] + 0.2, N.C6, 0.07, 0);
  chime(CUE.cuts[1] + 0.27, N.G5 * 2, 0.05, 0.2);
  tick(CUE.cuts[2] + 0.15, 0.14, 1800);
  chime(CUE.cuts[2] + 0.25, N.E5 * 2, 0.06, -0.2);
  for (let i = 0; i < 12; i += 1) tick(CUE.cuts[3] + 0.08 + i * 0.03, 0.04, 3400 + (i % 3) * 300, 0.2);

  // 6.5: the mark. Boom, a wide F, the coin, plucks up the chord; the letters tick in.
  whoosh(CUE.end - 0.2, 0.2, 0.18, true);
  boom(CUE.end, 1, 2.0, 78);
  kick(CUE.end, 1);
  clap(CUE.end, 0.5);
  coin(CUE.end + 0.1, 0.2);
  pad(CUE.end, [N.F2, N.C3, N.F3, N.A3, N.C4, N.G4, N.A4], 1.6, 0.06, 0.02, 2400);
  [N.F5, N.A5, N.C6, N.F6].forEach((f, i) => pluck(CUE.end + 0.12 + i * 0.07, f, 0.06, i % 2 ? 0.35 : -0.35));
  [..."ADCode"].forEach((_, i) => tick(CUE.end + 0.12 + i * 0.02, 0.05, 3600 + i * 250));
  // The counter again, quietly, while the end card holds.
  for (let t = CUE.end + 0.75; t < DURATION - 0.2; t += COUNTER.every) coin(t, 0.035, N.C6 * 2 ** ((Math.round(t / COUNTER.every) % 4) * 2 / 12));

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
