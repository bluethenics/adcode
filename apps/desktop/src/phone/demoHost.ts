/**
 * A pretend computer for the phone page, in development builds only (`/phone/?demo`).
 *
 * Stands in for the relay and the desktop at once, speaking the real protocol, so every screen
 * - computers, chats, a streamed reply, tool steps, the sleep countdown - can be seen and
 * smoke-tested without an account or a running desktop. Production builds never include it:
 * `main.ts` reaches it only behind `__ADCODE_WEB_DEV__`.
 */
import { parsePhoneRequest, type HostMessage, type PhoneChatSummary, type PhoneModels, type PhonePowerState } from "../shared/phoneProtocol.ts";

type Listener = (event: { data?: string; code?: number }) => void;

export class DemoSocket {
  readyState = 0;
  private readonly listeners = new Map<string, Listener[]>();
  private power: PhonePowerState = { supported: true, action: "nothing", repeat: "once", actions: ["nothing", "sleep", "hibernate", "shutdown", "lock"], countdown: null };
  private models: PhoneModels = {
    current: { provider: "anthropic", model: "claude-sonnet-5-5" },
    models: [
      { provider: "anthropic", providerName: "Anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Recommended" },
      { provider: "anthropic", providerName: "Anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "" },
      { provider: "anthropic", providerName: "Anthropic", id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "" },
      { provider: "tagflow", providerName: "Tagflow AI", id: "tagflow-code-flash-1", name: "Tagflow Code Flash 1", note: "Free" },
      { provider: "ollama", providerName: "Ollama", id: "qwen3-coder:30b", name: "qwen3-coder:30b", note: "" },
    ],
  };
  private chats: PhoneChatSummary[] = [
    { id: "s1", title: "Add a dark mode toggle to the settings page", updatedAt: Date.now() - 4 * 60_000, running: false },
    { id: "s2", title: "Why does the build fail on CI?", updatedAt: Date.now() - 3 * 3_600_000, running: false },
    { id: "s3", title: "Landing page for the bakery", updatedAt: Date.now() - 26 * 3_600_000, running: false },
  ];

  constructor() {
    window.setTimeout(() => {
      this.readyState = 1;
      this.emit("open", {});
      this.frame({ type: "hosts", hosts: [{ id: "demo-host", name: "Studio MacBook", platform: "darwin", since: Date.now() - 42 * 60_000 }] });
    }, 450);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = 3;
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as { type: string; data?: string };
    if (frame.type !== "to" || frame.data === undefined) return;
    const request = parsePhoneRequest(frame.data);
    if (request === null) return;
    switch (request.t) {
      case "hello":
        this.reply({ t: "hello", device: { name: "Studio MacBook", platform: "darwin", project: "bakery-site", model: "claude-sonnet-5-5" }, chats: this.chats, power: this.power }, 300);
        return;
      case "chats":
        this.reply({ t: "chats", chats: this.chats });
        return;
      case "open":
        this.reply({
          t: "chat", sessionId: request.sessionId, title: this.chats.find((chat) => chat.id === request.sessionId)?.title ?? "Chat", running: false, live: [],
          messages: [
            { role: "user", text: "Add a dark mode toggle to the settings page", at: Date.now() - 300_000 },
            { role: "assistant", text: "Done. I added a **Theme** row to `Settings.tsx` that switches between light, dark and system:\n\n- the choice is saved in `localStorage`\n- `prefers-color-scheme` is the default\n\n```tsx\n<ThemeToggle value={theme} onChange={setTheme} />\n```\n\nOpen https://localhost:3000/settings to try it.", at: Date.now() - 240_000 },
          ],
        }, 350);
        return;
      case "send": {
        const id = request.sessionId ?? `s${Date.now()}`;
        if (request.sessionId === null) this.chats = [{ id, title: request.text.slice(0, 48), updatedAt: Date.now(), running: true }, ...this.chats];
        this.reply({ t: "sent", nonce: request.nonce, sessionId: id }, 120);
        const steps: [number, HostMessage][] = [
          [500, { t: "event", sessionId: id, event: { k: "thinking" } }],
          [1300, { t: "event", sessionId: id, event: { k: "tool", label: "Reading Settings.tsx" } }],
          [2000, { t: "event", sessionId: id, event: { k: "tool", label: "Editing Settings.tsx" } }],
          [2700, { t: "event", sessionId: id, event: { k: "tool", label: "Running npm test" } }],
        ];
        const reply = "All set. The tests pass, and the change is in `Settings.tsx`.\n\nAnything else while I'm here?";
        let at = 3200;
        for (const word of reply.split(/(?<= )/)) { steps.push([at, { t: "event", sessionId: id, event: { k: "text", text: word } }]); at += 45; }
        steps.push([at + 200, { t: "event", sessionId: id, event: { k: "ended", ended: "finished" } }]);
        window.setTimeout(() => { this.chats = this.chats.map((chat) => (chat.id === id ? { ...chat, running: false, updatedAt: Date.now() } : chat)); }, at + 200);
        for (const [delay, message] of steps) this.reply(message, delay);
        if (this.power.action !== "nothing") {
          window.setTimeout(() => { this.power = { ...this.power, countdown: { action: this.power.action, deadline: Date.now() + 60_000 } }; this.reply({ t: "power", power: this.power }); }, at + 600);
        }
        return;
      }
      case "stop":
        this.reply({ t: "event", sessionId: request.sessionId, event: { k: "ended", ended: "stopped" } }, 150);
        return;
      case "power":
        this.power = { ...this.power, action: request.action, repeat: request.repeat };
        this.reply({ t: "power", power: this.power }, 150);
        return;
      case "power-cancel":
        this.power = { ...this.power, countdown: null };
        this.reply({ t: "power", power: this.power }, 120);
        return;
      case "models":
        this.reply({ t: "models", models: this.models }, 160);
        return;
      case "model":
        this.models = { ...this.models, current: { provider: request.provider, model: request.model } };
        this.reply({ t: "models", models: this.models }, 220);
        return;
    }
  }

  private reply(message: HostMessage, delay = 200): void {
    window.setTimeout(() => this.frame({ type: "from", host: "demo-host", data: JSON.stringify(message) }), delay);
  }

  private frame(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  private emit(type: string, event: { data?: string; code?: number }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
