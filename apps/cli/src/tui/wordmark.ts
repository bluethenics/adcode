/** Every letter occupies five columns; spacing stays identical on every row. */
const LETTERS = [
  ["  █  ", " █ █ ", "█   █", "█████", "█   █"],
  ["████ ", "█   █", "█   █", "█   █", "████ "],
  [" ████", "█    ", "█    ", "█    ", " ████"],
  [" ███ ", "█   █", "█   █", "█   █", " ███ "],
  ["████ ", "█   █", "█   █", "█   █", "████ "],
  ["█████", "█    ", "████ ", "█    ", "█████"],
];
export const WORDMARK = Array.from({ length: 5 }, (_, row) => LETTERS.map((letter) => letter[row]).join("  "));
