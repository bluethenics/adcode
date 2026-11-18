/** Round to `places` decimal places. */
export function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.floor(value * factor) / factor;
}
