/**
 * Two cards that show the agent's work as it happens: its plan, and what it saw.
 *
 * Presentation only, like `chatActivity.ts`: the chat widget feeds them tool calls and
 * results; these own the markup. Both are one card per turn, updated in place - a plan that
 * is re-sent after every step, or a page checked five times, must not stack five cards.
 */

export type PlanStatus = "pending" | "in_progress" | "done";

export interface PlanStepView {
  readonly step: string;
  readonly status: PlanStatus;
}

/** `update_plan` input as steps, dropping anything malformed. Empty means "not a plan". */
export function planStepsFrom(input: unknown): PlanStepView[] {
  if (typeof input !== "object" || input === null) return [];
  const steps = (input as Record<string, unknown>)["steps"];
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 12).flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const record = raw as Record<string, unknown>;
    const step = typeof record["step"] === "string" ? record["step"].trim().slice(0, 200) : "";
    const status = record["status"];
    if (step.length === 0 || (status !== "pending" && status !== "in_progress" && status !== "done")) return [];
    return [{ step, status }];
  });
}

/** "2 of 5 done" - the card's summary, and the step being worked on when there is one. */
export function planSummary(steps: readonly PlanStepView[]): string {
  const done = steps.filter((step) => step.status === "done").length;
  if (done === steps.length) return `All ${steps.length} steps done`;
  const current = steps.find((step) => step.status === "in_progress");
  return current === undefined ? `${done} of ${steps.length} done` : `${done} of ${steps.length} done · ${current.step}`;
}

export interface PlanCard {
  readonly element: HTMLElement;
  update(steps: readonly PlanStepView[]): void;
}

export function createPlanCard(): PlanCard {
  const element = document.createElement("section");
  element.className = "chat-plan";
  element.setAttribute("aria-label", "The assistant's plan");
  const heading = document.createElement("div");
  heading.className = "chat-plan-heading";
  const title = document.createElement("strong");
  title.textContent = "Plan";
  const summary = document.createElement("span");
  summary.className = "chat-plan-summary";
  summary.setAttribute("role", "status");
  heading.append(title, summary);
  const list = document.createElement("ol");
  list.className = "chat-plan-steps";
  element.append(heading, list);

  return {
    element,
    update(steps) {
      summary.textContent = planSummary(steps);
      element.dataset["complete"] = String(steps.every((step) => step.status === "done"));
      list.replaceChildren(...steps.map((step) => {
        const item = document.createElement("li");
        item.className = "chat-plan-step";
        item.dataset["status"] = step.status;
        const mark = document.createElement("span");
        mark.className = "chat-plan-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = step.status === "done" ? "✓" : "";
        const text = document.createElement("span");
        text.className = "chat-plan-text";
        text.textContent = step.step;
        item.append(mark, text);
        item.setAttribute("aria-label", `${step.step}: ${step.status === "done" ? "done" : step.status === "in_progress" ? "in progress" : "to do"}`);
        return item;
      }));
    },
  };
}

/** What a `view_page` report says, in a line: the page, and whether it found problems. */
export function pageViewCaption(report: string): { readonly page: string; readonly problems: number; readonly url: string | null } {
  const lines = report.split("\n");
  const first = lines[0] ?? "";
  const url = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\S*)$/.exec(first)?.[1] ?? null;
  const start = lines.indexOf("Problems:");
  let problems = 0;
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith("- ")) break;
      if (!line.startsWith("- None found")) problems += 1;
    }
  }
  return { page: first.replace(/ - https?:\/\/\S+$/, "").trim() || "Your app", problems, url };
}

export interface AgentViewCard {
  readonly element: HTMLElement;
  update(view: { readonly image: string; readonly report: string }): void;
}

/**
 * The agent's own view of the running app: the latest screenshot it took, what page it was,
 * and how many problems it found. The proof behind "I checked, it works".
 */
export function createAgentViewCard(onOpen: (url: string) => void): AgentViewCard {
  const element = document.createElement("figure");
  element.className = "chat-agent-view";
  const media = document.createElement("button");
  media.type = "button";
  media.className = "chat-agent-view-media";
  const image = document.createElement("img");
  image.className = "chat-agent-view-image";
  image.alt = "What the assistant saw";
  media.append(image);
  const caption = document.createElement("figcaption");
  caption.className = "chat-agent-view-caption";
  const label = document.createElement("span");
  label.className = "chat-agent-view-label";
  label.textContent = "What the assistant saw";
  const page = document.createElement("span");
  page.className = "chat-agent-view-page";
  const verdict = document.createElement("span");
  verdict.className = "chat-agent-view-verdict";
  caption.append(label, page, verdict);
  element.append(media, caption);
  let url: string | null = null;
  media.addEventListener("click", () => {
    if (url !== null) onOpen(url);
  });

  return {
    element,
    update(view) {
      // Only an image the main process produced: a JPEG or PNG data URL, never a link.
      if (!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(view.image)) return;
      const described = pageViewCaption(view.report);
      url = described.url;
      image.src = view.image;
      page.textContent = described.page;
      page.title = described.url ?? "";
      verdict.textContent = described.problems === 0 ? "No problems found" : `${described.problems} problem${described.problems === 1 ? "" : "s"} found`;
      verdict.dataset["tone"] = described.problems === 0 ? "ok" : "warn";
      media.title = url === null ? "" : "Open this page in the preview";
      media.disabled = url === null;
    },
  };
}
