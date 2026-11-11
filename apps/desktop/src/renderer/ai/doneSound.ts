/**
 * A short chime when the assistant finishes.
 *
 * Asked for in a report (2.5.1): a long task ends while the person is in another window, and
 * nothing says so. This is two soft notes, made here with the Web Audio API - no sound file
 * to ship, nothing to load - and it is off unless `adcode.ai.doneSound` is turned on.
 *
 * It plays only for a task that took a while, or when the window is not in front: a chime
 * after every two-second answer would be turned off within the hour.
 */
export const DONE_SOUND_SETTING = "adcode.ai.doneSound";
/** A turn shorter than this, finished while the person is looking, makes no sound. */
export const DONE_SOUND_MIN_MS = 12_000;

/** Whether this finished turn should chime. */
export function shouldChime(input: { readonly enabled: boolean; readonly elapsedMs: number; readonly windowFocused: boolean; readonly failed: boolean }): boolean {
  if (!input.enabled || input.failed) return false;
  return !input.windowFocused || input.elapsedMs >= DONE_SOUND_MIN_MS;
}

let context: AudioContext | null = null;

/** Play the chime. Silent, never throwing, where audio is unavailable. */
export function playDoneSound(): void {
  try {
    context ??= new AudioContext();
    const audio = context;
    void audio.resume().catch(() => undefined);
    const start = audio.currentTime + 0.02;
    // A rising fifth, each note a quick swell and a longer fade: present, not startling.
    for (const [index, frequency] of [659.25, 987.77].entries()) {
      const at = start + index * 0.13;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.09, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.45);
    }
  } catch {
    // No audio device, or the page may not play yet: finishing quietly is fine.
  }
}
