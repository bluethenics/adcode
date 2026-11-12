import { describe, expect, it } from "vitest";
import {
  afterFiring,
  countdownText,
  powerCommand,
  powerPlatform,
  readPowerPreferences,
  shouldStartCountdown,
  supportedActions,
  type PowerPreferences,
} from "../src/main/powerAfterTasksModel.ts";

const armed: PowerPreferences = { action: "sleep", repeat: "once", graceSeconds: 60 };

describe("sleep or shut down when the assistant finishes", () => {
  it("reads settings defensively, defaulting to doing nothing", () => {
    expect(readPowerPreferences({})).toEqual({ action: "nothing", repeat: "once", graceSeconds: 60 });
    expect(readPowerPreferences({ "adcode.power.whenDone": "explode", "adcode.power.graceSeconds": "7" })).toEqual({ action: "nothing", repeat: "once", graceSeconds: 60 });
    expect(readPowerPreferences({ "adcode.power.whenDone": "shutdown", "adcode.power.whenDoneRepeat": "always", "adcode.power.graceSeconds": "120" })).toEqual({ action: "shutdown", repeat: "always", graceSeconds: 120 });
  });

  it("waits for the last chat, and never acts after a Stop", () => {
    const base = { preferences: armed, platform: "win32" as const, counting: false };
    expect(shouldStartCountdown({ ...base, ended: "finished", stillRunning: 0 })).toBe(true);
    expect(shouldStartCountdown({ ...base, ended: "failed", stillRunning: 0 })).toBe(true);
    expect(shouldStartCountdown({ ...base, ended: "finished", stillRunning: 1 })).toBe(false);
    expect(shouldStartCountdown({ ...base, ended: "stopped", stillRunning: 0 })).toBe(false);
    expect(shouldStartCountdown({ ...base, ended: "finished", stillRunning: 0, counting: true })).toBe(false);
    expect(shouldStartCountdown({ ...base, preferences: { ...armed, action: "nothing" }, ended: "finished", stillRunning: 0 })).toBe(false);
  });

  it("never runs in the web version's sandbox", () => {
    expect(powerPlatform("linux", "web")).toBe("web");
    expect(supportedActions("web")).toEqual(["nothing"]);
    expect(shouldStartCountdown({ preferences: armed, platform: "web", ended: "finished", stillRunning: 0, counting: false })).toBe(false);
  });

  it("uses fixed system commands, and sleep never hibernates on Windows", () => {
    const sleep = powerCommand("sleep", "win32");
    expect(sleep?.file).toBe("powershell.exe");
    expect(sleep?.args.join(" ")).toContain("SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)");
    expect(powerCommand("shutdown", "win32")).toEqual({ file: "shutdown.exe", args: ["/s", "/t", "0"] });
    expect(powerCommand("sleep", "darwin")).toEqual({ file: "/usr/bin/pmset", args: ["sleepnow"] });
    expect(powerCommand("hibernate", "darwin")).toBeNull();
    expect(powerCommand("shutdown", "linux")).toEqual({ file: "systemctl", args: ["poweroff"] });
    expect(supportedActions("darwin")).toEqual(["nothing", "sleep", "shutdown", "lock"]);
  });

  it("disarms after firing unless it is set for every time", () => {
    expect(afterFiring(armed)).toBe("nothing");
    expect(afterFiring({ ...armed, repeat: "always" })).toBe("sleep");
  });

  it("says the time left in whole seconds", () => {
    expect(countdownText("shutdown", 44_100)).toBe("Shuts down in 45 s");
    expect(countdownText("sleep", 125_000)).toBe("Sleeps in 2 min 5 s");
    expect(countdownText("lock", -50)).toBe("Locks in 0 s");
  });
});
