/**
 * Solo and Team: two areas of the same window.
 *
 * Solo is the window as it always was - your own conversations, on this machine. Team shows
 * only what belongs to the shared projects you are a member of: their sessions in the sidebar,
 * the selected session in the centre, and the people in it. Nothing private crosses over, and
 * switching back never reloads a streaming solo chat (the solo chat is hidden, not destroyed).
 *
 * The switch sits above the conversation list, where the question "whose chats am I looking
 * at?" is asked. Asked for 17 November 2026; the shared-project workspace it opens was finished
 * code with no door into it.
 */
import { User, Users } from "lucide";
import { createIcon } from "../workbench/icons.ts";

export type WorkArea = "solo" | "team";

export const WORK_AREA_KEY = "adcode.workArea";

export function parseWorkArea(value: string | null | undefined): WorkArea {
  return value === "team" ? "team" : "solo";
}

export function readWorkArea(): WorkArea {
  try { return parseWorkArea(localStorage.getItem(WORK_AREA_KEY)); } catch { return "solo"; }
}

export function storeWorkArea(area: WorkArea): void {
  try { localStorage.setItem(WORK_AREA_KEY, area); } catch { /* private mode: this session only */ }
}

export interface WorkAreaSwitch {
  readonly element: HTMLElement;
  set(area: WorkArea): void;
  current(): WorkArea;
}

const LABELS: Readonly<Record<WorkArea, { readonly label: string; readonly title: string }>> = {
  solo: { label: "Solo", title: "Solo - your own conversations on this machine" },
  team: { label: "Team", title: "Team - sessions of the shared projects you belong to" },
};

/** A two-way segmented switch; the thumb slides between the halves. Arrow keys move it too. */
export function createWorkAreaSwitch(onChange: (area: WorkArea) => void, initial: WorkArea = readWorkArea()): WorkAreaSwitch {
  const element = document.createElement("div");
  element.className = "work-area-switch";
  element.setAttribute("role", "radiogroup");
  element.setAttribute("aria-label", "Work area");
  const thumb = document.createElement("span");
  thumb.className = "work-area-thumb";
  thumb.setAttribute("aria-hidden", "true");
  element.append(thumb);
  let current: WorkArea = initial;
  const buttons = new Map<WorkArea, HTMLButtonElement>();
  for (const area of ["solo", "team"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "work-area-option";
    button.dataset["area"] = area;
    button.setAttribute("role", "radio");
    button.title = LABELS[area].title;
    const text = document.createElement("span");
    text.textContent = LABELS[area].label;
    button.append(createIcon(area === "solo" ? User : Users), text);
    button.addEventListener("click", () => choose(area, true));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next: WorkArea = current === "solo" ? "team" : "solo";
      choose(next, true);
      buttons.get(next)?.focus();
    });
    buttons.set(area, button);
    element.append(button);
  }
  function paint(): void {
    element.dataset["area"] = current;
    for (const [area, button] of buttons) {
      const on = area === current;
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on ? 0 : -1;
    }
  }
  function choose(area: WorkArea, announce: boolean): void {
    if (area === current && announce) return;
    current = area;
    paint();
    if (announce) { storeWorkArea(area); onChange(area); }
  }
  paint();
  return { element, set: (area) => choose(area, false), current: () => current };
}
