/**
 * Original ADCode mascot score, 20 seconds, 120 BPM.
 * All instruments, pops and key taps are synthesized here; no samples or licensed music.
 * Offline stereo rendering makes every visual hit repeatable at 48 kHz. The first three
 * seconds carry a little friction; the team opens the harmony at 3, keys run at 6–9,
 * success arrives at 11–12, the brand rings at 15, and the phrase resolves at 19.5.
 */
const RATE = 48000;
const DURATION = 20;
const BEAT = 0.5;
const NOTE = (midi) => 440 * 2 ** ((midi - 69) / 12);

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns an interleaved 16-bit stereo WAV as base64, ready for AD.soundtrack(). */
export async function soundtrack() {
  const ctx = new OfflineAudioContext(2, RATE * DURATION, RATE);
  const random = seeded(20261001);
  const noise = ctx.createBuffer(1, RATE * 2, RATE);
  const noiseData = noise.getChannelData(0);
  for (let i = 0; i < noiseData.length; i += 1) noiseData[i] = random() * 2 - 1;

  const master = ctx.createGain();
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -17;
  glue.knee.value = 10;
  glue.ratio.value = 2.4;
  glue.attack.value = 0.008;
  glue.release.value = 0.18;
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, 19.75);
  master.gain.linearRampToValueAtTime(0, 19.99);
  master.connect(glue).connect(ctx.destination);

  const music = ctx.createGain(); music.gain.value = 0.78; music.connect(master);
  const effects = ctx.createGain(); effects.gain.value = 0.8; effects.connect(master);
  const drums = ctx.createGain(); drums.gain.value = 0.65; drums.connect(master);

  // A short, quiet stereo room gives the toys warmth without masking their transients.
  const room = ctx.createConvolver();
  const impulse = ctx.createBuffer(2, Math.round(RATE * 0.82), RATE);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = (random() * 2 - 1) * (1 - i / data.length) ** 4;
  }
  room.buffer = impulse;
  const wet = ctx.createGain(); wet.gain.value = 0.14;
  room.connect(wet).connect(master);
  const send = (node, amount = 0.25) => {
    const gain = ctx.createGain(); gain.gain.value = amount;
    node.connect(gain).connect(room);
  };
  const panNode = (pan) => {
    const node = ctx.createStereoPanner(); node.pan.value = pan; return node;
  };
  const filter = (type, frequency, q = 0.7) => {
    const node = ctx.createBiquadFilter();
    node.type = type; node.frequency.value = frequency; node.Q.value = q;
    return node;
  };
  const envelope = (gain, at, level, duration, attack = 0.006) => {
    gain.gain.setValueAtTime(0.00001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.00001, at + duration);
  };
  const tone = (at, frequency, duration, level, { type = "sine", pan = 0, bus = music, slide = null, roomSend = 0.18 } = {}) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (slide !== null) oscillator.frequency.exponentialRampToValueAtTime(slide, at + Math.min(duration * 0.72, 0.15));
    envelope(gain, at, level, duration);
    oscillator.connect(gain).connect(panNode(pan)).connect(bus);
    if (roomSend > 0) send(gain, roomSend);
    oscillator.start(at); oscillator.stop(at + duration + 0.025);
    return gain;
  };
  const noiseHit = (at, duration, level, frequency = 2400, pan = 0, bus = effects) => {
    const source = ctx.createBufferSource(); const gain = ctx.createGain();
    source.buffer = noise; source.loop = true;
    envelope(gain, at, level, duration, 0.001);
    source.connect(filter("bandpass", frequency, 1.5)).connect(gain).connect(panNode(pan)).connect(bus);
    source.start(at, random() * 1.4, duration + 0.025);
  };

  function marimba(at, midi, level = 0.105, pan = 0, length = 0.44) {
    tone(at, NOTE(midi), length, level, { pan });
    tone(at, NOTE(midi) * 3.98, length * 0.22, level * 0.19, { pan, roomSend: 0.1 });
    tone(at, NOTE(midi) * 2, length * 0.45, level * 0.13, { type: "triangle", pan, roomSend: 0.1 });
  }
  function chime(at, midis, level = 0.1, duration = 1.15) {
    midis.forEach((midi, i) => {
      const pan = (i - (midis.length - 1) / 2) * 0.22;
      tone(at + i * 0.035, NOTE(midi), duration, level, { pan, roomSend: 0.4 });
      tone(at + i * 0.035, NOTE(midi) * 2.003, duration * 0.48, level * 0.13, { pan, roomSend: 0.28 });
    });
  }
  function pop(at, midi, pan = 0, level = 0.15) {
    tone(at, NOTE(midi) * 1.42, 0.19, level, { slide: NOTE(midi), pan, bus: effects, roomSend: 0.16 });
    noiseHit(at, 0.019, level * 0.22, 2100, pan);
  }
  function kick(at, level = 0.28) {
    tone(at, 128, 0.25, level, { slide: 47, bus: drums, roomSend: 0 });
  }
  function snap(at, level = 0.1) {
    noiseHit(at, 0.09, level, 1650, 0, drums);
    noiseHit(at + 0.011, 0.052, level * 0.55, 3200, 0.08, drums);
  }
  function whoosh(at, duration, level = 0.15, from = -0.5, to = 0.5) {
    const source = ctx.createBufferSource(); const gain = ctx.createGain();
    const band = filter("bandpass", 550, 1.1); const pan = panNode(from);
    source.buffer = noise; source.loop = true;
    band.frequency.setValueAtTime(550, at);
    band.frequency.exponentialRampToValueAtTime(5800, at + duration);
    gain.gain.setValueAtTime(0.00001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + duration * 0.62);
    gain.gain.exponentialRampToValueAtTime(0.00001, at + duration);
    pan.pan.setValueAtTime(from, at); pan.pan.linearRampToValueAtTime(to, at + duration);
    source.connect(band).connect(gain).connect(pan).connect(effects);
    source.start(at, 0.2, duration + 0.02);
  }
  function pad(at, midis, duration, level = 0.028) {
    const gain = ctx.createGain(); const low = filter("lowpass", 1250);
    gain.gain.setValueAtTime(0.00001, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.12);
    gain.gain.setValueAtTime(level, at + duration - 0.3);
    gain.gain.linearRampToValueAtTime(0.00001, at + duration);
    midis.forEach((midi, i) => {
      const oscillator = ctx.createOscillator(); oscillator.type = "triangle";
      oscillator.frequency.value = NOTE(midi); oscillator.detune.value = i % 2 ? 4 : -4;
      oscillator.connect(low); oscillator.start(at); oscillator.stop(at + duration + 0.025);
    });
    low.connect(gain).connect(music); send(gain, 0.35);
  }

  // An original short melody, deliberately sparse while the viewer reads.
  const chords = [
    { at: 3, root: 43, notes: [55, 59, 62, 69] },
    { at: 5, root: 40, notes: [55, 59, 64, 67] },
    { at: 7, root: 48, notes: [55, 60, 64, 69] },
    { at: 9, root: 38, notes: [54, 57, 62, 64] },
    { at: 11, root: 43, notes: [55, 59, 62, 67] },
    { at: 13, root: 48, notes: [55, 60, 64, 69] },
    { at: 15, root: 43, notes: [55, 59, 62, 69] },
    { at: 17, root: 38, notes: [54, 57, 62, 64] },
  ];
  const melody = [
    [3, 67], [3.5, 71], [4, 74], [4.75, 71],
    [5.25, 67], [5.75, 64], [6.5, 67], [7, 72],
    [8, 76], [8.75, 74], [9.5, 69], [10.25, 66],
    [11, 67], [11.5, 71], [12, 74], [12.75, 79],
    [13.5, 76], [14, 72], [15.25, 74], [15.75, 71],
    [16.5, 67], [17.25, 69], [18, 66], [18.75, 62],
  ];

  // The hook: an immediate soft thump, slightly crooked descending notes and an
  // accelerating clock. A tiny breath just before 3 seconds makes the arrival clear.
  kick(0, 0.3);
  pop(0.02, 64, -0.2, 0.12);
  pad(0, [52, 55, 59], 2.74, 0.022);
  [[0.25, 76], [0.75, 74], [1.25, 71], [1.75, 70], [2.25, 71]].forEach(([at, midi], i) => {
    marimba(at, midi, 0.07, i % 2 ? 0.23 : -0.23, 0.24);
  });
  for (let at = 0.5; at < 2.6; at += 0.25) noiseHit(at, 0.025, 0.06, 1900, at % 0.5 ? 0.3 : -0.3);
  whoosh(2.64, 0.34, 0.12);

  // The team: one distinct pitched squish for each canonical agent on half-second beats.
  [67, 71, 74, 76, 79].forEach((midi, i) => pop(3 + i * BEAT, midi, (i - 2) * 0.24, 0.15));
  chime(3, [55, 62, 71], 0.06, 0.85);

  chords.forEach(({ at, root, notes }) => {
    pad(at, notes, 2.15, at >= 15 ? 0.034 : 0.025);
    for (let beat = 0; beat < 4; beat += 1) {
      const t = at + beat * BEAT;
      tone(t, NOTE(root), 0.27, 0.12, { bus: music, roomSend: 0 });
      if (at < 15 || beat % 2 === 0) kick(t, at >= 15 ? 0.2 : 0.28);
      if (beat % 2 === 1) snap(t, at >= 15 ? 0.07 : 0.1);
      noiseHit(t + 0.25, 0.03, 0.026, 7200, beat % 2 ? -0.3 : 0.3, drums);
    }
  });
  melody.forEach(([at, midi], i) => marimba(at, midi, at >= 15 ? 0.07 : 0.095, i % 2 ? 0.23 : -0.23));

  // Typing is physical but gentle: brief bursts, then a pause to leave the copy clear.
  for (let at = 6.03; at < 9; at += 0.085 + random() * 0.045) {
    if (at > 6.85 && at < 7.1 || at > 8.1 && at < 8.32) continue;
    noiseHit(at, 0.025, 0.045 + random() * 0.023, 1800 + random() * 2100, random() * 0.45 - 0.225);
    tone(at, 175 + random() * 45, 0.035, 0.025, { slide: 95, bus: effects, roomSend: 0 });
  }
  pop(9, 74, 0.22, 0.105);
  whoosh(10.72, 0.28, 0.1, 0.35, -0.35);

  // Build success and the team celebration: upward tones, with no voice carrying facts.
  chime(11, [67, 71, 74], 0.09, 1.0);
  pop(11.5, 79, -0.22, 0.1);
  chime(12, [71, 74, 79], 0.075, 0.9);
  [12.5, 13, 13.5].forEach((at, i) => pop(at, [76, 74, 79][i], [-0.32, 0, 0.32][i], 0.075));

  // The logo has a warm three-note signature, strongest at 15; it opens into the CTA.
  whoosh(14.62, 0.36, 0.11, -0.42, 0.42);
  kick(15, 0.34);
  chime(15, [55, 62, 67, 71, 74], 0.1, 1.65);
  [[15, 67], [15.125, 71], [15.25, 74]].forEach(([at, midi]) => marimba(at, midi, 0.16, 0, 0.65));
  pad(19, [55, 59, 62, 67], 0.95, 0.034);
  kick(19, 0.15);
  chime(19.5, [67, 71, 74], 0.07, 0.47);

  return encodeWav(await ctx.startRendering());
}

function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const text = (at, value) => [...value].forEach((char, i) => bytes.setUint8(at + i, char.charCodeAt(0)));
  text(0, "RIFF"); bytes.setUint32(4, 36 + frames * channels * 2, true); text(8, "WAVE");
  text(12, "fmt "); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true);
  bytes.setUint16(22, channels, true); bytes.setUint32(24, buffer.sampleRate, true);
  bytes.setUint32(28, buffer.sampleRate * channels * 2, true); bytes.setUint16(32, channels * 2, true);
  bytes.setUint16(34, 16, true); text(36, "data"); bytes.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) peak = Math.max(peak, Math.abs(data[channel][frame]));
  }
  // Preserve the dynamics; reduce only if needed to keep PCM peaks below −1 dBFS.
  const trim = peak > 0.89 ? 0.89 / peak : 1;
  let at = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = data[channel][frame] * trim;
      bytes.setInt16(at, Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff)), true);
      at += 2;
    }
  }
  const wave = new Uint8Array(bytes.buffer);
  const chunks = [];
  for (let start = 0; start < wave.length; start += 8192) chunks.push(String.fromCharCode(...wave.subarray(start, start + 8192)));
  return btoa(chunks.join(""));
}
