/**
 * What the computer does when the assistant's work is all finished: the rules, not the doing.
 *
 * A person hands over a long job, walks away, and wants the laptop to sleep (or shut down)
 * once it is done instead of burning the battery all night. Three rules keep that from ever
 * surprising anybody:
 *
 * - **All of it, not some of it.** The action waits for the last working chat. One chat
 *   finishing while another still works is not "the task is finished".
 * - **Never when somebody is there.** A turn the person stopped by hand means they are at the
 *   keyboard, so nothing happens. A turn that failed still counts: the person is away, and a
 *   computer left on all night does not help a failed job.
 * - **Always a countdown.** Every action is announced first and can be cancelled, from the
 *   window, the system notification, or a phone. A chat starting during the countdown cancels
 *   it by itself.
 *
 * Pure: no Electron, no child processes, no clock. `powerAfterTasks.ts` does the rest.
 */

export const POWER_ACTIONS = ["nothing", "sleep", "hibernate", "shutdown", "lock"] as const;
export type PowerAction = (typeof POWER_ACTIONS)[number];

export const POWER_REPEAT = ["once", "always"] as const;
export type PowerRepeat = (typeof POWER_REPEAT)[number];

export const POWER_SETTING = "adcode.power.whenDone";
export const POWER_REPEAT_SETTING = "adcode.power.whenDoneRepeat";
export const POWER_GRACE_SETTING = "adcode.power.graceSeconds";

export const GRACE_CHOICES = [30, 60, 120, 300] as const;
export const DEFAULT_GRACE_SECONDS = 60;

export type TurnEnding = "finished" | "stopped" | "failed";

export interface PowerPreferences {
  readonly action: PowerAction;
  readonly repeat: PowerRepeat;
  readonly graceSeconds: number;
}

export function isPowerAction(value: unknown): value is PowerAction {
  return typeof value === "string" && (POWER_ACTIONS as readonly string[]).includes(value);
}

/** The person's choice, read from settings; anything unknown is the safe default. */
export function readPowerPreferences(values: Readonly<Record<string, unknown>>): PowerPreferences {
  const action = values[POWER_SETTING];
  const repeat = values[POWER_REPEAT_SETTING];
  const grace = Number(values[POWER_GRACE_SETTING]);
  return {
    action: isPowerAction(action) ? action : "nothing",
    repeat: repeat === "always" ? "always" : "once",
    graceSeconds: (GRACE_CHOICES as readonly number[]).includes(grace) ? grace : DEFAULT_GRACE_SECONDS,
  };
}

export type PowerPlatform = "win32" | "darwin" | "linux" | "web" | "other";

export function powerPlatform(platform: string, surface: string | undefined): PowerPlatform {
  if (surface === "web") return "web";
  return platform === "win32" || platform === "darwin" || platform === "linux" ? platform : "other";
}

export interface PowerCommand {
  readonly file: string;
  readonly args: readonly string[];
}

/**
 * The system's own command for each action, or null where this computer has none.
 *
 * Every command is a fixed program with fixed arguments: nothing a person, a model or a
 * server says is ever put into one. On Windows, sleep goes through the documented
 * `SetSuspendState` with hibernation explicitly off, because `rundll32 powrprof.dll` hibernates
 * instead on machines where hibernation is enabled. macOS has no separate hibernate, and the web
 * version's sandbox is not anybody's computer.
 */
export function powerCommand(action: PowerAction, platform: PowerPlatform): PowerCommand | null {
  if (action === "nothing") return null;
  switch (platform) {
    case "win32":
      switch (action) {
        case "sleep":
          return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)"] };
        case "hibernate":
          return { file: "shutdown.exe", args: ["/h"] };
        case "shutdown":
          return { file: "shutdown.exe", args: ["/s", "/t", "0"] };
        case "lock":
          return { file: "rundll32.exe", args: ["user32.dll,LockWorkStation"] };
      }
      break;
    case "darwin":
      switch (action) {
        case "sleep":
          return { file: "/usr/bin/pmset", args: ["sleepnow"] };
        case "shutdown":
          return { file: "/usr/bin/osascript", args: ["-e", 'tell application "System Events" to shut down'] };
        case "lock":
          return { file: "/usr/bin/pmset", args: ["displaysleepnow"] };
        case "hibernate":
          return null;
      }
      break;
    case "linux":
      switch (action) {
        case "sleep":
          return { file: "systemctl", args: ["suspend"] };
        case "hibernate":
          return { file: "systemctl", args: ["hibernate"] };
        case "shutdown":
          return { file: "systemctl", args: ["poweroff"] };
        case "lock":
          return { file: "loginctl", args: ["lock-session"] };
      }
      break;
    case "web":
    case "other":
      return null;
  }
  return null;
}

/** The actions this computer can actually do, for the picker. */
export function supportedActions(platform: PowerPlatform): PowerAction[] {
  return POWER_ACTIONS.filter((action) => action === "nothing" || powerCommand(action, platform) !== null);
}

/** Whether a turn ending now should start the countdown. */
export function shouldStartCountdown(input: {
  readonly preferences: PowerPreferences;
  readonly platform: PowerPlatform;
  readonly ended: TurnEnding;
  readonly stillRunning: number;
  readonly counting: boolean;
}): boolean {
  if (input.counting) return false;
  if (input.preferences.action === "nothing") return false;
  if (powerCommand(input.preferences.action, input.platform) === null) return false;
  if (input.stillRunning > 0) return false;
  return input.ended !== "stopped";
}

/** Words for each action, as a person reads them in a sentence: "Your computer will sleep". */
export function actionVerb(action: PowerAction): string {
  switch (action) {
    case "sleep": return "go to sleep";
    case "hibernate": return "hibernate";
    case "shutdown": return "shut down";
    case "lock": return "lock";
    case "nothing": return "stay on";
  }
}

export function actionLabel(action: PowerAction): string {
  switch (action) {
    case "sleep": return "Sleep";
    case "hibernate": return "Hibernate";
    case "shutdown": return "Shut down";
    case "lock": return "Lock";
    case "nothing": return "Do nothing";
  }
}

/** "Shuts down in 45 s", "Sleeps in 2 min 5 s". Whole seconds, never negative. */
export function countdownText(action: PowerAction, remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const time = minutes === 0 ? `${seconds} s` : rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  const verb = action === "shutdown" ? "Shuts down" : action === "sleep" ? "Sleeps" : action === "hibernate" ? "Hibernates" : action === "lock" ? "Locks" : "Stays on";
  return `${verb} in ${time}`;
}

/** After an action fires: "once" goes back to doing nothing, "always" stays armed. */
export function afterFiring(preferences: PowerPreferences): PowerAction {
  return preferences.repeat === "once" ? "nothing" : preferences.action;
}
