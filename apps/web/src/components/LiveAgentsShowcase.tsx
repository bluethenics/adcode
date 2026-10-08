"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEMO_CODE,
  DEMO_MS,
  DEMO_PHASES,
  DEMO_README,
  DEMO_TEST_LINES,
  demoFrame,
  demoRestFrame,
  type DemoAgent,
  type DemoFrame,
  type DemoProof,
  type DemoStatus,
} from "@/lib/liveDemo";
import "./liveAgentsShowcase.css";

/**
 * "Your agents, working as one." - the desktop app's live agent view, drawn for the homepage.
 *
 * Three agents on one task: their mascots on a strip, a live window each. The story is a pure
 * timeline (`lib/liveDemo.ts`); this only draws its frames. It plays while it is on screen and
 * stops when it is not. Without JavaScript, and for anyone who asked for less motion, it shows
 * the finished story as one still frame. The four points beside it follow the stage, and
 * clicking one jumps the stage there.
 */

const AGENTS: readonly { readonly id: DemoAgent; readonly name: string; readonly model: string; readonly shape: keyof typeof BODIES; readonly tone: string }[] = [
  { id: "build", name: "Build", model: "Gemini", shape: "drop", tone: "amber" },
  { id: "tests", name: "Tests", model: "Ollama · on your PC", shape: "circle", tone: "blue" },
  { id: "docs", name: "Docs", model: "Claude", shape: "hexagon", tone: "violet" },
];

/** The desktop app's own mascot bodies (agentMascot.ts), on its 48-unit grid. */
const BODIES = {
  circle: "M24 5a19 19 0 1 1 0 38a19 19 0 1 1 0-38z",
  drop: "M24 4c6 8 17 15.5 17 25a17 17 0 0 1-34 0c0-9.5 11-17 17-25z",
  hexagon: "M21 5.2a6 6 0 0 1 6 0l12 7a6 6 0 0 1 3 5.2v13.2a6 6 0 0 1-3 5.2l-12 7a6 6 0 0 1-6 0l-12-7a6 6 0 0 1-3-5.2V17.4a6 6 0 0 1 3-5.2z",
} as const;

function Mascot({ shape, tone, status, gaze }: { shape: keyof typeof BODIES; tone: string; status: DemoStatus; gaze: "left" | "right" | null }) {
  return (
    <span className="demo-mascot" data-tone={tone} data-status={status} data-gaze={gaze ?? undefined}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path className="demo-mascot-body" d={BODIES[shape]} />
        <g className="demo-mascot-face">
          {status === "waiting" ? (
            <>
              <path d="M15.5 25.5q3 2.2 6 0" />
              <path d="M26.5 25.5q3 2.2 6 0" />
            </>
          ) : (
            <>
              <circle cx="18.5" cy="22.5" r="2.4" />
              <circle cx="29.5" cy="22.5" r="2.4" />
            </>
          )}
          <path d={status === "done" ? "M18 29.5q6 6 12 0" : "M21 31.5h6"} />
        </g>
      </svg>
    </span>
  );
}

const STATUS_TEXT: Readonly<Record<DemoStatus, string>> = { waiting: "Waiting", working: "Live", done: "Done" };

function Window({ name, model, status, proof, file, children }: { name: string; model: string; status: DemoStatus; proof: DemoProof; file: string; children: ReactNode }) {
  return (
    <div className="demo-window" data-status={status}>
      <div className="demo-window-bar">
        <span className="window-dots"><i /><i /><i /></span>
        <b>{name}</b>
        <span className="demo-window-model">{model}</span>
        <span className="demo-window-status" data-status={status}>{STATUS_TEXT[status]}</span>
      </div>
      <div className="demo-window-tab">{file}</div>
      <div className="demo-window-body">{children}</div>
      <div className="demo-window-foot">
        <span className="demo-proof" data-proof={proof}>{proof === "passed" ? "Checks passed" : "Unverified"}</span>
      </div>
    </div>
  );
}

function TypedCode({ typed, working }: { typed: number; working: boolean }) {
  const parts: ReactNode[] = [];
  let left = typed;
  for (const [index, [text, tone]] of DEMO_CODE.entries()) {
    if (left <= 0) break;
    const shown = text.slice(0, left);
    left -= shown.length;
    parts.push(tone === "plain" ? shown : <span key={index} className={`demo-tone-${tone}`}>{shown}</span>);
  }
  return <pre className="demo-code">{parts}{working ? <span className="demo-caret" /> : null}</pre>;
}

function Strip({ frame }: { frame: DemoFrame }) {
  const index = (id: DemoAgent) => AGENTS.findIndex((agent) => agent.id === id);
  const bubble = frame.bubble;
  const gazeOf = (id: DemoAgent): "left" | "right" | null => {
    if (bubble === null) return null;
    if (id === bubble.from) return index(bubble.to) > index(id) ? "right" : "left";
    if (id === bubble.to) return index(bubble.from) > index(id) ? "right" : "left";
    return null;
  };
  // The bubble rides an arc from the sender's column to the receiver's.
  const from = index(bubble?.from ?? "build");
  const to = index(bubble?.to ?? "build");
  const column = (from + (to - from) * (bubble?.progress ?? 0) + 0.5) / AGENTS.length;
  const lift = Math.sin(Math.PI * (bubble?.progress ?? 0)) * 16;
  return (
    <div className="demo-strip">
      {AGENTS.map((agent) => {
        const status = frame[agent.id].status;
        return (
          <span key={agent.id} className="demo-member" data-status={status}>
            <Mascot shape={agent.shape} tone={agent.tone} status={status} gaze={gazeOf(agent.id)} />
            <span>{agent.name}</span>
          </span>
        );
      })}
      {bubble !== null ? (
        <span className="demo-bubble" style={{ left: `${(column * 100).toFixed(2)}%`, transform: `translate(-50%, ${(-lift).toFixed(1)}px)` }}>
          {bubble.text}
        </span>
      ) : null}
    </div>
  );
}

export function LiveAgentsShowcase() {
  const [frame, setFrame] = useState<DemoFrame>(() => demoRestFrame());
  const [moving, setMoving] = useState(false);
  const stage = useRef<HTMLElement | null>(null);
  const elapsed = useRef(0);

  useEffect(() => {
    const element = stage.current;
    if (element === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = 0;
    let visible = false;
    let painted = 0;
    const tick = (now: number) => {
      elapsed.current = (elapsed.current + (last === 0 ? 0 : now - last)) % DEMO_MS;
      last = now;
      // About thirty frames a second is plenty for typing, and half the work of sixty.
      if (now - painted >= 32) {
        painted = now;
        setFrame(demoFrame(elapsed.current));
      }
      if (visible) raf = window.requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      window.cancelAnimationFrame(raf);
      last = 0;
      if (visible) {
        setMoving(true);
        raf = window.requestAnimationFrame(tick);
      }
    }, { threshold: 0.2 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, []);

  const jump = (phase: number) => {
    const point = DEMO_PHASES[phase]!;
    const next = DEMO_PHASES[phase + 1]?.at ?? DEMO_MS;
    // Moving: start the stage at that point. Still: show that point finished.
    elapsed.current = moving ? point.at + 1 : next - 1;
    setFrame(demoFrame(elapsed.current));
  };

  const working = AGENTS.filter((agent) => frame[agent.id].status === "working").length;
  const readme = DEMO_README.slice(0, frame.docs.typed);
  return (
    <section className="agents-tour marketplace-wrap" id="agents" aria-labelledby="agents-heading">
      <div className="agents-tour-copy">
        <p className="marketplace-eyebrow"><span /> Agents at work</p>
        <h2 id="agents-heading">Your agents,<br /><span>working as one.</span></h2>
        <p className="agents-tour-lead">The chat&apos;s assistant, a team of agents, or the coding CLIs you already pay for - every one gets a live window, and you watch the work happen.</p>
        <ol className="agents-tour-points">
          {DEMO_PHASES.map((point, index) => (
            <li key={point.title}>
              <button type="button" aria-pressed={frame.phase === index} onClick={() => jump(index)}>
                <span className="agents-tour-index">{String(index + 1).padStart(2, "0")} / {String(DEMO_PHASES.length).padStart(2, "0")}</span>
                <strong>{point.title}</strong>
                <small>{point.body}</small>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <figure
        className="agents-stage"
        ref={stage}
        data-phase={frame.phase}
        aria-label="Illustration of ADCode's live agent view: three agents named Build, Tests and Docs, each in its own live window. Build writes greet.ts and messages its teammates, Tests runs the suite until it passes, Docs writes the README, and their shared project memory records the decision."
      >
        <div className="mw demo-room" aria-hidden="true">
          <div className="mw-bar"><span className="window-dots"><i /><i /><i /></span><span className="mw-bar-title">ADCode · greet</span></div>
          <div className="demo-room-head">
            <span className="demo-pulse" data-live={working > 0} />
            <b>Live agents</b>
            <span>{working > 0 ? `${working} working` : "All finished"}</span>
          </div>
          <Strip frame={frame} />
          <p className="demo-log">{frame.log ?? "Messages between agents appear here."}</p>
          <div className="demo-grid">
            <Window name="Build" model={AGENTS[0]!.model} status={frame.build.status} proof={frame.build.proof} file="greet.ts">
              <TypedCode typed={frame.build.typed} working={frame.build.status === "working"} />
            </Window>
            <Window name="Tests" model={AGENTS[1]!.model} status={frame.tests.status} proof={frame.tests.proof} file="terminal">
              <pre className="demo-terminal">{frame.tests.status === "waiting" ? "Waiting for Build" : DEMO_TEST_LINES.slice(0, Math.max(1, frame.tests.lines)).join("\n")}</pre>
            </Window>
            <Window name="Docs" model={AGENTS[2]!.model} status={frame.docs.status} proof={frame.docs.proof} file="README.md">
              <pre className="demo-code demo-readme">{frame.docs.status === "waiting" ? "Waiting for Build" : readme}{frame.docs.status === "working" ? <span className="demo-caret" /> : null}</pre>
            </Window>
          </div>
          <div className="demo-memory" data-shown={frame.memory}>
            <b>Project memory</b>
            <span className="demo-memory-row"><em>decision</em> greet() falls back to &quot;friend&quot; for an empty name</span>
            <span className="demo-memory-agents"><i>Build</i><i>Tests</i><i>Docs</i><i>Claude Code · MCP</i></span>
          </div>
        </div>
      </figure>
    </section>
  );
}
