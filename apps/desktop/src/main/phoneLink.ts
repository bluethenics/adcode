/**
 * Phone link, the computer's side: chat with ADCode on this computer from a phone.
 *
 * Off until the person turns it on. On, this computer keeps one outgoing connection to the
 * relay's room for their account (`apps/collab-relay/src/phoneLink.ts`) - outgoing, so nothing
 * on this computer listens for the internet, and no router or firewall needs changing. A phone
 * signed in to the same account at web.bluethenics.com/phone joins that room and talks to the
 * chat here through `shared/phoneProtocol.ts`.
 *
 * This computer is the host. Its files, model keys and tools never leave it: the phone sends
 * words and gets back what the chat shows. When this computer sleeps, shuts down or loses its
 * network, the phone says the computer is offline - nothing can reach it any other way.
 *
 * Every request is checked here (`parsePhoneRequest`); the relay is trusted only to say the
 * phone is signed in to this account. A phone that connects is announced in the window, which
 * can send it away.
 */
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { CHANNELS, type PhoneLinkPhoneView, type PhoneLinkStateView } from "../shared/api.ts";
import {
  MAX_CHATS,
  parsePhoneRequest,
  phoneEventFor,
  phoneMessages,
  phonePairUrl,
  phoneModelChoices,
  isOfferedModel,
  type HostMessage,
  type PhoneChatSummary,
  type PhoneDevice,
  type PhonePowerState,
  type PhoneRequest,
} from "../shared/phoneProtocol.ts";
import { aiCancel, aiLiveTurn, aiPhoneSummary, aiRuns, aiSendFromPhone, aiSessions, aiStatus, aiUseModelFromPhone, onChatEvent } from "./ai.ts";
import { onPowerChanged, powerState, setPowerPreference, cancel as cancelPower } from "./powerAfterTasks.ts";
import { projectServiceOrigin, projectToken } from "./sharedProjects.ts";
import { currentSettings, onSettingsChanged, writeSetting } from "./settings.ts";
import { recordDebug } from "./debugLog.ts";

export const PHONE_LINK_SETTING = "adcode.phone.link";
export const PHONE_PAGE_URL = process.env["ADCODE_PHONE_PAGE"] ?? "https://web.bluethenics.com/phone/";

const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const HEARTBEAT_MS = 25_000;

let socket: WebSocket | null = null;
let status: PhoneLinkStateView["status"] = "off";
let detail = "";
let phones: PhoneLinkPhoneView[] = [];
let attempt = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let deviceId: string | null = null;
let stopEvents: (() => void) | null = null;
let stopPower: (() => void) | null = null;

const enabled = (): boolean => currentSettings()[PHONE_LINK_SETTING] === true;
const deviceName = (): string => hostname().replace(/\.local$/, "").slice(0, 60) || "My computer";

export function phoneLinkState(): PhoneLinkStateView {
  return { enabled: enabled(), status: enabled() ? status : "off", detail: enabled() ? detail : "", phones, pageUrl: PHONE_PAGE_URL, pairUrl: phonePairUrl(PHONE_PAGE_URL, deviceId), deviceName: deviceName() };
}

function announce(): void {
  const state = phoneLinkState();
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(CHANNELS.phoneChanged, state);
}

function setStatus(next: PhoneLinkStateView["status"], words: string): void {
  status = next;
  detail = words;
  announce();
}

/** A stable id per computer, so a reconnect replaces its old connection instead of adding one. */
async function ensureDeviceId(): Promise<string> {
  if (deviceId !== null) return deviceId;
  const file = join(app.getPath("userData"), "phone-link", "device.json");
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { id?: unknown };
    if (typeof saved.id === "string" && /^[a-f0-9-]{36}$/.test(saved.id)) return (deviceId = saved.id);
  } catch { /* First time on this computer. */ }
  deviceId = randomUUID();
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ id: deviceId }), "utf8");
  } catch { /* An id that changes on restart only means the phone sees it as new. */ }
  return deviceId;
}

/* ── Talking to phones ───────────────────────────────────────────────────── */

function sendTo(phone: string | null, message: HostMessage): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "to", ...(phone === null ? {} : { phone }), data: JSON.stringify(message) }));
}

function powerSummary(): PhonePowerState {
  const state = powerState();
  return {
    supported: state.supported,
    action: state.action,
    repeat: state.repeat,
    actions: state.actions,
    countdown: state.countdown === null ? null : { action: state.countdown.action, deadline: state.countdown.deadline },
  };
}

async function chatList(): Promise<PhoneChatSummary[]> {
  const running = new Set(aiRuns().map((run) => run.sessionId));
  const sessions = await aiSessions().catch(() => []);
  return sessions
    .filter((session) => session.messages.length > 0 || running.has(session.id))
    .slice(0, MAX_CHATS)
    .map((session) => ({ id: session.id, title: session.title, updatedAt: session.updatedAt, running: running.has(session.id) }));
}

/**
 * Whether the phone may show a Zeekend card under a finished reply: the same switch as under a
 * reply on this computer, Sponsored cards under AI replies, with sponsored messages on and
 * Frequency not set to Off.
 */
const sponsoredOnPhone = (values: Readonly<Record<string, unknown>> = currentSettings()): boolean =>
  values["adcode.ads.enabled"] !== false && values["adcode.ads.chatSponsored"] === true
  && values["adcode.ads.frequency"] !== "off";

function deviceSummary(): PhoneDevice {
  const summary = aiPhoneSummary();
  return { name: deviceName(), platform: process.platform, project: summary.project, model: summary.model, sponsored: sponsoredOnPhone() };
}

async function answer(phone: string, request: PhoneRequest): Promise<void> {
  switch (request.t) {
    case "hello": {
      sendTo(phone, { t: "hello", device: deviceSummary(), chats: await chatList(), power: powerSummary() });
      return;
    }
    case "chats":
      sendTo(phone, { t: "chats", chats: await chatList() });
      return;
    case "open": {
      const session = (await aiSessions().catch(() => [])).find((one) => one.id === request.sessionId);
      const running = aiRuns().some((run) => run.sessionId === request.sessionId);
      const live = running
        ? aiLiveTurn(request.sessionId).map((event) => phoneEventFor(event as { kind: string })).filter((event) => event !== null)
        : [];
      // The running turn's user message is already in the saved session; its reply is in `live`.
      sendTo(phone, { t: "chat", sessionId: request.sessionId, title: session?.title ?? "New chat", messages: phoneMessages(session?.messages ?? []), running, live });
      return;
    }
    case "send": {
      try {
        const sessionId = aiSendFromPhone(request.text, request.sessionId);
        sendTo(phone, { t: "sent", nonce: request.nonce, sessionId });
        recordDebug("info", "phone", "A message arrived from a phone");
      } catch (error) {
        sendTo(phone, { t: "error", message: error instanceof Error ? error.message : String(error), nonce: request.nonce });
      }
      return;
    }
    case "stop":
      aiCancel(request.sessionId);
      return;
    case "power":
      try {
        await setPowerPreference(request.action, request.repeat);
      } catch (error) {
        sendTo(phone, { t: "error", message: error instanceof Error ? error.message : String(error) });
      }
      return;
    case "power-cancel":
      cancelPower("Cancelled from your phone");
      return;
    case "models":
      sendTo(phone, { t: "models", models: phoneModelChoices(await aiStatus()) });
      return;
    case "model": {
      // Only a model this computer offered: the phone is a remote, not a way to name anything.
      if (!isOfferedModel(phoneModelChoices(await aiStatus()), request.provider, request.model)) {
        sendTo(phone, { t: "error", message: "That model isn't available on this computer any more." });
        sendTo(phone, { t: "models", models: phoneModelChoices(await aiStatus()) });
        return;
      }
      await aiUseModelFromPhone(request.provider, request.model);
      recordDebug("info", "phone", "A phone switched the model");
      // Every phone hears it, through the settings listener below.
      return;
    }
  }
}

/** Tell every phone which model is in use now: the desktop or another phone changed it. */
async function announceModels(): Promise<void> {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  sendTo(null, { t: "models", models: phoneModelChoices(await aiStatus()) });
}

/* ── The connection ──────────────────────────────────────────────────────── */

function clearTimers(): void {
  if (retry !== null) { clearTimeout(retry); retry = null; }
  if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null; }
}

function disconnect(): void {
  clearTimers();
  const old = socket;
  socket = null;
  phones = [];
  if (old !== null) { old.removeAllListeners(); try { old.close(1000, "Phone link off"); } catch { /* Already gone. */ } }
}

function scheduleRetry(): void {
  if (!enabled() || retry !== null) return;
  const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!;
  attempt += 1;
  retry = setTimeout(() => { retry = null; void connect(); }, wait);
}

async function connect(): Promise<void> {
  if (!enabled() || socket !== null) return;
  setStatus("connecting", "Reaching ADCode's relay…");
  let token: string;
  try {
    token = await projectToken();
  } catch {
    setStatus("signed-out", "Sign in to ADCode on this computer, with the same account you use on your phone.");
    scheduleRetry();
    return;
  }
  const id = await ensureDeviceId();
  const query = new URLSearchParams({ device: id, name: deviceName(), platform: process.platform });
  const url = `${projectServiceOrigin().replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/phone/host?${query.toString()}`;
  const next = new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, maxPayload: 1024 * 1024, handshakeTimeout: 15_000 });
  socket = next;
  next.on("open", () => {
    attempt = 0;
    setStatus("online", "Scan the code with your phone to start.");
    heartbeat = setInterval(() => { if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ type: "ping" })); }, HEARTBEAT_MS);
  });
  next.on("message", (raw) => {
    let frame: { type?: unknown; phone?: unknown; data?: unknown; phones?: unknown };
    try { frame = JSON.parse(String(raw)) as typeof frame; } catch { return; }
    if (frame.type === "phones" && Array.isArray(frame.phones)) {
      const before = new Set(phones.map((phone) => phone.id));
      phones = frame.phones
        .filter((one): one is { id: string; label: string; since: number } => typeof one === "object" && one !== null && typeof (one as { id?: unknown }).id === "string")
        .map((one) => ({ id: one.id, label: String(one.label ?? "Phone").slice(0, 60), since: Number(one.since) || Date.now() }));
      const joined = phones.filter((phone) => !before.has(phone.id));
      if (joined.length > 0) recordDebug("info", "phone", `${joined.map((phone) => phone.label).join(", ")} connected`);
      setStatus("online", phones.length === 0 ? "Scan the code with your phone to start." : `${phones.length} phone${phones.length === 1 ? "" : "s"} connected.`);
      return;
    }
    if (frame.type !== "from" || typeof frame.phone !== "string" || typeof frame.data !== "string") return;
    const request = parsePhoneRequest(frame.data);
    if (request === null) return;
    const phone = frame.phone;
    void answer(phone, request).catch((error: unknown) => {
      sendTo(phone, { t: "error", message: error instanceof Error ? error.message : String(error) });
    });
  });
  next.on("close", (code) => {
    if (socket !== next) return;
    socket = null;
    phones = [];
    clearTimers();
    if (!enabled()) { setStatus("off", ""); return; }
    setStatus("offline", code === 1008 ? "Too many messages. Reconnecting shortly." : "Lost the connection. Reconnecting…");
    scheduleRetry();
  });
  next.on("error", (error) => {
    recordDebug("warn", "phone", `Phone link connection: ${error.message}`);
    // A refused upgrade (signed out, too many computers) arrives here and then as close.
    if (/401/.test(error.message)) setStatus("signed-out", "Your sign-in expired. Sign in to ADCode again.");
  });
}

function sync(): void {
  if (enabled()) {
    if (stopEvents === null) {
      stopEvents = onChatEvent((event) => {
        const sessionId = event["sessionId"];
        if (typeof sessionId !== "string") return;
        const phoneEvent = phoneEventFor(event);
        if (phoneEvent !== null) sendTo(null, { t: "event", sessionId, event: phoneEvent });
        if (phoneEvent?.k === "ended") void chatList().then((chats) => sendTo(null, { t: "chats", chats }));
      });
      stopPower = onPowerChanged(() => sendTo(null, { t: "power", power: powerSummary() }));
    }
    attempt = 0;
    void connect();
    return;
  }
  stopEvents?.();
  stopPower?.();
  stopEvents = null;
  stopPower = null;
  disconnect();
  setStatus("off", "");
}

export function startPhoneLink(): void {
  // Known before the dialog first asks, so its QR code points at this computer.
  void ensureDeviceId();
  ipcMain.handle(CHANNELS.phoneState, async () => { await ensureDeviceId(); return phoneLinkState(); });
  ipcMain.handle(CHANNELS.phoneSetEnabled, async (_event, on: unknown) => {
    await writeSetting(PHONE_LINK_SETTING, on === true);
    sync();
    return phoneLinkState();
  });
  ipcMain.handle(CHANNELS.phoneDisconnect, (_event, phoneId: unknown) => {
    if (typeof phoneId === "string" && socket !== null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "kick", phone: phoneId }));
    return phoneLinkState();
  });
  let was = enabled();
  let modelWas = `${String(currentSettings()["adcode.ai.provider"] ?? "")}/${String(currentSettings()["adcode.ai.model"] ?? "")}`;
  let sponsoredWas = sponsoredOnPhone();
  onSettingsChanged((values) => {
    const modelNow = `${String(values["adcode.ai.provider"] ?? "")}/${String(values["adcode.ai.model"] ?? "")}`;
    if (modelNow !== modelWas) { modelWas = modelNow; void announceModels().catch(() => undefined); }
    // Switching sponsored cards off here takes them off every connected phone at once.
    const sponsoredNow = sponsoredOnPhone(values);
    if (sponsoredNow !== sponsoredWas) {
      sponsoredWas = sponsoredNow;
      void chatList().then((chats) => sendTo(null, { t: "hello", device: deviceSummary(), chats, power: powerSummary() })).catch(() => undefined);
    }
    const now = values[PHONE_LINK_SETTING] === true;
    if (now === was) return;
    was = now;
    sync();
  });
  // The settings file loads asynchronously; give it a moment before the first connection.
  setTimeout(() => sync(), 3_000).unref?.();
}

/** The web version's sandbox: there is no computer of the person's here to link to. */
export function registerPhoneLinkUnsupported(): void {
  const state = (): PhoneLinkStateView => ({ enabled: false, status: "unsupported", detail: "Phone link connects your phone to ADCode on your own computer. Turn it on in the desktop app.", phones: [], pageUrl: PHONE_PAGE_URL, pairUrl: PHONE_PAGE_URL, deviceName: "" });
  ipcMain.handle(CHANNELS.phoneState, state);
  ipcMain.handle(CHANNELS.phoneSetEnabled, state);
  ipcMain.handle(CHANNELS.phoneDisconnect, state);
}
