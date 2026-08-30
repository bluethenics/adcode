import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cancelAiAutomation,
  claimAiAutomation,
  completeAiAutomation,
  confirmMissedAiAutomation,
  createAiAutomation,
  retryAiAutomation,
  missAiAutomation,
  type AiAutomation,
} from "@adcode/ai";

export interface CreateAiAutomationRequest {
  readonly message: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly dueAt: number;
}

export interface AiAutomationService {
  create(workspaceRoot: string, input: CreateAiAutomationRequest): Promise<AiAutomation>;
  read(id: string): Promise<AiAutomation | null>;
  list(workspaceRoot: string): Promise<AiAutomation[]>;
  claimDue(workspaceRoot: string): Promise<AiAutomation | null>;
  complete(workspaceRoot: string, id: string): Promise<AiAutomation>;
  miss(workspaceRoot: string, id: string, reason: string): Promise<AiAutomation>;
  retry(workspaceRoot: string, id: string, reason: string, dueAt: number): Promise<AiAutomation>;
  cancel(workspaceRoot: string, id: string): Promise<AiAutomation>;
  confirmMissed(workspaceRoot: string, id: string): Promise<AiAutomation>;
  recover(): Promise<void>;
  missInactive(activeWorkspaceRoot: string | null, reason?: string): Promise<void>;
}

export interface AiAutomationServiceOptions {
  readonly userDataDirectory: string;
  readonly now?: () => number;
  readonly id?: () => string;
}

const AUTOMATION_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{2,127}$/;
const workspaceIdentity = (root: string): string =>
  `workspace-${createHash("sha256").update(root).digest("hex").slice(0, 32)}`;

function validItem(value: unknown): value is AiAutomation {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["id"] === "string" &&
    AUTOMATION_ID.test(item["id"]) &&
    typeof item["workspaceId"] === "string" &&
    WORKSPACE_ID.test(item["workspaceId"]) &&
    typeof item["message"] === "string" &&
    item["message"].length > 0 &&
    item["message"].length <= 8_000 &&
    typeof item["targetId"] === "string" &&
    TARGET_ID.test(item["targetId"]) &&
    typeof item["targetLabel"] === "string" &&
    item["targetLabel"].length > 0 &&
    item["targetLabel"].length <= 120 &&
    ["pending", "delivering", "missed", "delivered", "cancelled"].includes(String(item["state"])) &&
    Number.isSafeInteger(item["dueAt"]) &&
    Number.isSafeInteger(item["attempts"]) &&
    (item["attempts"] as number) >= 0 &&
    (item["lastError"] === null ||
      (typeof item["lastError"] === "string" && item["lastError"].length <= 500)) &&
    typeof item["createdAt"] === "number" &&
    typeof item["updatedAt"] === "number"
  );
}

export function createAiAutomationService(options: AiAutomationServiceOptions): AiAutomationService {
  const now = options.now ?? Date.now;
  const makeId = options.id ?? (() => `automation-${randomUUID()}`);
  const root = join(options.userDataDirectory, "ai-automations");
  const target = join(root, "items.json");
  let serial = Promise.resolve();

  async function load(): Promise<AiAutomation[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
      if (!Array.isArray(parsed) || !parsed.every(validItem)) {
        throw new Error("AI automation store is corrupt");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async function save(items: readonly AiAutomation[]): Promise<void> {
    await mkdir(root, { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(items, null, 2), "utf8");
    await rename(temporary, target);
  }

  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = serial.then(operation, operation);
    serial = next.then(() => undefined, () => undefined);
    return next;
  }

  async function owned(items: readonly AiAutomation[], workspaceRoot: string, id: string): Promise<AiAutomation> {
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined || item.workspaceId !== workspaceIdentity(workspaceRoot)) {
      throw new Error("Automation does not belong to this workspace");
    }
    return item;
  }

  return {
    create(workspaceRoot, input) {
      return mutate(async () => {
        const items = await load();
        if (items.filter((item) => item.state === "pending" || item.state === "delivering").length >= 200) {
          throw new Error("Too many pending AI messages");
        }
        const item = createAiAutomation({
          id: makeId(),
          workspaceId: workspaceIdentity(workspaceRoot),
          ...input,
          now: now(),
        });
        await save([...items, item]);
        return item;
      });
    },

    async read(id) {
      if (!AUTOMATION_ID.test(id)) return null;
      return (await load()).find((item) => item.id === id) ?? null;
    },

    async list(workspaceRoot) {
      const workspaceId = workspaceIdentity(workspaceRoot);
      return (await load())
        .filter((item) => item.workspaceId === workspaceId)
        .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);
    },

    claimDue(workspaceRoot) {
      return mutate(async () => {
        let items = await load();
        const workspaceId = workspaceIdentity(workspaceRoot);
        const missedIds = new Set(
          items
            .filter(
              (item) => item.workspaceId !== workspaceId && item.state === "pending" && item.dueAt <= now(),
            )
            .map((item) => item.id),
        );
        if (missedIds.size > 0) {
          items = items.map((item) =>
            missedIds.has(item.id)
              ? { ...missAiAutomation(item, now()), lastError: "Project was not active at delivery time" }
              : item,
          );
          await save(items);
        }
        const candidate = items
          .filter((item) => item.workspaceId === workspaceId && item.state === "pending" && item.dueAt <= now())
          .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt)[0];
        if (candidate === undefined) return null;
        const claimed = claimAiAutomation(candidate, now());
        if (claimed === null) return null;
        await save(items.map((item) => (item.id === claimed.id ? claimed : item)));
        return claimed;
      });
    },

    complete(workspaceRoot, id) {
      return mutate(async () => {
        const items = await load();
        const item = await owned(items, workspaceRoot, id);
        const completed = completeAiAutomation(item, now());
        await save(items.map((candidate) => (candidate.id === id ? completed : candidate)));
        return completed;
      });
    },

    miss(workspaceRoot, id, reason) {
      return mutate(async () => {
        const items = await load();
        const item = await owned(items, workspaceRoot, id);
        const message = reason.trim().slice(0, 500);
        if (message.length === 0) throw new Error("Missed-delivery reason is required");
        const missed = { ...missAiAutomation(item, now()), lastError: message };
        await save(items.map((candidate) => (candidate.id === id ? missed : candidate)));
        return missed;
      });
    },

    retry(workspaceRoot, id, reason, dueAt) {
      return mutate(async () => {
        const items = await load();
        const item = await owned(items, workspaceRoot, id);
        const retried = retryAiAutomation(item, reason, dueAt, now());
        await save(items.map((candidate) => (candidate.id === id ? retried : candidate)));
        return retried;
      });
    },

    cancel(workspaceRoot, id) {
      return mutate(async () => {
        const items = await load();
        const item = await owned(items, workspaceRoot, id);
        const cancelled = cancelAiAutomation(item, now());
        await save(items.map((candidate) => (candidate.id === id ? cancelled : candidate)));
        return cancelled;
      });
    },

    confirmMissed(workspaceRoot, id) {
      return mutate(async () => {
        const items = await load();
        const item = await owned(items, workspaceRoot, id);
        const confirmed = confirmMissedAiAutomation(item, now());
        await save(items.map((candidate) => (candidate.id === id ? confirmed : candidate)));
        return confirmed;
      });
    },

    recover() {
      return mutate(async () => {
        const items = await load();
        const recovered = items.map((item) => {
          if (item.state !== "delivering" && !(item.state === "pending" && item.dueAt < now())) {
            return item;
          }
          return {
            ...missAiAutomation(item, now()),
            lastError:
              item.state === "delivering"
                ? "ADCode closed before delivery finished"
                : "Delivery time passed while ADCode was closed",
          };
        });
        await save(recovered);
      });
    },

    missInactive(activeWorkspaceRoot, reason = "Project was not active at delivery time") {
      return mutate(async () => {
        const items = await load();
        const activeId = activeWorkspaceRoot === null ? null : workspaceIdentity(activeWorkspaceRoot);
        const next = items.map((item) =>
          item.state === "pending" && item.dueAt <= now() && item.workspaceId !== activeId
            ? { ...missAiAutomation(item, now()), lastError: reason.slice(0, 500) }
            : item,
        );
        await save(next);
      });
    },
  };
}
