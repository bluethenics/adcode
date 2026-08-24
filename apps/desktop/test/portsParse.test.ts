/**
 * Reading listening ports out of `netstat` and `lsof`.
 *
 * These are the tests that matter for the Ports panel, because the thing most likely to be
 * wrong is the parsing and it is the thing hardest to check by hand: reproducing "an IPv6
 * bind, a process whose name has a space in it, and the same port on two address families"
 * on a developer's machine on demand is not practical. The output is captured instead.
 */
import { describe, it, expect } from "vitest";
import {
  browsableHost,
  mergeListeners,
  parseLsof,
  parseNetstat,
  parseTasklist,
} from "../src/main/portsParse.ts";

const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       952",
  "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       24680",
  "  TCP    127.0.0.1:8788         0.0.0.0:0              LISTENING       13579",
  "  TCP    192.168.1.20:139       0.0.0.0:0              LISTENING       4",
  "  TCP    127.0.0.1:5173         127.0.0.1:61234        ESTABLISHED     24680",
  "  TCP    [::]:135               [::]:0                 LISTENING       952",
  "  TCP    [::1]:5173             [::]:0                 LISTENING       24680",
  "  UDP    0.0.0.0:5353           *:*                                    2100",
].join("\r\n");

const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"node.exe","24680","Console","1","120,456 K"',
  '"My App Host.exe","13579","Console","1","45,000 K"',
].join("\r\n");

const LSOF = [
  "COMMAND     PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
  "node      24680 dev   23u  IPv4 0x9a2b3c4d5e6f7081      0t0  TCP 127.0.0.1:5173 (LISTEN)",
  "node      24680 dev   24u  IPv6 0x9a2b3c4d5e6f7082      0t0  TCP [::1]:5173 (LISTEN)",
  "Postgres    711 dev    7u  IPv4 0x1122334455667788      0t0  TCP *:5432 (LISTEN)",
  "rapportd    512 dev    4u  IPv4 0xaabbccddeeff0011      0t0  TCP 0.0.0.0:49152 (LISTEN)",
].join("\n");

describe("netstat", () => {
  it("finds the listening TCP ports", () => {
    expect(parseNetstat(NETSTAT).map((l) => l.port).sort((a, b) => a - b)).toEqual([
      135, 135, 139, 5173, 5173, 8788,
    ]);
  });

  it("ignores established connections, which are not ports anybody is serving", () => {
    // A browser with thirty tabs open would otherwise fill the panel with noise.
    expect(parseNetstat(NETSTAT).filter((l) => l.port === 5173)).toHaveLength(2);
  });

  it("ignores UDP and the header rows", () => {
    expect(parseNetstat(NETSTAT).some((l) => l.port === 5353)).toBe(false);
  });

  it("reads an IPv6 row without splitting on the wrong colon", () => {
    const ipv6 = parseNetstat(NETSTAT).find((l) => l.address === "::1");
    expect(ipv6?.port).toBe(5173);
  });

  it("keeps the pid", () => {
    expect(parseNetstat(NETSTAT).find((l) => l.port === 8788)?.pid).toBe(13579);
  });

  it("returns nothing for empty or unrecognised output rather than throwing", () => {
    expect(parseNetstat("")).toEqual([]);
    expect(parseNetstat("something went wrong")).toEqual([]);
  });
});

describe("tasklist", () => {
  it("maps pids to image names", () => {
    expect(parseTasklist(TASKLIST).get(24680)).toBe("node.exe");
  });

  it("handles a process name containing a space, which the table format cannot", () => {
    expect(parseTasklist(TASKLIST).get(13579)).toBe("My App Host.exe");
  });

  it("skips pid 0", () => {
    expect(parseTasklist(TASKLIST).has(0)).toBe(false);
  });
});

describe("lsof", () => {
  it("finds the listening ports with their commands", () => {
    const parsed = parseLsof(LSOF);
    expect(parsed.find((l) => l.port === 5432)?.process).toBe("Postgres");
  });

  it("does not read the header row as a process called COMMAND", () => {
    expect(parseLsof(LSOF).some((l) => l.process === "COMMAND")).toBe(false);
  });

  it("normalises a wildcard bind to the same address netstat reports", () => {
    expect(parseLsof(LSOF).find((l) => l.port === 5432)?.address).toBe("0.0.0.0");
  });

  it("reads the address past the (LISTEN) suffix", () => {
    expect(parseLsof(LSOF).find((l) => l.port === 49152)?.address).toBe("0.0.0.0");
  });

  it("returns nothing when lsof found nothing", () => {
    expect(parseLsof("")).toEqual([]);
  });
});

describe("merging", () => {
  it("lists a port bound on two address families exactly once", () => {
    // Listing 5173 twice reads as a bug in the panel, not as a fact about the machine.
    const merged = mergeListeners(parseLsof(LSOF));
    expect(merged.filter((l) => l.port === 5173)).toHaveLength(1);
  });

  it("prefers the loopback bind, because that is the address you can actually open", () => {
    const merged = mergeListeners([
      { port: 3000, pid: 1, address: "0.0.0.0", process: "node" },
      { port: 3000, pid: 1, address: "127.0.0.1", process: "node" },
    ]);
    expect(merged[0]?.address).toBe("127.0.0.1");
  });

  it("names the netstat rows from the tasklist output", () => {
    const merged = mergeListeners(parseNetstat(NETSTAT), parseTasklist(TASKLIST));
    expect(merged.find((l) => l.port === 5173)?.process).toBe("node.exe");
    expect(merged.find((l) => l.port === 8788)?.process).toBe("My App Host.exe");
  });

  it("leaves the name null when nothing knew it, rather than inventing one", () => {
    const merged = mergeListeners(parseNetstat(NETSTAT), new Map());
    expect(merged.find((l) => l.port === 135)?.process).toBeNull();
  });

  it("sorts by port so the table does not reorder itself between polls", () => {
    const ports = mergeListeners(parseNetstat(NETSTAT), parseTasklist(TASKLIST)).map((l) => l.port);
    expect(ports).toEqual([...ports].sort((a, b) => a - b));
  });
});

describe("the URL offered for a port", () => {
  it("turns a wildcard bind into localhost, which is a link that works", () => {
    // `http://0.0.0.0:5173` fails outright on Windows and works by accident elsewhere.
    expect(browsableHost("0.0.0.0")).toBe("localhost");
    expect(browsableHost("::")).toBe("localhost");
  });

  it("brackets an IPv6 loopback address so it can go in a URL", () => {
    expect(browsableHost("::1")).toBe("[::1]");
  });

  it("leaves an ordinary address alone", () => {
    expect(browsableHost("127.0.0.1")).toBe("127.0.0.1");
  });
});
