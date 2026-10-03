"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Mark } from "./Mark";

/**
 * Vibe and Code, side by side - the two windows ADCode opens on the same project.
 *
 * The switch is drawn like the one in the app, because the thing it demonstrates is that
 * control: one click between describing what you want and writing it yourself. The
 * windows are illustrations built from the real layout - the Vibe sidebar's rows, the
 * worked-for block, the per-turn Undo card, the floating assistant over the IDE - and every
 * point beside them is a feature the help entries document (workbench.modes,
 * workbench.vibeSidebar, ai.agents, workbench.aiContext).
 */
type Mode = "vibe" | "code";

const MODES: Record<Mode, { label: string; icon: string; title: string; lead: string; points: string[] }> = {
  vibe: {
    label: "Vibe",
    icon: "✦",
    title: "Describe it. Agents build it.",
    lead: "ADCode opens in Vibe: a conversation, not a wall of code. Say what you want and watch it get built.",
    points: [
      "Agents plan the work, write the code and run your tests.",
      "Run several at once - each works in its own copy of the project.",
      "Changes land straight away, with Undo on every turn.",
      "See it running in Preview, then Commit & Push in one click.",
    ],
  },
  code: {
    label: "Code",
    icon: "</>",
    title: "Take the wheel whenever you want.",
    lead: "Code opens the full IDE on the same project. Nothing to export, nothing to sync.",
    points: [
      "Monaco editing, real terminals and git with a visual history.",
      "The assistant floats over your code - select lines, press Ctrl+L, ask.",
      "Explain, refactor, write tests or find issues from a right-click.",
      "Vibe is one click away, with the conversation where you left it.",
    ],
  },
};

const ORDER: readonly Mode[] = ["vibe", "code"];

export function ModeShowcase() {
  const [mode, setMode] = useState<Mode>("vibe");
  const tabs = useRef<Record<Mode, HTMLButtonElement | null>>({ vibe: null, code: null });

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
    setMode(next);
    tabs.current[next]?.focus();
  };

  const copy = MODES[mode];
  return (
    <section className="modes marketplace-wrap" aria-labelledby="modes-heading">
      <div className="modes-intro">
        <h2 id="modes-heading">Talk it into existence.<br />Or write every line.</h2>
        <p>Two windows on one project. Switch whenever the work changes.</p>
        <div className="modes-switch" role="tablist" aria-label="ADCode modes">
          {ORDER.map((value) => (
            <button
              key={value}
              ref={(element) => { tabs.current[value] = element; }}
              type="button"
              role="tab"
              id={`modes-tab-${value}`}
              aria-selected={mode === value}
              aria-controls="modes-panel"
              tabIndex={mode === value ? 0 : -1}
              data-mode={value}
              onClick={() => setMode(value)}
              onKeyDown={onKey}
            >
              <span aria-hidden="true">{MODES[value].icon}</span> {MODES[value].label}
            </button>
          ))}
        </div>
      </div>

      <div className="modes-body" id="modes-panel" role="tabpanel" aria-labelledby={`modes-tab-${mode}`} data-mode={mode}>
        <div className="modes-copy">
          <h3>{copy.title}</h3>
          <p>{copy.lead}</p>
          <ul>{copy.points.map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
        <figure className="modes-stage" aria-label={mode === "vibe"
          ? "Illustration of ADCode's Vibe window: a conversation where an agent added a streak counter, with an Undo card and a sponsored card in the corner"
          : "Illustration of ADCode's Code window: file tree, editor, terminal and the assistant floating over the code"}
        >
          {mode === "vibe" ? <VibeWindow /> : <CodeWindow />}
        </figure>
      </div>
    </section>
  );
}

function WindowBar({ title }: { title: string }) {
  return (
    <div className="mw-bar" aria-hidden="true">
      <span className="window-dots"><i /><i /><i /></span>
      <span className="mw-bar-title">{title}</span>
    </div>
  );
}

function VibeWindow() {
  return (
    <div className="mw" aria-hidden="true">
      <WindowBar title="ADCode · habit-tracker" />
      <div className="mw-vibe">
        <aside className="mw-side">
          <span className="mw-new">＋ New conversation</span>
          <span className="mw-project"><b>habit-tracker</b><small>main · 3 changed</small></span>
          <span className="mw-nav is-active">Chat</span>
          <span className="mw-nav">Agents <em>2 working</em></span>
          <span className="mw-nav">Tools</span>
          <span className="mw-nav">Changes <em className="is-count">3</em></span>
          <span className="mw-nav">Preview</span>
          <span className="mw-label">Today</span>
          <span className="mw-convo is-active">Add streaks to habits</span>
          <span className="mw-convo">Dark mode toggle</span>
          <span className="mw-label">Yesterday</span>
          <span className="mw-convo">Sign in with GitHub</span>
          <span className="mw-foot"><span>Open IDE</span><span className="mw-earn">$0.36</span></span>
        </aside>
        <div className="mw-chat">
          <p className="mw-user">Add a streak counter to each habit, and a flame once it passes seven days.</p>
          <div className="mw-worked">
            <span className="mw-worked-head"><Mark size={16} /> Worked for 18s</span>
            <span className="mw-step"><i>✓</i> Read <code>src/habits.ts</code></span>
            <span className="mw-step"><i>✓</i> Edited <code>HabitCard.tsx</code> <small>+24 −3</small></span>
            <span className="mw-step"><i>✓</i> Ran <code>npm test</code> <small>12 passed</small></span>
          </div>
          <p className="mw-reply">Done. Every habit now shows its streak, and a flame appears after seven days in a row. Tests pass.</p>
          <div className="mw-undo"><span>3 files changed <small>+41 −6</small></span><b>Undo</b></div>
          <div className="mw-composer"><span>Describe what to build or change…</span><span className="mw-pill">Agent</span><span className="mw-send">↑</span></div>
        </div>
        <div className="mw-sponsor">
          <span className="mw-sponsor-tag">Sponsored</span>
          <b>Your ad here</b>
          <small>Half of what it earns is credited to you.</small>
        </div>
      </div>
    </div>
  );
}

const CODE = [
  <><span className="syntax-purple">export function</span> <span className="syntax-blue">HabitCard</span>({"{ habit }"}) {"{"}</>,
  <>  <span className="syntax-purple">const</span> streak = <span className="syntax-blue">currentStreak</span>(habit.days);</>,
  <>  <span className="syntax-purple">return</span> (</>,
  <>    {"<"}<span className="syntax-blue">Card</span> title={"{habit.name}"}{">"}</>,
  <>      {"<"}<span className="syntax-blue">Streak</span> days={"{streak}"} /{">"}</>,
  <>      {"{streak >= "}<span className="syntax-green">7</span>{" && <"}<span className="syntax-blue">Flame</span> /{">}"}</>,
  <>    {"</"}<span className="syntax-blue">Card</span>{">"}</>,
  <>  );</>,
  <>{"}"}</>,
];

function CodeWindow() {
  return (
    <div className="mw" aria-hidden="true">
      <WindowBar title="ADCode · habit-tracker — HabitCard.tsx" />
      <div className="mw-code">
        <aside className="mw-tree">
          <span className="mw-label">Explorer</span>
          <span>⌄ src</span>
          <span className="mw-indent">⌄ components</span>
          <span className="mw-indent2 is-active">HabitCard.tsx <em>M</em></span>
          <span className="mw-indent2">Streak.tsx <em>U</em></span>
          <span className="mw-indent">habits.ts</span>
          <span>package.json</span>
          <span className="mw-branch">⑂ main · 3 changes</span>
        </aside>
        <div className="mw-editor">
          <div className="mw-tabs"><span className="is-active">HabitCard.tsx</span><span>habits.ts</span><span className="mw-vibe-btn">✦ Vibe</span></div>
          <div className="mw-lines">
            {CODE.map((line, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} className={index === 4 || index === 5 ? "is-selected" : undefined}><span className="line-number">{index + 1}</span><code>{line}</code></div>
            ))}
          </div>
          <div className="mw-terminal"><span>Terminal</span><p><span className="syntax-green">❯</span> npm run dev</p><p><span className="syntax-green">✓</span> Ready on localhost:5173</p></div>
          <div className="mw-float">
            <span className="mw-float-head">Assistant <small>Ctrl+I</small></span>
            <span className="mw-chip">HabitCard.tsx · lines 5–6</span>
            <p>Make the flame pulse when the streak beats a personal best.</p>
            <span className="mw-float-actions"><i>Explain</i><i>Refactor</i><i>Write tests</i></span>
          </div>
        </div>
      </div>
      <div className="mw-status"><span>⑂ main · ✓ No problems</span><span>TypeScript · UTF-8</span></div>
    </div>
  );
}
