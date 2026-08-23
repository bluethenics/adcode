/**
 * Reading what the inspector says.
 *
 * Node's inspector speaks Chrome DevTools Protocol - the same protocol the smoke run drives
 * the editor with - so debugging JavaScript needs no adapter binary, no extension, and no
 * download. That is the whole reason this is built on CDP rather than DAP: DAP would be the
 * conventional choice and would require shipping or fetching `js-debug`, which is exactly
 * the marketplace this product does not have.
 *
 * Everything here is a function from a protocol message to something the editor can draw.
 * The socket, the child process and the request ids belong to the shell.
 */
import { fileUrlToPath } from "./paths.ts";
import type { PauseReason, Scope, StackFrame, Variable } from "./types.ts";

/** CDP's own words for why execution stopped, mapped to ours. */
export function pauseReasonOf(raw: unknown): PauseReason {
  switch (raw) {
    case "other":
      // What CDP sends for an ordinary breakpoint hit, confusingly.
      return "breakpoint";
    case "step":
      return "step";
    case "exception":
    case "promiseRejection":
      return "exception";
    case "Break on start":
      return "entry";
    default:
      return "other";
  }
}

interface RawLocation {
  readonly lineNumber?: unknown;
  readonly columnNumber?: unknown;
}

interface RawCallFrame {
  readonly callFrameId?: unknown;
  readonly functionName?: unknown;
  readonly url?: unknown;
  readonly location?: RawLocation;
  readonly scopeChain?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The call stack from a `Debugger.paused` event.
 *
 * Positions arrive zero-based and leave one-based; getting that wrong puts every breakpoint
 * one line above where the user put it, which looks like the debugger is lying.
 */
export function framesFrom(params: unknown, urlFor: (scriptId: string) => string | undefined): StackFrame[] {
  if (!isRecord(params)) return [];

  const raw = params["callFrames"];
  if (!Array.isArray(raw)) return [];

  const frames: StackFrame[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const frame = entry as RawCallFrame;

    const id = frame.callFrameId;
    if (typeof id !== "string") continue;

    const location: Record<string, unknown> = isRecord(frame.location) ? frame.location : {};
    const rawLine = location["lineNumber"];
    const rawColumn = location["columnNumber"];
    const line = typeof rawLine === "number" ? rawLine : 0;
    const column = typeof rawColumn === "number" ? rawColumn : 0;

    // The frame's own url, or the one the script was announced with. Eval'd code has
    // neither, and gets a null path rather than an invented one.
    const scriptId = isRecord(frame.location) ? frame.location["scriptId"] : undefined;
    const url =
      typeof frame.url === "string" && frame.url.length > 0
        ? frame.url
        : typeof scriptId === "string"
          ? (urlFor(scriptId) ?? "")
          : "";

    frames.push({
      id,
      name: typeof frame.functionName === "string" && frame.functionName.length > 0
        ? frame.functionName
        : "(anonymous)",
      path: fileUrlToPath(url),
      line: line + 1,
      column: column + 1,
    });
  }

  return frames;
}

/**
 * The scopes of one call frame.
 *
 * Ordered as the runtime sends them, which is innermost first - the order somebody reading
 * a paused program actually wants.
 */
export function scopesFrom(frame: unknown): Scope[] {
  if (!isRecord(frame)) return [];

  const chain = frame["scopeChain"];
  if (!Array.isArray(chain)) return [];

  const scopes: Scope[] = [];

  for (const entry of chain) {
    if (!isRecord(entry)) continue;

    const kind = typeof entry["type"] === "string" ? entry["type"] : "unknown";

    // `global` is thousands of entries nobody is looking for; it is kept but named so the
    // panel can leave it collapsed.
    const object = isRecord(entry["object"]) ? entry["object"] : {};
    const objectId = typeof object["objectId"] === "string" ? object["objectId"] : null;

    const named = typeof entry["name"] === "string" && entry["name"].length > 0 ? entry["name"] : null;

    scopes.push({
      name: named ?? kind.charAt(0).toUpperCase() + kind.slice(1),
      kind,
      objectId,
    });
  }

  return scopes;
}

/**
 * Render a remote object as the one line a variables panel shows.
 *
 * The protocol gives a description for most things and nothing at all for some. Producing
 * the display string here rather than in the panel means one implementation of "what does
 * undefined look like", instead of one per surface.
 */
export function describeValue(raw: unknown): { value: string; type: string; objectId?: string } {
  if (!isRecord(raw)) return { value: "", type: "unknown" };

  const type = typeof raw["type"] === "string" ? raw["type"] : "unknown";
  const subtype = typeof raw["subtype"] === "string" ? raw["subtype"] : undefined;
  const objectId = typeof raw["objectId"] === "string" ? raw["objectId"] : undefined;

  if (subtype === "null") return { value: "null", type: "null" };
  if (type === "undefined") return { value: "undefined", type: "undefined" };

  // A string's `value` arrives unquoted, and an unquoted string in a list of values is
  // indistinguishable from an identifier.
  if (type === "string") return { value: JSON.stringify(raw["value"] ?? ""), type };

  if (type === "number" || type === "boolean") return { value: String(raw["value"]), type };

  const description = typeof raw["description"] === "string" ? raw["description"] : type;
  return objectId === undefined ? { value: description, type } : { value: description, type, objectId };
}

/** The properties of an object, as rows. */
export function propertiesFrom(result: unknown): Variable[] {
  if (!isRecord(result)) return [];

  const raw = result["result"];
  if (!Array.isArray(raw)) return [];

  const variables: Variable[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) continue;

    const name = typeof entry["name"] === "string" ? entry["name"] : null;
    if (name === null) continue;

    // Accessors have no value until they are called, and calling a getter to fill a panel
    // is how a debugger changes the program it is inspecting.
    if (entry["get"] !== undefined && entry["value"] === undefined) {
      variables.push({ name, value: "(getter)", type: "accessor" });
      continue;
    }

    const described = describeValue(entry["value"]);
    variables.push({ name, ...described });
  }

  return variables;
}
