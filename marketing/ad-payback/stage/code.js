/**
 * Code the film shows: the habit tracker the Vibe scene builds. Real, runnable-looking
 * JavaScript, tokenised once into monochrome classes (the only colour is money).
 */
import { h } from "./engine.js";

export const HABITS_JS = `import { loadHabits, saveHabits } from "./store.js";

// A streak counts consecutive days, ending today or yesterday.
export function streakOf(habit, today = new Date()) {
  const days = new Set(habit.done.map((day) => day.slice(0, 10)));
  let streak = 0;
  const cursor = new Date(today);
  if (!days.has(isoDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(isoDay(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function toggle(habits, id, today = new Date()) {
  const day = isoDay(today);
  return habits.map((habit) => {
    if (habit.id !== id) return habit;
    const done = habit.done.includes(day)
      ? habit.done.filter((entry) => entry !== day)
      : [...habit.done, day];
    return { ...habit, done };
  });
}

export async function render(list) {
  const habits = await loadHabits();
  list.replaceChildren(
    ...habits.map((habit) => row(habit, streakOf(habit))),
  );
}

function row(habit, streak) {
  const item = document.createElement("li");
  item.className = streak > 0 ? "habit on-fire" : "habit";
  item.innerHTML = \`<input type="checkbox"> \${habit.name}\`;
  item.dataset.streak = String(streak);
  return item;
}

const isoDay = (date) => date.toISOString().slice(0, 10);

document.addEventListener("change", async (event) => {
  const id = event.target.closest(".habit")?.dataset.id;
  if (!id) return;
  await saveHabits(toggle(await loadHabits(), id));
  await render(document.querySelector("#habits"));
});`;

export const STREAKS_CSS = `.habit {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--card);
}

.habit.on-fire::after {
  content: attr(data-streak) " days";
  margin-left: auto;
  font-weight: 600;
}

.habit input:checked {
  accent-color: currentColor;
  transform: scale(1.1);
}`;

const KEYWORDS = /^(import|export|from|function|const|let|return|if|while|async|await|new|true|false|of|for|in)$/;
const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d"'`]+)/gm;

/** One line of source as spans: comment, string, number, call, keyword, plain. */
export function codeLine(text) {
  const parts = [];
  for (const match of text.matchAll(TOKEN)) {
    const [whole, comment, string, number, call, word] = match;
    const kind = comment ? "c" : string ? "s" : number ? "n" : call ? "f" : word && KEYWORDS.test(word) ? "k" : "p";
    parts.push(kind === "p" ? whole : h("span", { class: `tok-${kind}`, text: whole }));
  }
  return parts;
}

/** Rows of numbered code, for an editor or the scrolling wall behind the hook. */
export function codeRows(source, firstLine = 1) {
  return source.split("\n").map((text, index) =>
    h("div", { class: "code-row" },
      h("span", { class: "code-ln", text: String(firstLine + index) }),
      h("span", { class: "code-text" }, codeLine(text))));
}
