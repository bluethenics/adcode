/**
 * The soundtrack: 8 seconds at 120 BPM in A minor, synthesised offline from the same cue
 * sheet the picture uses, so every hit lands on its cut. Seeded noise, so it renders
 * identically every time. Returned as 16-bit stereo WAV bytes.
 *
 * Arrangement: a coin tick under the hook (the money counting), a sub drone and a filtered
 * rise under the cuts, a hit on every cut as they speed up, then a hard gate - a quarter
 * second of nothing - before the notification's boom, a bell and a coin on 4.25, the
 * downbeat stab on 5.0, the logo's boom on 6.0 with a chord and a run of plucks, and a pickup
 * kick at the end that leads into the kick the film opens on, so the loop has no seam.
 * Built to work with the sound off too: nothing here carries information the picture
 * does not.
 */
import { BEAT, CUE, DURATION, SHOTS } from "./cues.js";
import { rng } from "./shared/engine.js";

const RATE = 48000;
const AM = { pad: [220, 261.63, 329.63], arp: [440, 523.25, 659.25, 880] };

export async function renderSoundtrack() {
  const ctx = new OfflineAudioContext(2, Math.round(DURATION * RATE), RATE);
  const random = rng(8080);
  const noise = ctx.createBuffer(1, RATE * 2, RATE);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 - 1;

  // ── The mix: buses → compressor → limiter → out, with a shared reverb ──
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16; glue.knee.value = 6; glue.ratio.value = 3.5; glue.attack.value = 0.005; glue.release.value = 0.15;
  const master = ctx.createGain();
  // The hard gate: everything stops at 4.0 and returns with the hit; and a few
  // milliseconds of fade at the very end so a loop never clicks.
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, CUE.silence - 0.008);
  master.gain.linearRampToValueAtTime(0, CUE.silence);
  master.gain.setValueAtTime(0.9, CUE.hit - 0.002);
  master.gain.setValueAtTime(0.9, DURATION - 0.03);
  master.gain.linearRampToValueAtTime(0, DURATION);
  master.connect(glue).connect(limiter).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  const tail = ctx.createBuffer(2, Math.round(RATE * 1.6), RATE);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = tail.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = (random() * 2 - 1) * (1 - i / data.length) ** 3.2;
  }
  reverb.buffer = tail;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  reverb.connect(wet).connect(master);

  const drums = ctx.createGain(); drums.gain.value = 0.95; drums.connect(master);
  const fx = ctx.createGain(); fx.gain.value = 0.8; fx.connect(master);
  const music = ctx.createGain(); music.gain.value = 0.6; music.connect(master);

  const send = (node, amount) => {
    const gain = ctx.createGain(); gain.gain.value = amount;
    node.connect(gain).connect(reverb);
  };
  const env = (gain, t, level, attack, decay) => {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noiseSource = (t, duration) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.start(t, random() * 1.2, duration + 0.05);
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
  function kick(t, level = 1) {
    const body = ctx.createOscillator(); const gain = ctx.createGain();
    body.frequency.setValueAtTime(170, t);
    body.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    env(gain, t, level, 0.002, 0.4);
    body.connect(gain).connect(drums);
    body.start(t); body.stop(t + 0.5);
    const click = noiseSource(t, 0.03); const clickGain = ctx.createGain();
    env(clickGain, t, 0.28 * level, 0.001, 0.02);
    click.connect(filter("highpass", 2600)).connect(clickGain).connect(drums);
  }

  function clap(t, level = 0.5) {
    const source = noiseSource(t, 0.3); const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    for (const offset of [0, 0.011, 0.022]) {
      gain.gain.setValueAtTime(level, t + offset);
      gain.gain.exponentialRampToValueAtTime(level * 0.2, t + offset + 0.01);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    source.connect(filter("bandpass", 1400, 0.9)).connect(gain).connect(drums);
    send(gain, 0.28);
  }

  function hat(t, level = 0.1, pan = 0) {
    const source = noiseSource(t, 0.06); const gain = ctx.createGain();
    env(gain, t, level, 0.001, 0.04);
    source.connect(filter("highpass", 7800)).connect(gain).connect(panner(pan)).connect(drums);
  }

  function tone(t, frequency, duration, level, type = "sine", toFrequency = null) {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (toFrequency !== null) osc.frequency.exponentialRampToValueAtTime(toFrequency, t + duration);
    env(gain, t, level, 0.003, duration);
    osc.connect(gain).connect(fx);
    osc.start(t); osc.stop(t + duration + 0.05);
    return gain;
  }

  /** The money: a short bright tick, and at the end of a run a ring that lingers. */
  function coin(t, level = 0.2, high = 1318.51) {
    tone(t, high * 0.75, 0.07, level, "square");
    send(tone(t + 0.07, high, 0.7, level, "square"), 0.45);
  }

  /** A thock for a cut: a short body and a click. */
  function thock(t, level = 0.5, frequency = 130) {
    tone(t, frequency, 0.09, level, "sine", frequency * 0.5).connect(drums);
    const source = noiseSource(t, 0.03); const gain = ctx.createGain();
    env(gain, t, level * 0.5, 0.001, 0.025);
    source.connect(filter("bandpass", 2400, 1.2)).connect(gain).connect(fx);
  }

  function boom(t, level = 0.9, length = 1.6) {
    const body = ctx.createOscillator(); const gain = ctx.createGain();
    body.frequency.setValueAtTime(70, t);
    body.frequency.exponentialRampToValueAtTime(34, t + length * 0.8);
    env(gain, t, level, 0.004, length);
    body.connect(gain).connect(fx); body.start(t); body.stop(t + length + 0.3);
    const crack = noiseSource(t, 0.7); const crackGain = ctx.createGain();
    env(crackGain, t, level * 0.35, 0.002, 0.6);
    crack.connect(filter("lowpass", 1200)).connect(crackGain).connect(fx);
    send(crackGain, 0.4);
  }

  function pluck(t, frequency, level = 0.1, pan = 0) {
    const gain = ctx.createGain();
    const low = filter("lowpass", 3600, 2.5);
    low.frequency.setValueAtTime(4200, t);
    low.frequency.exponentialRampToValueAtTime(650, t + 0.28);
    env(gain, t, level, 0.003, 0.34);
    for (const [type, cents] of [["sawtooth", -5], ["square", 5]]) {
      const osc = ctx.createOscillator(); osc.type = type;
      osc.frequency.value = frequency; osc.detune.value = cents;
      osc.connect(low); osc.start(t); osc.stop(t + 0.45);
    }
    low.connect(gain).connect(panner(pan)).connect(music);
    send(gain, 0.35);
  }

  function pad(t, frequencies, duration, level = 0.05) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.15);
    gain.gain.setValueAtTime(level, t + duration - 0.2);
    gain.gain.linearRampToValueAtTime(0.0001, t + duration);
    const low = filter("lowpass", 1400, 0.6);
    for (const frequency of frequencies) {
      for (const cents of [-9, 9]) {
        const osc = ctx.createOscillator(); osc.type = "sawtooth";
        osc.frequency.value = frequency; osc.detune.value = cents;
        osc.connect(low); osc.start(t); osc.stop(t + duration + 0.1);
      }
    }
    low.connect(gain).connect(music);
    send(gain, 0.5);
  }

  function whoosh(t, duration, level, up) {
    const source = noiseSource(t, duration); const gain = ctx.createGain();
    const band = filter("bandpass", up ? 500 : 6000, 1.1);
    band.frequency.setValueAtTime(up ? 500 : 6000, t);
    band.frequency.exponentialRampToValueAtTime(up ? 6000 : 450, t + duration);
    env(gain, t, level, duration * 0.4, duration * 0.6);
    source.connect(band).connect(gain).connect(fx);
    send(gain, 0.2);
  }

  /** Tension: a drone under everything that opens up, and noise that climbs to the gate. */
  function tension(from, to) {
    const drone = ctx.createOscillator(); const gain = ctx.createGain();
    const low = filter("lowpass", 90, 3);
    low.frequency.setValueAtTime(90, from);
    low.frequency.exponentialRampToValueAtTime(900, to);
    drone.type = "sawtooth"; drone.frequency.value = 55;
    gain.gain.setValueAtTime(0.0001, from);
    gain.gain.exponentialRampToValueAtTime(0.32, to - 0.05);
    drone.connect(low).connect(gain).connect(music);
    drone.start(from); drone.stop(to + 0.05);

    const source = noiseSource(from, to - from); const rise = ctx.createGain();
    const band = filter("bandpass", 500, 2);
    band.frequency.setValueAtTime(500, from);
    band.frequency.exponentialRampToValueAtTime(9000, to);
    rise.gain.setValueAtTime(0.0001, from);
    rise.gain.exponentialRampToValueAtTime(0.28, to - 0.02);
    source.connect(band).connect(rise).connect(fx);
  }

  // ── The score ──

  // 0–1: the money ticking, on a kick to open - the same hit the loop closes on.
  kick(0, 1);
  CUE.ticks.forEach((t, i) => coin(t + 0.001, 0.12 + i * 0.02, 1046.5 * 2 ** (i / 6)));
  for (let t = 0.125; t < 1.0; t += 0.25) hat(t, 0.05, -0.2);

  // 0.5–4: the wait. Tension under it all; a quarter-note pulse that doubles, then triples.
  tension(0.5, CUE.silence);
  for (let t = 1.0; t < 2.0; t += 0.25) hat(t, 0.06, 0.2);
  for (let t = 2.0; t < 3.5; t += 1 / 6) hat(t, 0.08, t % 0.5 < 0.2 ? -0.25 : 0.25);

  // Every cut lands with a thock; the last three, a sixth of a second apart, climb in pitch.
  SHOTS.slice(1).forEach((shot, i) => {
    const cut = i >= 7 ? 0.62 : 0.42;
    thock(shot.from, cut, 110 + i * 12);
    if (i >= 4) kick(shot.from, 0.55 + i * 0.03);
  });
  [CUE.send, CUE.typeStart, CUE.typeStart + 0.08, CUE.typeStart + 0.16, CUE.typeStart + 0.24].forEach((t, i) => {
    const source = noiseSource(t, 0.03); const gain = ctx.createGain();
    env(gain, t, i === 4 ? 0.12 : 0.06, 0.001, 0.022);
    source.connect(filter("bandpass", 3200 + i * 300, 1.6)).connect(gain).connect(fx);
  });
  whoosh(CUE.silence - 0.5, 0.5, 0.16, true);

  // 4.0–4.25: nothing. The master gate holds it shut.

  // 4.25: the notification. Boom, kick, a bell, and the coin as the +$0.04 leaves the card.
  boom(CUE.hit, 1, 1.2);
  kick(CUE.hit, 1);
  clap(CUE.hit, 0.5);
  tone(CUE.hit + 0.005, 1318.51, 1.1, 0.16, "sine").connect(reverb);
  tone(CUE.hit + 0.005, 1975.53, 0.9, 0.1, "sine").connect(reverb);
  whoosh(CUE.fly - 0.05, 0.3, 0.12, true);
  coin(CUE.fly, 0.22);
  coin(CUE.landed, 0.18, 1567.98);

  // 5.0: the answer. Stab and kick on the downbeat, a groove under the split.
  kick(CUE.split, 1);
  clap(CUE.split, 0.5);
  pad(CUE.split, AM.pad, 1.0, 0.07);
  tone(CUE.split, 55, 0.9, 0.5, "sine").connect(drums);
  AM.arp.forEach((f, i) => pluck(CUE.split + i * 0.06, f, 0.09, i % 2 ? 0.3 : -0.3));
  for (let t = CUE.split + BEAT / 2; t < CUE.logo; t += BEAT / 2) hat(t, 0.09, 0.15);
  kick(CUE.split + BEAT, 0.8);
  coin(CUE.bar, 0.16, 1760);
  whoosh(CUE.logo - 0.42, 0.42, 0.14, true);

  // 6.0: the mark. Boom, a wide Am chord, a run of plucks up the arpeggio, the letters ticking.
  boom(CUE.logo, 1, 1.6);
  kick(CUE.logo, 1);
  pad(CUE.logo, [110, 164.81, 220, 246.94, 329.63], 2, 0.075);
  AM.arp.forEach((f, i) => pluck(CUE.logo + i * 0.05, f, 0.1, i % 2 ? 0.3 : -0.3));
  [..."ADCode"].forEach((_, i) => tone(CUE.wordmark + i * 0.045, 1760 + i * 110, 0.05, 0.03));
  whoosh(CUE.tagline - 0.05, 0.3, 0.12, true);
  coin(CUE.tagline + 0.02, 0.2, 1567.98);
  tone(CUE.free, 1318.51, 0.25, 0.05);
  tone(CUE.url, 1975.53, 0.4, 0.06);
  AM.arp.forEach((f, i) => pluck(CUE.url + 0.05 + i * 0.1, f * 2, 0.06, i % 2 ? 0.35 : -0.35));

  // A pickup kick a quarter of a bar out, leading straight into the kick the film opens on.
  kick(DURATION - 0.5 * BEAT, 0.7);

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
