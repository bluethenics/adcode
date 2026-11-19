/**
 * Call `fn` until it resolves, at most `attempts` times in all, waiting `delayMs` between tries
 * (doubling each time). Rejects with the last error when every attempt fails.
 */
export async function retry(fn, { attempts = 3, delayMs = 10 } = {}) {
  let wait = delayMs;
  for (let i = 1; i < attempts; i += 1) {
    try {
      return fn();
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait *= 2;
    }
  }
}
