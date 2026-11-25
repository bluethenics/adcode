/**
 * Ideas that build into something the preview shows straight away.
 *
 * One list, read by the welcome sheet (`onboardingSheet.ts`) and by the web version's sign-in
 * screen (`web/gate.ts`), so the first thing somebody types is the same idea in both places.
 * Kept free of imports: the sign-in screen loads it before the rest of the app.
 */
export interface StarterIdea {
  readonly label: string;
  readonly prompt: string;
}

export const STARTER_IDEAS: readonly StarterIdea[] = [
  { label: "Landing page", prompt: "A landing page for my small business, with a hero section, services, testimonials and a contact form." },
  { label: "Portfolio", prompt: "A personal portfolio site with an about section, my projects and a way to contact me." },
  { label: "To-do app", prompt: "A to-do app where I can add, tick off and delete tasks, saved in the browser." },
  { label: "Snake game", prompt: "A snake game in the browser with a score, a high score and a restart button." },
  { label: "Budget tracker", prompt: "A budget tracker where I add income and expenses and see my balance and a chart by category." },
  { label: "Quiz", prompt: "A quiz app with ten multiple-choice questions, a progress bar and a score at the end." },
];

/*
 * The idea typed on the web version's sign-in screen, carried across the sign-in.
 *
 * Session storage, so it survives a provider's redirect in this tab and nothing else: another
 * tab, or tomorrow, does not start building something the person typed once and walked away
 * from. Taken (read and removed) exactly once, by the app, as it opens.
 */
const GATE_IDEA_KEY = "adcode.web.gateIdea";
/** Long enough for a paragraph; a pasted essay is cut rather than refused. */
export const GATE_IDEA_MAX = 2_000;

export function saveGateIdea(idea: string): void {
  const text = idea.trim().slice(0, GATE_IDEA_MAX);
  try {
    if (text.length === 0) sessionStorage.removeItem(GATE_IDEA_KEY);
    else sessionStorage.setItem(GATE_IDEA_KEY, text);
  } catch {
    /* No storage (private mode): the idea is lost, and the empty chat asks again. */
  }
}

/** The kept idea without taking it: the sign-in screen refills its box after a reload. */
export function peekGateIdea(): string | null {
  try {
    return sessionStorage.getItem(GATE_IDEA_KEY);
  } catch {
    return null;
  }
}

export function takeGateIdea(): string | null {
  try {
    const text = sessionStorage.getItem(GATE_IDEA_KEY);
    sessionStorage.removeItem(GATE_IDEA_KEY);
    const idea = text?.trim() ?? "";
    return idea.length === 0 ? null : idea;
  } catch {
    return null;
  }
}
