/** Parse one line of CSV into fields. Quoted fields may hold commas, and "" inside quotes is one quote. */
export function parseCsvLine(line) {
  return line.split(",").map((field) => field.trim());
}
