/**
 * ADCode Remote: the phone page of Phone link (web.bluethenics.com/phone).
 *
 * Sign in with the ADCode account, pick one of your computers that has Phone link on, and chat
 * with the assistant running there. The computer does all the work; this page sends words and
 * draws what comes back (`shared/phoneProtocol.ts`). When the computer is off, asleep or out of
 * battery, there is nobody to talk to, and the page says exactly that.
 *
 * No framework: four screens, each built from DOM nodes, pushed and popped with a slide. The
 * conversation is updated in place - a streamed reply grows its last bubble - so a long answer
 * never rebuilds the list it is part of.
 */
import "../renderer/styles/adcodeMascot.css";
import "./phone.css";
import type { User } from "firebase/auth";
import { createAdcodeMascot, type AdcodeMascot, type AdcodeMascotMood } from "../renderer/mascot/adcodeMascot.ts";
import { currentUser, firebaseConfigured, idToken, onUserChanged, resetPassword, signInWith, signInWithEmail, signOutHere } from "../web/firebaseAuth.ts";
import {
  MAX_PHONE_TEXT,
  PHONE_PROTOCOL,
  applyPhoneEvent,
  describeUserAgent,
  pairedComputerFrom,
  timelineFromChat,
  withUserMessage,
  type HostMessage,
  type PhoneChatSummary,
  type PhoneDevice,
  type PhoneModels,
  type PhonePowerState,
  type PhoneRequest,
  type PhoneTimeline,
  type PhoneTimelineItem,
  type PowerActionName,
} from "../shared/phoneProtocol.ts";
import { renderMarkdown } from "./markdown.ts";

declare const __ADCODE_RELAY__: string;
declare const __ADCODE_WEB_DEV__: boolean;

/** Development only: `?demo` talks to a pretend computer (demoHost.ts) instead of the relay. */
const DEMO = __ADCODE_WEB_DEV__ && new URLSearchParams(location.search).has("demo");

/* ── Small helpers ───────────────────────────────────────────────────────── */

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tap(label: string, className: string, run: () => void): HTMLButtonElement {
  const node = h("button", className, label);
  node.type = "button";
  node.addEventListener("click", run);
  return node;
}

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
} as const;

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return template.content.firstElementChild as SVGSVGElement;
}

function iconButton(name: keyof typeof ICONS, label: string, className: string, run: () => void): HTMLButtonElement {
  const node = tap("", `icon-btn ${className}`, run);
  node.setAttribute("aria-label", label);
  node.title = label;
  node.append(icon(name));
  return node;
}

const ago = (time: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const remember = {
  get(key: string): string | null { try { return localStorage.getItem(`adcode.phone.${key}`); } catch { return null; } },
  set(key: string, value: string | null): void {
    try { if (value === null) localStorage.removeItem(`adcode.phone.${key}`); else localStorage.setItem(`adcode.phone.${key}`, value); } catch { /* Private mode: it just is not remembered. */ }
  },
};

const buzz = (pattern: number | number[]): void => { try { navigator.vibrate?.(pattern); } catch { /* No vibration here. */ } };

/* ── State ───────────────────────────────────────────────────────────────── */

interface HostInfo { readonly id: string; readonly name: string; readonly platform: string; readonly since: number }
type View = "loading" | "signin" | "computers" | "chats" | "chat";

/*
 * Scanned from a computer's Phone link QR code: that computer is the one to open, so the
 * phone goes from sign-in straight to its chats. The id leaves the address bar at once, so a
 * home-screen shortcut saved later opens the plain page.
 */
const pairedComputer = pairedComputerFrom(location.search);
if (pairedComputer !== null) {
  remember.set("host", pairedComputer);
  const clean = new URL(location.href);
  clean.searchParams.delete("pc");
  history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
}

const state: {
  user: User | null;
  link: "idle" | "connecting" | "open" | "closed";
  linkNote: string;
  hosts: HostInfo[];
  hostId: string | null;
  device: PhoneDevice | null;
  chats: PhoneChatSummary[];
  power: PhonePowerState | null;
  models: PhoneModels | null;
  sessionId: string | null;
  title: string;
  timeline: PhoneTimeline | null;
  view: View;
  pending: Map<string, string>;
} = {
  user: null,
  link: "idle",
  linkNote: "",
  hosts: [],
  hostId: pairedComputer ?? remember.get("host"),
  device: null,
  chats: [],
  power: null,
  models: null,
  sessionId: null,
  title: "",
  timeline: null,
  view: "loading",
  pending: new Map(),
};

const app = document.getElementById("app")!;
let screen: HTMLElement | null = null;
let teardown: (() => void)[] = [];

/* ── Screens and transitions ─────────────────────────────────────────────── */

const ORDER: Record<View, number> = { loading: 0, signin: 1, computers: 2, chats: 3, chat: 4 };

function show(view: View, build: () => HTMLElement): void {
  const from = state.view;
  state.view = view;
  for (const undo of teardown) undo();
  teardown = [];
  const next = build();
  next.classList.add("screen");
  const direction = ORDER[view] >= ORDER[from] ? "forward" : "back";
  const leaving = screen;
  screen = next;
  if (leaving === null || from === "loading") {
    app.replaceChildren(next);
    next.dataset["enter"] = "fade";
    return;
  }
  next.dataset["enter"] = direction;
  leaving.dataset["leave"] = direction;
  leaving.setAttribute("aria-hidden", "true");
  leaving.inert = true;
  app.append(next);
  const done = (): void => leaving.remove();
  leaving.addEventListener("animationend", done, { once: true });
  window.setTimeout(done, 450);
}

function mascot(mood: AdcodeMascotMood, size: number, interactive = true): AdcodeMascot {
  const buck = createAdcodeMascot({ mood, size, interactive, label: "Buck. Tap for a reaction." });
  teardown.push(() => buck.destroy());
  return buck;
}

/* ── Toasts ──────────────────────────────────────────────────────────────── */

const toasts = h("div", "toasts");
toasts.setAttribute("role", "status");
document.body.append(toasts);

function toast(text: string, tone: "info" | "ok" | "warn" = "info"): void {
  const node = h("div", `toast toast-${tone}`, text);
  toasts.append(node);
  window.setTimeout(() => { node.dataset["leave"] = "true"; window.setTimeout(() => node.remove(), 260); }, 3200);
}

/* ── The relay connection ────────────────────────────────────────────────── */

let socket: WebSocket | null = null;
let retry: number | null = null;
let attempts = 0;
let heartbeat: number | null = null;
let helloSentTo: string | null = null;

function relayUrl(): string {
  const label = describeUserAgent(navigator.userAgent);
  return `${__ADCODE_RELAY__.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/phone/phone?name=${encodeURIComponent(label)}`;
}

async function connect(forceToken = false): Promise<void> {
  if (state.user === null || socket !== null) return;
  state.link = "connecting";
  paintLink();
  const token = DEMO ? "demo" : await idToken(forceToken).catch(() => null);
  if (token === null) { state.link = "closed"; state.linkNote = "Sign in again to continue."; paintLink(); return; }
  const next = DEMO
    ? (new (await import("./demoHost.ts")).DemoSocket() as unknown as WebSocket)
    : new WebSocket(relayUrl(), [PHONE_PROTOCOL, `auth.${token}`]);
  socket = next;
  next.addEventListener("open", () => {
    attempts = 0;
    state.link = "open";
    state.linkNote = "";
    paintLink();
    heartbeat = window.setInterval(() => { if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ type: "ping" })); }, 25_000);
  });
  next.addEventListener("message", (event) => {
    let frame: { type?: unknown; hosts?: unknown; host?: unknown; data?: unknown };
    try { frame = JSON.parse(String(event.data)) as typeof frame; } catch { return; }
    if (frame.type === "hosts" && Array.isArray(frame.hosts)) { onHosts(frame.hosts as HostInfo[]); return; }
    if (frame.type === "gone") { onHosts(state.hosts.filter((host) => host.id !== frame.host)); return; }
    if (frame.type === "from" && frame.host === state.hostId && typeof frame.data === "string") {
      try { onHost(JSON.parse(frame.data) as HostMessage); } catch { /* A message this page cannot read is skipped. */ }
    }
  });
  next.addEventListener("close", (event) => {
    if (socket !== next) return;
    socket = null;
    helloSentTo = null;
    if (heartbeat !== null) window.clearInterval(heartbeat);
    heartbeat = null;
    state.link = "closed";
    if (event.code === 4401) { state.linkNote = "Refreshing your sign-in…"; paintLink(); void connect(true); return; }
    if (event.code === 4403) { state.linkNote = "Your computer disconnected this phone."; paintLink(); return; }
    state.linkNote = navigator.onLine ? "Reconnecting…" : "You're offline. Reconnecting when you're back.";
    paintLink();
    const wait = [800, 2_000, 5_000, 10_000, 20_000][Math.min(attempts++, 4)]!;
    if (retry !== null) window.clearTimeout(retry);
    retry = window.setTimeout(() => { retry = null; void connect(); }, wait);
  });
}

function disconnect(): void {
  const old = socket;
  socket = null;
  if (retry !== null) window.clearTimeout(retry);
  retry = null;
  if (heartbeat !== null) window.clearInterval(heartbeat);
  heartbeat = null;
  old?.close(1000, "Signed out");
}

function send(request: PhoneRequest): boolean {
  if (socket === null || socket.readyState !== WebSocket.OPEN || state.hostId === null) return false;
  socket.send(JSON.stringify({ type: "to", host: state.hostId, data: JSON.stringify(request) }));
  return true;
}

function onHosts(hosts: HostInfo[]): void {
  state.hosts = hosts.filter((host) => typeof host?.id === "string").map((host) => ({ id: host.id, name: String(host.name ?? "Computer"), platform: String(host.platform ?? ""), since: Number(host.since) || Date.now() }));
  const chosen = state.hosts.find((host) => host.id === state.hostId);
  if (chosen !== undefined) {
    if (helloSentTo !== chosen.id) { helloSentTo = chosen.id; send({ t: "hello" }); if (state.view === "chat" && state.sessionId !== null) send({ t: "open", sessionId: state.sessionId }); }
  } else {
    helloSentTo = null;
    if (state.hostId !== null && (state.view === "chats" || state.view === "chat")) paintOffline(true);
  }
  if (state.view === "computers") showComputers();
  if (chosen !== undefined) paintOffline(false);
}

function chooseHost(id: string): void {
  state.hostId = id;
  remember.set("host", id);
  state.device = null;
  state.chats = [];
  helloSentTo = id;
  send({ t: "hello" });
  showChats();
}

/* ── What the computer says ──────────────────────────────────────────────── */

function onHost(message: HostMessage): void {
  switch (message.t) {
    case "hello":
      state.device = message.device;
      state.chats = [...message.chats];
      state.power = message.power;
      if (state.view === "chats") paintChats();
      paintPower();
      send({ t: "models" });
      return;
    case "chats":
      state.chats = [...message.chats];
      if (state.view === "chats") paintChats();
      return;
    case "chat":
      if (message.sessionId !== state.sessionId) return;
      state.title = message.title;
      state.timeline = timelineFromChat(message.messages, message.running, message.live);
      paintChatHeader();
      paintTimeline(true);
      return;
    case "sent": {
      const was = state.pending.get(message.nonce);
      state.pending.delete(message.nonce);
      if (was === "new" && state.view === "chat" && state.sessionId === null) state.sessionId = message.sessionId;
      if (state.timeline !== null) { state.timeline = { ...state.timeline, activity: "Working…" }; paintActivity(); }
      return;
    }
    case "event": {
      const chat = state.chats.find((one) => one.id === message.sessionId);
      if (message.event.k === "ended") {
        if (chat !== undefined) state.chats = state.chats.map((one) => (one.id === message.sessionId ? { ...one, running: false, updatedAt: Date.now() } : one));
        if (message.sessionId !== state.sessionId) {
          if (message.event.ended === "finished") toast(`“${chat?.title ?? "A chat"}” finished`, "ok");
          buzz(40);
        }
      } else if (chat !== undefined && !chat.running) {
        state.chats = state.chats.map((one) => (one.id === message.sessionId ? { ...one, running: true } : one));
      }
      if (state.view === "chats") paintChats();
      if (message.sessionId !== state.sessionId || state.timeline === null) return;
      state.timeline = applyPhoneEvent(state.timeline, message.event);
      if (message.event.k === "ended") {
        buzz(message.event.ended === "finished" ? [30, 60, 30] : 80);
        headerBuck?.play(message.event.ended === "finished" ? "celebrating" : message.event.ended === "failed" ? "error" : "idle", 1600);
      }
      scheduleTimeline();
      return;
    }
    case "power":
      state.power = message.power;
      paintPower();
      return;
    case "models":
      state.models = message.models;
      if (state.device !== null) state.device = { ...state.device, model: currentModelName() ?? state.device.model };
      paintModels();
      if (state.view === "chats") paintChats();
      return;
    case "error":
      if (message.nonce !== undefined) state.pending.delete(message.nonce);
      toast(message.message, "warn");
      if (state.timeline !== null && message.nonce !== undefined) { state.timeline = { ...state.timeline, running: false, activity: "" }; scheduleTimeline(); }
      return;
  }
}

/* ── Live bits painted into whichever screen is up ───────────────────────── */

let linkBadge: HTMLElement | null = null;
let offlineBanner: HTMLElement | null = null;
let powerSlot: HTMLElement | null = null;
let modelSlot: HTMLElement | null = null;
let chatList: HTMLElement | null = null;
let headerBuck: AdcodeMascot | null = null;
let headerTitle: HTMLElement | null = null;
let headerSub: HTMLElement | null = null;
let timelineList: HTMLElement | null = null;
let activityLine: HTMLElement | null = null;
let composerButton: HTMLButtonElement | null = null;
let rendered: PhoneTimelineItem[] = [];

function paintLink(): void {
  if (linkBadge === null) return;
  linkBadge.dataset["state"] = state.link;
  linkBadge.textContent = state.link === "open" ? "Connected" : state.link === "connecting" ? "Connecting…" : state.linkNote || "Offline";
}

function paintOffline(offline: boolean): void {
  if (offlineBanner === null) return;
  offlineBanner.hidden = !offline;
  headerBuck?.setMood(offline ? "sleeping" : moodFor(state.timeline));
  if (composerButton !== null) composerButton.disabled = offline;
}

function linkPill(): HTMLElement {
  linkBadge = h("span", "link-pill");
  teardown.push(() => { linkBadge = null; });
  paintLink();
  return linkBadge;
}

function offlineNotice(): HTMLElement {
  const box = h("div", "offline");
  box.hidden = true;
  box.append(h("strong", "", "Your computer is offline"), h("span", "", "It may be asleep, shut down or out of battery. Phone link needs ADCode running on it with Phone link on - it can't be woken from here."));
  offlineBanner = box;
  teardown.push(() => { offlineBanner = null; });
  return box;
}

/* ── Sign in ─────────────────────────────────────────────────────────────── */

function showSignIn(): void {
  show("signin", () => {
    const page = h("section", "signin");
    const buck = mascot("greeting", 112);
    const hero = h("div", "signin-hero");
    hero.append(buck.element);
    const title = h("h1", "", "Your computer, in your pocket");
    const lead = h("p", "lead", "Chat with ADCode on your own computer from your phone. It does the work with your projects and tools; you follow along and keep it going from anywhere.");
    const providers = h("div", "signin-buttons");
    const error = h("p", "form-error");
    error.setAttribute("role", "alert");
    const busy = (on: boolean): void => { for (const button of page.querySelectorAll("button")) button.disabled = on; page.dataset["busy"] = on ? "true" : "false"; };
    const attempt = (run: () => Promise<unknown>): void => {
      error.textContent = "";
      busy(true);
      buck.setMood("connecting");
      void run().catch((reason: unknown) => {
        error.textContent = reason instanceof Error ? reason.message.replace(/^Firebase: /, "") : "That didn't work. Try again.";
        buck.play("error", 1200);
        buck.setMood("greeting");
      }).finally(() => busy(false));
    };
    providers.append(
      tap("Continue with Google", "btn btn-primary", () => attempt(() => signInWith("google"))),
      tap("Continue with GitHub", "btn", () => attempt(() => signInWith("github"))),
    );
    const form = h("form", "email-form");
    const email = h("input", "field");
    email.type = "email"; email.placeholder = "Email"; email.autocomplete = "email"; email.required = true; email.inputMode = "email";
    const password = h("input", "field");
    password.type = "password"; password.placeholder = "Password"; password.autocomplete = "current-password"; password.required = true;
    password.addEventListener("focus", () => buck.setMood("listening"));
    password.addEventListener("blur", () => buck.setMood("greeting"));
    const submit = h("button", "btn", "Sign in with email");
    submit.type = "submit";
    const forgot = tap("Forgot password?", "link-btn", () => {
      if (email.value.trim() === "") { error.textContent = "Type your email first."; email.focus(); return; }
      attempt(async () => { await resetPassword(email.value.trim()); toast("Check your email for a reset link.", "ok"); });
    });
    form.append(email, password, submit, forgot);
    form.addEventListener("submit", (event) => { event.preventDefault(); attempt(() => signInWithEmail(email.value.trim(), password.value, false)); });
    const details = h("details", "email-details");
    details.append(h("summary", "", "Use email instead"), form);
    const fine = h("p", "fine", "Use the same account you're signed in with in ADCode on your computer. Your computer must have Phone link turned on.");
    page.append(hero, title, lead, providers, details, error, fine);
    if (!firebaseConfigured()) { error.textContent = "Sign-in isn't set up on this build."; busy(true); }
    return page;
  });
}

/* ── Computers ───────────────────────────────────────────────────────────── */

let installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as Event & { prompt(): Promise<void> };
  document.body.dataset["installable"] = "true";
});
const standalone = (): boolean => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent);

function installButton(): HTMLElement | null {
  if (standalone()) return null;
  if (installPrompt === null && !isIos()) return null;
  return iconButton("download", "Install the app", "install-btn", () => {
    if (installPrompt !== null) {
      void installPrompt.prompt().then(() => { installPrompt = null; delete document.body.dataset["installable"]; });
      return;
    }
    toast("Tap Share, then Add to Home Screen.");
  });
}

function showComputers(): void {
  const rebuild = state.view === "computers";
  const build = (): HTMLElement => {
    const page = h("section", "computers");
    const bar = h("header", "bar");
    const titles = h("div", "bar-titles");
    titles.append(h("h1", "", "Your computers"), linkPill());
    const actions = h("div", "bar-actions");
    const install = installButton();
    if (install !== null) actions.append(install);
    actions.append(iconButton("out", "Sign out", "", () => void signOutHere()));
    bar.append(titles, actions);
    const list = h("div", "cards");
    if (state.hosts.length === 0) {
      const empty = h("div", "empty");
      const buck = mascot(state.link === "open" ? "sleeping" : "connecting", 96);
      empty.append(buck.element, h("h2", "", state.link === "open" ? "No computer is online" : "Looking for your computers…"));
      if (state.link === "open") {
        const steps = h("ol", "steps");
        for (const text of ["Open ADCode on your computer and sign in with this account.", "Run Phone Link: Chat From Your Phone, and turn it on.", "It appears here by itself - keep this page open."]) steps.append(h("li", "", text));
        empty.append(steps);
      }
      list.append(empty);
    }
    state.hosts.forEach((host, index) => {
      const card = tap("", "card computer", () => chooseHost(host.id));
      card.style.setProperty("--i", String(index));
      const glyph = h("span", "card-icon");
      glyph.append(icon("computer"));
      const copy = h("span", "card-copy");
      copy.append(h("strong", "", host.name), h("small", "", `${host.platform === "darwin" ? "Mac" : host.platform === "win32" ? "Windows" : host.platform === "linux" ? "Linux" : "Computer"} · online ${ago(host.since)}`));
      const dot = h("span", "online-dot");
      dot.setAttribute("aria-label", "Online");
      card.append(glyph, copy, dot);
      list.append(card);
    });
    page.append(bar, list);
    return page;
  };
  if (rebuild && screen !== null) {
    for (const undo of teardown) undo();
    teardown = [];
    const next = build();
    next.classList.add("screen");
    screen.replaceWith(next);
    screen = next;
    return;
  }
  show("computers", build);
}

/* ── Chats ───────────────────────────────────────────────────────────────── */

function deviceLine(): string {
  const device = state.device;
  if (device === null) return "Connecting…";
  return [device.project ?? "No project open", device.model].filter(Boolean).join(" · ");
}

function showChats(): void {
  show("chats", () => {
    const page = h("section", "chats");
    const bar = h("header", "bar");
    const back = iconButton("back", "Your computers", "", () => { state.hostId = null; remember.set("host", null); showComputers(); });
    const titles = h("div", "bar-titles");
    const host = state.hosts.find((one) => one.id === state.hostId);
    headerTitle = h("h1", "", state.device?.name ?? host?.name ?? "Computer");
    headerSub = h("p", "bar-sub", deviceLine());
    titles.append(headerTitle, headerSub);
    headerBuck = mascot("idle", 40);
    bar.append(back, titles, headerBuck.element);
    teardown.push(() => { headerBuck = null; headerTitle = null; headerSub = null; });

    powerSlot = h("div", "power-slot");
    modelSlot = h("div", "model-slot");
    teardown.push(() => { powerSlot = null; modelSlot = null; });
    chatList = h("div", "chat-list");
    teardown.push(() => { chatList = null; });
    const fab = tap("", "fab", () => openChat(null));
    fab.append(icon("plus"), h("span", "", "New chat"));
    page.append(bar, offlineNotice(), powerSlot, modelSlot, chatList, fab);
    return page;
  });
  paintChats();
  paintPower();
  paintModels();
  paintOffline(!state.hosts.some((one) => one.id === state.hostId));
}

function paintChats(): void {
  if (headerTitle !== null) headerTitle.textContent = state.device?.name ?? headerTitle.textContent;
  if (headerSub !== null) headerSub.textContent = deviceLine();
  if (chatList === null) return;
  chatList.replaceChildren();
  if (state.device === null) {
    for (let i = 0; i < 4; i++) chatList.append(h("div", "skeleton"));
    return;
  }
  if (state.chats.length === 0) {
    const empty = h("div", "empty small");
    empty.append(h("h2", "", "No chats yet"), h("p", "", "Start one - it runs on your computer, in the project it has open."));
    chatList.append(empty);
    return;
  }
  const working = state.chats.some((chat) => chat.running);
  headerBuck?.setMood(working ? "working" : "idle");
  state.chats.forEach((chat, index) => {
    const row = tap("", "chat-row", () => openChat(chat.id, chat.title));
    row.style.setProperty("--i", String(Math.min(index, 12)));
    const glyph = h("span", "chat-glyph");
    glyph.append(icon("chat"));
    const copy = h("span", "chat-copy");
    copy.append(h("strong", "", chat.title || "Untitled chat"), h("small", "", chat.running ? "Working now" : ago(chat.updatedAt)));
    row.append(glyph, copy);
    if (chat.running) { const spin = h("span", "spinner"); spin.setAttribute("aria-label", "Working"); row.append(spin); }
    chatList!.append(row);
  });
}

/* ── Sleep when done ─────────────────────────────────────────────────────── */

const POWER_WORDS: Record<PowerActionName, string> = { nothing: "Off", sleep: "Sleep", hibernate: "Hibernate", shutdown: "Shut down", lock: "Lock" };
let countdownTimer: number | null = null;

function paintPower(): void {
  if (countdownTimer !== null) { window.clearInterval(countdownTimer); countdownTimer = null; }
  if (powerSlot === null) return;
  powerSlot.replaceChildren();
  const power = state.power;
  if (power === null || !power.supported) return;
  if (power.countdown !== null) {
    const banner = h("div", "countdown");
    const words = h("span", "");
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((power.countdown!.deadline - Date.now()) / 1000));
      const verb = power.countdown!.action === "shutdown" ? "Shutting down" : power.countdown!.action === "sleep" ? "Sleeping" : power.countdown!.action === "lock" ? "Locking" : "Hibernating";
      words.textContent = `${verb} in ${left} s`;
    };
    tick();
    countdownTimer = window.setInterval(tick, 500);
    banner.append(icon("moon"), words, tap("Cancel", "btn btn-small", () => send({ t: "power-cancel" })));
    powerSlot.append(banner);
    return;
  }
  const card = h("div", "power-card");
  const head = h("div", "power-head");
  head.append(icon("moon"), h("span", "", "When everything's done"));
  const segments = h("div", "segments");
  segments.setAttribute("role", "radiogroup");
  segments.setAttribute("aria-label", "When everything's done");
  const choices = power.actions.filter((action) => action !== "hibernate");
  choices.forEach((action) => {
    const option = tap(POWER_WORDS[action], "segment", () => {
      if (action === power.action) return;
      buzz(10);
      send({ t: "power", action, repeat: power.repeat });
      state.power = { ...power, action };
      paintPower();
    });
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(action === power.action));
    segments.append(option);
  });
  segments.style.setProperty("--count", String(choices.length));
  segments.style.setProperty("--at", String(Math.max(0, (choices as readonly PowerActionName[]).indexOf(power.action))));
  card.append(head, segments);
  if (power.action !== "nothing") {
    const every = h("label", "every");
    const box = h("input");
    box.type = "checkbox";
    box.checked = power.repeat === "always";
    box.addEventListener("change", () => send({ t: "power", action: power.action, repeat: box.checked ? "always" : "once" }));
    every.append(box, document.createTextNode(" Every time, not just next time"));
    card.append(every);
  }
  powerSlot.append(card);
}

/* ── One chat ────────────────────────────────────────────────────────────── */

function moodFor(timeline: PhoneTimeline | null): AdcodeMascotMood {
  if (timeline === null || !timeline.running) return "idle";
  if (/Thinking/.test(timeline.activity)) return "thinking";
  if (/Writing/.test(timeline.activity)) return "working";
  if (/Waiting/.test(timeline.activity)) return "listening";
  return "searching";
}

function openChat(sessionId: string | null, title = "New chat"): void {
  state.sessionId = sessionId;
  state.title = title;
  state.timeline = sessionId === null ? { items: [], running: false, activity: "" } : null;
  rendered = [];
  show("chat", () => {
    const page = h("section", "chat");
    const bar = h("header", "bar");
    const back = iconButton("back", "All chats", "", () => { state.sessionId = null; state.timeline = null; showChats(); send({ t: "chats" }); });
    const titles = h("div", "bar-titles");
    headerTitle = h("h1", "", title);
    headerSub = h("p", "bar-sub", state.device?.name ?? "");
    titles.append(headerTitle, headerSub);
    headerBuck = mascot("idle", 40);
    bar.append(back, titles, headerBuck.element);

    const scroller = h("div", "timeline-scroll");
    timelineList = h("ol", "timeline");
    timelineList.setAttribute("aria-live", "polite");
    timelineList.setAttribute("aria-relevant", "additions");
    if (sessionId !== null) for (let i = 0; i < 3; i++) timelineList.append(h("li", `skeleton bubble-${i % 2 === 0 ? "assistant" : "user"}`));
    else {
      const hello = h("li", "welcome");
      const buck = mascot("greeting", 88);
      hello.append(buck.element, h("p", "", `What should ${state.device?.name ?? "your computer"} work on?`), h("small", "", state.device?.project === null || state.device === null ? "It works in whatever project ADCode has open." : `In ${state.device.project}.`));
      timelineList.append(hello);
    }
    scroller.append(timelineList);
    activityLine = h("div", "activity");
    activityLine.hidden = true;
    modelSlot = h("div", "model-slot model-slot-chat");

    const composer = h("form", "composer");
    const input = h("textarea", "composer-input");
    input.rows = 1;
    input.placeholder = "Message your computer";
    input.maxLength = MAX_PHONE_TEXT;
    input.enterKeyHint = "send";
    // scrollHeight leaves out the border; without it the box is 2px short and grows a scrollbar.
    const grow = (): void => {
      input.style.height = "auto";
      const wanted = input.scrollHeight + (input.offsetHeight - input.clientHeight);
      input.style.height = `${Math.min(wanted, 160)}px`;
      input.style.overflowY = wanted > 160 ? "auto" : "hidden";
    };
    input.addEventListener("input", () => { grow(); paintComposer(); });
    input.addEventListener("keydown", (event) => {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      if (event.key === "Enter" && !event.shiftKey && !coarse) { event.preventDefault(); composer.requestSubmit(); }
    });
    composerButton = h("button", "send");
    composerButton.type = "submit";
    const paintComposer = (): void => {
      if (composerButton === null) return;
      const running = state.timeline?.running === true;
      composerButton.replaceChildren(icon(running && input.value.trim() === "" ? "stop" : "send"));
      composerButton.setAttribute("aria-label", running && input.value.trim() === "" ? "Stop" : "Send");
      composerButton.dataset["mode"] = running && input.value.trim() === "" ? "stop" : "send";
    };
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      if (composerButton?.dataset["mode"] === "stop") {
        if (state.sessionId !== null) { send({ t: "stop", sessionId: state.sessionId }); buzz(20); }
        return;
      }
      const text = input.value.trim();
      if (text === "") return;
      const nonce = Math.random().toString(36).slice(2, 12);
      if (!send({ t: "send", text, sessionId: state.sessionId, nonce })) { toast("Your computer isn't reachable right now.", "warn"); return; }
      state.pending.set(nonce, state.sessionId ?? "new");
      buzz(12);
      if (state.title === "New chat") { state.title = text.length > 48 ? `${text.slice(0, 46)}…` : text; paintChatHeader(); }
      state.timeline = withUserMessage(state.timeline ?? { items: [], running: false, activity: "" }, text);
      input.value = "";
      grow();
      scheduleTimeline();
      headerBuck?.play("wink", 700);
    });
    composer.append(input, composerButton);
    paintComposerRef = paintComposer;
    paintComposer();

    teardown.push(() => { timelineList = null; activityLine = null; composerButton = null; headerBuck = null; headerTitle = null; headerSub = null; paintComposerRef = null; modelSlot = null; });
    page.append(bar, offlineNotice(), scroller, activityLine, modelSlot, composer);
    return page;
  });
  paintModels();
  paintOffline(!state.hosts.some((one) => one.id === state.hostId));
  if (sessionId !== null) send({ t: "open", sessionId });
}

let paintComposerRef: (() => void) | null = null;

/* ── Model ───────────────────────────────────────────────────────────────── */

function currentModelName(): string | null {
  const models = state.models;
  if (models === null || models.current === null) return null;
  const { provider, model } = models.current;
  return models.models.find((one) => one.provider === provider && one.id === model)?.name ?? model;
}

/** The chip that says which model answers, and opens the list to change it. */
function paintModels(): void {
  if (modelSlot === null) return;
  modelSlot.replaceChildren();
  const models = state.models;
  if (models === null || models.models.length === 0) return;
  const name = currentModelName() ?? "Choose a model";
  const chip = tap("", "model-chip", () => openModelSheet());
  chip.setAttribute("aria-haspopup", "dialog");
  chip.setAttribute("aria-label", `Model: ${name}. Change model`);
  chip.append(icon("spark"), h("span", "model-chip-name", name), icon("chevron"));
  modelSlot.append(chip);
}

function openModelSheet(): void {
  const models = state.models;
  if (models === null) return;
  document.querySelector(".sheet-backdrop")?.remove();
  const backdrop = h("div", "sheet-backdrop");
  const sheet = h("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Choose a model");
  const grip = h("span", "sheet-grip");
  const head = h("div", "sheet-head");
  head.append(h("h2", "", "Model"), h("p", "", "Your computer answers with this from the next message. Only models it has connected are listed."));
  const list = h("div", "sheet-list");
  let lastProvider = "";
  let index = 0;
  for (const model of models.models) {
    if (model.provider !== lastProvider) {
      lastProvider = model.provider;
      list.append(h("h3", "sheet-group", model.providerName));
    }
    const current = models.current?.provider === model.provider && models.current.model === model.id;
    const row = tap("", "sheet-row", () => {
      close();
      if (current) return;
      if (!send({ t: "model", provider: model.provider, model: model.id })) { toast("Your computer isn't reachable right now.", "warn"); return; }
      // Shown at once; the computer confirms with the list it now has.
      state.models = { ...models, current: { provider: model.provider, model: model.id } };
      if (state.device !== null) state.device = { ...state.device, model: model.name };
      paintModels();
      if (state.view === "chats") paintChats();
      buzz(12);
      toast(`Now using ${model.name}`, "ok");
    });
    row.style.setProperty("--i", String(Math.min(index++, 14)));
    row.setAttribute("aria-current", String(current));
    const copy = h("span", "sheet-row-copy");
    copy.append(h("strong", "", model.name));
    if (model.note !== "") copy.append(h("small", "", model.note));
    row.append(copy);
    if (current) row.append(icon("check"));
    list.append(row);
  }
  sheet.append(grip, head, list);
  backdrop.append(sheet);
  const previous = document.activeElement as HTMLElement | null;
  const close = (): void => {
    if (backdrop.dataset["leave"] === "true") return;
    backdrop.dataset["leave"] = "true";
    document.removeEventListener("keydown", onKey);
    window.setTimeout(() => backdrop.remove(), 220);
    previous?.focus?.();
  };
  const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  document.body.append(backdrop);
  (list.querySelector('[aria-current="true"]') as HTMLElement | null ?? list.querySelector(".sheet-row") as HTMLElement | null)?.focus();
  send({ t: "models" });
}

function paintChatHeader(): void {
  if (state.view !== "chat") return;
  if (headerTitle !== null) headerTitle.textContent = state.title || "Chat";
}

function paintActivity(): void {
  const timeline = state.timeline;
  if (activityLine === null || timeline === null) return;
  activityLine.hidden = !timeline.running;
  activityLine.replaceChildren(h("span", "pulse"), h("span", "", timeline.activity || "Working…"));
  headerBuck?.setMood(moodFor(timeline));
  paintComposerRef?.();
}

let timelineFrame: number | null = null;
function scheduleTimeline(): void {
  if (timelineFrame !== null) return;
  timelineFrame = requestAnimationFrame(() => { timelineFrame = null; paintTimeline(false); });
}

function itemNode(item: PhoneTimelineItem, fresh: boolean): HTMLLIElement {
  const node = h("li", `item item-${item.kind}`);
  if (fresh) node.dataset["fresh"] = "true";
  fillItem(node, item);
  return node;
}

function fillItem(node: HTMLElement, item: PhoneTimelineItem): void {
  if (item.kind === "assistant") {
    const body = h("div", "bubble bubble-assistant md");
    renderMarkdown(body, item.text);
    if (item.open === true) body.append(h("span", "caret"));
    node.replaceChildren(body);
  } else if (item.kind === "user") {
    node.replaceChildren(h("div", "bubble bubble-user", item.text));
  } else if (item.kind === "tool") {
    const row = h("div", "tool-row");
    row.append(icon("tool"), h("span", "", item.text));
    node.replaceChildren(row);
  } else {
    node.replaceChildren(h("div", `note note-${item.kind}`, item.text));
  }
}

function paintTimeline(reset: boolean): void {
  const list = timelineList;
  const timeline = state.timeline;
  if (list === null || timeline === null) return;
  const scroller = list.parentElement!;
  const pinned = reset || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  if (reset || rendered.length > timeline.items.length) {
    list.replaceChildren(...timeline.items.map((item) => itemNode(item, false)));
    if (timeline.items.length === 0) {
      const empty = h("li", "welcome");
      empty.append(h("p", "", "Nothing here yet."));
      list.append(empty);
    }
  } else {
    list.querySelector(".welcome")?.remove();
    const nodes = list.children;
    timeline.items.forEach((item, index) => {
      const before = rendered[index];
      if (before === undefined) list.append(itemNode(item, true));
      else if (before.text !== item.text || before.open !== item.open || before.kind !== item.kind) fillItem(nodes[index] as HTMLElement, item);
    });
  }
  rendered = [...timeline.items];
  paintActivity();
  if (pinned) scroller.scrollTo({ top: scroller.scrollHeight, behavior: reset ? "auto" : "smooth" });
}

/* ── Start ───────────────────────────────────────────────────────────────── */

function route(): void {
  if (state.user === null) { disconnect(); showSignIn(); return; }
  void connect();
  if (state.hostId !== null) showChats(); else showComputers();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || state.user === null) return;
  if (socket === null) { attempts = 0; void connect(); return; }
  // Back from the background: catch up on what happened while the phone slept.
  send({ t: "hello" });
  if (state.view === "chat" && state.sessionId !== null) send({ t: "open", sessionId: state.sessionId });
});
window.addEventListener("online", () => { if (socket === null && state.user !== null) { attempts = 0; void connect(); } });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => undefined);
}

void (DEMO ? Promise.resolve({ uid: "demo" } as User) : currentUser()).then((user) => {
  state.user = user;
  route();
  if (DEMO) return;
  onUserChanged((next) => {
    const changed = (next?.uid ?? null) !== (state.user?.uid ?? null);
    state.user = next;
    if (changed) { disconnect(); state.hosts = []; route(); }
  });
});
