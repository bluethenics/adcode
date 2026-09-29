/**
 * The soundtrack: 30 seconds at 120 BPM in A minor (Am F C G), synthesised offline from
 * the same cue sheet the picture uses, so every hit lands on its cut. Seeded noise, so it
 * renders identically every time. Returned as 16-bit stereo WAV bytes.
 *
 * Arrangement: a ticking clock under the hook, whooshes and a falling $ into a coin on
 * 3.0, the groove from 4.0, cut hits through the montage, a half-time lift for the ad
 * card, the drop and the coin on 17.0, a filtered rise into a quarter-second of silence,
 * the logo's boom on 22.0, a light outro, and a final chord that fades with the picture.
 */
import { BAR, BEAT, CUE, DURATION, PROMPT } from "./cues.js";
import { rng } from "./engine.js";

const RATE = 48000;

const CHORDS = {
  Am: { root: 55, pad: [220, 261.63, 329.63], arp: [440, 523.25, 659.25, 880] },
  F: { root: 43.65, pad: [174.61, 220, 261.63], arp: [349.23, 440, 523.25, 698.46] },
  C: { root: 65.41, pad: [196, 261.63, 329.63], arp: [392, 523.25, 659.25, 783.99] },
  G: { root: 49, pad: [196, 246.94, 293.66], arp: [392, 493.88, 587.33, 783.99] },
};
const PROGRESSION = ["Am", "F", "C", "G"];
const ARP = [0, 1, 2, 3, 2, 1, 0, 2, 0, 1, 2, 3, 2, 1, 3, 2];

export async function renderSoundtrack() {
  const ctx = new OfflineAudioContext(2, Math.round(DURATION * RATE), RATE);
  const random = rng(3000);
  const noise = ctx.createBuffer(1, RATE * 2, RATE);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 - 1;

  // ── The mix: buses → compressor → limiter → out, with a shared reverb ──
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16; glue.knee.value = 6; glue.ratio.value = 3.5; glue.attack.value = 0.006; glue.release.value = 0.18;
  const master = ctx.createGain();
  // A hard gate for the quarter-second of silence before the logo, then the final fade.
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, CUE.silence - 0.01);
  master.gain.linearRampToValueAtTime(0, CUE.silence + 0.01);
  master.gain.setValueAtTime(0.9, CUE.logo);
  master.gain.setValueAtTime(0.9, CUE.fadeOut);
  master.gain.linearRampToValueAtTime(0, DURATION);
  master.connect(glue).connect(limiter).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  const tail = ctx.createBuffer(2, Math.round(RATE * 2.4), RATE);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = tail.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = (random() * 2 - 1) * (1 - i / data.length) ** 3.2;
  }
  reverb.buffer = tail;
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  reverb.connect(wet).connect(master);

  const drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(master);
  const fx = ctx.createGain(); fx.gain.value = 0.8; fx.connect(master);
  // Music breathes with the kick (sidechain), and is filtered shut before the logo.
  const pump = ctx.createGain(); pump.gain.value = 1;
  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = "lowpass"; musicFilter.Q.value = 0.7;
  musicFilter.frequency.setValueAtTime(18000, 0);
  musicFilter.frequency.setValueAtTime(18000, CUE.implode);
  musicFilter.frequency.exponentialRampToValueAtTime(260, CUE.silence);
  musicFilter.frequency.setValueAtTime(18000, CUE.logo);
  const music = ctx.createGain(); music.gain.value = 0.62;
  music.connect(pump).connect(musicFilter).connect(master);

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
    body.frequency.setValueAtTime(160, t);
    body.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(gain, t, level, 0.002, 0.42);
    body.connect(gain).connect(drums);
    body.start(t); body.stop(t + 0.5);
    const click = noiseSource(t, 0.03); const clickGain = ctx.createGain();
    env(clickGain, t, 0.25 * level, 0.001, 0.02);
    click.connect(filter("highpass", 2600)).connect(clickGain).connect(drums);
    pump.gain.setValueAtTime(0.5, t);
    pump.gain.linearRampToValueAtTime(1, t + 0.24);
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

  function hat(t, level = 0.12, open = false, pan = 0) {
    const source = noiseSource(t, open ? 0.3 : 0.06); const gain = ctx.createGain();
    env(gain, t, level, 0.001, open ? 0.26 : 0.04);
    source.connect(filter("highpass", 7800)).connect(gain).connect(panner(pan)).connect(drums);
  }

  function bass(t, frequency, duration, level = 0.34) {
    const gain = ctx.createGain();
    const low = filter("lowpass", 180, 5);
    low.frequency.setValueAtTime(160, t);
    low.frequency.exponentialRampToValueAtTime(760, t + 0.03);
    low.frequency.exponentialRampToValueAtTime(240, t + duration);
    env(gain, t, level, 0.004, duration);
    for (const cents of [-6, 6]) {
      const osc = ctx.createOscillator(); osc.type = "sawtooth";
      osc.frequency.value = frequency * 2; osc.detune.value = cents;
      osc.connect(low); osc.start(t); osc.stop(t + duration + 0.1);
    }
    low.connect(gain).connect(music);
  }

  function pluck(t, frequency, level = 0.11, pan = 0) {
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
    gain.gain.linearRampToValueAtTime(level, t + Math.min(0.6, duration / 2));
    gain.gain.setValueAtTime(level, t + duration - 0.3);
    gain.gain.linearRampToValueAtTime(0.0001, t + duration + 0.6);
    const low = filter("lowpass", 1200, 0.6);
    for (const frequency of frequencies) {
      for (const cents of [-9, 9]) {
        const osc = ctx.createOscillator(); osc.type = "sawtooth";
        osc.frequency.value = frequency; osc.detune.value = cents;
        osc.connect(low); osc.start(t); osc.stop(t + duration + 0.7);
      }
    }
    low.connect(gain).connect(music);
    send(gain, 0.5);
  }

  function riser(t0, t1, level = 0.2) {
    const source = noiseSource(t0, t1 - t0); const gain = ctx.createGain();
    const band = filter("bandpass", 400, 2.2);
    band.frequency.setValueAtTime(400, t0);
    band.frequency.exponentialRampToValueAtTime(7200, t1);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(level, t1 - 0.02);
    gain.gain.linearRampToValueAtTime(0, t1);
    source.connect(band).connect(gain).connect(fx);
    send(gain, 0.3);
  }

  function whoosh(t, duration = 0.45, level = 0.3, up = false, from = -0.6, to = 0.6) {
    const source = noiseSource(t, duration); const gain = ctx.createGain();
    const band = filter("bandpass", up ? 500 : 6000, 1.1);
    band.frequency.setValueAtTime(up ? 500 : 6000, t);
    band.frequency.exponentialRampToValueAtTime(up ? 6000 : 450, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(from, t);
    pan.pan.linearRampToValueAtTime(to, t + duration);
    source.connect(band).connect(gain).connect(pan).connect(fx);
    send(gain, 0.2);
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

  function coin(t, level = 0.22) {
    tone(t, 987.77, 0.08, level, "square");
    const ring = tone(t + 0.075, 1318.51, 0.9, level, "square");
    send(ring, 0.45);
  }

  function key(t, level = 0.06) {
    const source = noiseSource(t, 0.03); const gain = ctx.createGain();
    env(gain, t, level, 0.001, 0.022);
    source.connect(filter("bandpass", 3200 + random() * 900, 1.6)).connect(gain).connect(panner(random() * 0.6 - 0.3)).connect(fx);
  }

  function click(t, level = 0.14) {
    key(t, level);
    tone(t, 1250, 0.03, level * 0.6);
  }

  function boom(t, level = 0.9) {
    const body = ctx.createOscillator(); const gain = ctx.createGain();
    body.frequency.setValueAtTime(64, t);
    body.frequency.exponentialRampToValueAtTime(33, t + 1.4);
    env(gain, t, level, 0.004, 1.8);
    body.connect(gain).connect(fx); body.start(t); body.stop(t + 2);
    const crack = noiseSource(t, 0.8); const crackGain = ctx.createGain();
    env(crackGain, t, level * 0.35, 0.002, 0.7);
    crack.connect(filter("lowpass", 1100)).connect(crackGain).connect(fx);
    send(crackGain, 0.4);
  }

  function crash(t, level = 0.12) {
    const source = noiseSource(t, 1.6); const gain = ctx.createGain();
    env(gain, t, level, 0.002, 1.5);
    source.connect(filter("highpass", 5200)).connect(gain).connect(drums);
    send(gain, 0.3);
  }

  function groove(start, end, { kicks = true, halfTime = false, arpLevel = 0.11, padLevel = 0.045, bassOn = true } = {}) {
    for (let bar = start; bar < end - 0.001; bar += BAR) {
      const chord = CHORDS[PROGRESSION[((Math.round((bar - CUE.vibe) / BAR) % 4) + 4) % 4]];
      pad(bar, chord.pad, BAR, padLevel);
      for (let beat = 0; beat < 4; beat += 1) {
        const at = bar + beat * BEAT;
        if (kicks && (!halfTime || beat % 2 === 0)) kick(at);
        if (beat % 2 === 1 && !halfTime) clap(at, 0.42);
        hat(at + BEAT / 2, 0.11, beat === 3, 0.15);
        hat(at + BEAT / 4, 0.04, false, -0.2);
        hat(at + (3 * BEAT) / 4, 0.04, false, 0.2);
        if (bassOn) bass(at + BEAT / 2, chord.root, BEAT / 2 - 0.02);
      }
      ARP.forEach((index, step) => {
        if (step === 7 || step === 15) return;
        pluck(bar + step * (BEAT / 2 / 2), chord.arp[index], arpLevel, step % 2 === 0 ? -0.25 : 0.25);
      });
    }
  }

  // ── The score ──
  // Hook: a clock ticking through the workday, a low pad, rising into the fold.
  for (let t = 0; t < CUE.fold; t += BEAT / 2) hat(t, t % BEAT === 0 ? 0.16 : 0.08, false, t % BEAT === 0 ? -0.3 : 0.3);
  kick(0, 0.7); kick(CUE.hookPulse, 0.85);
  pad(0, CHORDS.Am.pad.map((f) => f / 2), 2.2, 0.06);
  riser(1.2, CUE.fold, 0.12);
  // Flip: the page turns, the brackets arrive, the $ falls and lands.
  whoosh(CUE.fold - 0.1, 0.5, 0.34);
  whoosh(CUE.bracketsIn, 0.3, 0.2, false, -0.9, -0.2);
  whoosh(CUE.bracketsIn + 0.02, 0.3, 0.2, false, 0.9, 0.2);
  tone(CUE.dollarDrop, 1600, CUE.dollarLand - CUE.dollarDrop, 0.08, "triangle", 240);
  kick(CUE.dollarLand, 1); coin(CUE.dollarLand, 0.24); crash(CUE.dollarLand, 0.1); boom(CUE.dollarLand, 0.35);
  pad(CUE.dollarLand, CHORDS.F.pad, 1.1, 0.05);
  riser(CUE.dollarLand + 0.2, CUE.vibe, 0.16);
  whoosh(CUE.toVibe, 0.5, 0.26, true, -0.4, 0.4);

  // Vibe and Agents: the groove.
  crash(CUE.vibe, 0.1);
  groove(CUE.vibe, CUE.adcard);
  [...PROMPT].forEach((_, i) => key(CUE.typeStart + i / CUE.typeRate, 0.07));
  click(CUE.send, 0.16);
  CUE.files.forEach((t, i) => tone(t, 880 * 1.12 ** i, 0.12, 0.06, "triangle", 1320 * 1.12 ** i));
  whoosh(CUE.preview, 0.35, 0.18, false, 0.8, 0.1);
  CUE.checks.forEach((t, i) => { click(t, 0.1); tone(t + 0.01, 1568 + i * 196, 0.18, 0.045); });
  whoosh(CUE.toAgents + 0.1, 0.45, 0.3, false, 0.8, -0.8);
  const { tester, fixerNeeds, approve, fixerReady, reviewer } = CUE.moves;
  for (const t of [tester, fixerNeeds, fixerReady, reviewer]) whoosh(t, 0.32, 0.14, true, -0.3, 0.3);
  click(approve, 0.18);
  for (const t of [tester, fixerReady, reviewer]) tone(t + 0.5, 2093, 0.4, 0.05, "sine");
  // Montage: a hit on every cut.
  CUE.montage.forEach((t) => { clap(t, 0.6); crash(t, 0.05); });

  // The ad card: half time, a notification, a lift into the drop.
  groove(CUE.adcard, CUE.earn, { halfTime: true, arpLevel: 0.07, padLevel: 0.05 });
  whoosh(CUE.cardIn, 0.4, 0.2, false, 0.8, 0.3);
  tone(CUE.cardIn + 0.25, 880, 0.18, 0.06); tone(CUE.cardIn + 0.37, 1318.51, 0.3, 0.06);
  riser(CUE.pushIn - 0.2, CUE.earn, 0.2);
  whoosh(CUE.pushIn, 0.5, 0.2, true);

  // Earn: the drop, the money running, the coin on 17.0.
  crash(CUE.earn, 0.12);
  groove(CUE.earn, CUE.implode);
  riser(CUE.flow, CUE.fifty, 0.1);
  coin(CUE.fifty, 0.3); boom(CUE.fifty, 0.3);
  click(CUE.itemized, 0.08);

  // Implode: the music closes (see musicFilter), a snare roll and a big rise, then nothing.
  pad(CUE.implode, CHORDS.Am.pad, 1.1, 0.05);
  ARP.forEach((index, step) => { if (step < 13) pluck(CUE.implode + step * (BEAT / 2), CHORDS.Am.arp[index], 0.08, step % 2 ? 0.25 : -0.25); });
  kick(CUE.implode, 1); kick(CUE.implode + BAR / 2, 0.8);
  for (let t = CUE.implode; t < CUE.silence - 0.01; t += t < CUE.implode + 1 ? BEAT / 2 : BEAT / 4) {
    clap(t, 0.18 + 0.32 * ((t - CUE.implode) / (CUE.silence - CUE.implode)));
  }
  riser(CUE.implode, CUE.silence, 0.3);
  tone(CUE.implode, 110, CUE.silence - CUE.implode, 0.05, "sawtooth", 880);

  // The mark: boom, chord, sparkle; the wordmark's letters; the tagline.
  boom(CUE.logo, 1); crash(CUE.logo, 0.16); coin(CUE.logo + 0.05, 0.16);
  pad(CUE.logo, [110, 164.81, 220, 246.94, 329.63], 2, 0.07);
  CHORDS.Am.arp.forEach((f, i) => pluck(CUE.logo + i * 0.04, f, 0.1, i % 2 ? 0.3 : -0.3));
  [..."ADCode"].forEach((_, i) => tone(CUE.wordmark + i * 0.1, 1760 + i * 110, 0.05, 0.035));
  whoosh(CUE.tagline, 0.5, 0.12, true);

  // End card: a light outro, the click, the update line, and a last chord.
  groove(CUE.end, CUE.outro, { arpLevel: 0.075, padLevel: 0.04 });
  click(CUE.click, 0.16);
  whoosh(CUE.endLines[4], 0.4, 0.1, true); tone(CUE.endLines[4] + 0.2, 1318.51, 0.3, 0.04);
  kick(CUE.outro, 0.8);
  pad(CUE.outro, CHORDS.Am.pad, 1.8, 0.06);
  CHORDS.Am.arp.forEach((f, i) => pluck(CUE.outro + i * 0.25, f, 0.08, i % 2 ? 0.25 : -0.25));

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
