import type { FeatureRecord } from "@adcode/help";
import type { UniversalSearchItem } from "@adcode/search";
import type { QuickOpenHit, RecentFolderView } from "../../shared/api.ts";
import type { Command } from "./commands.ts";
import type { WorkspaceSymbolHit } from "../panels/workspaceSymbols.ts";

export type UniversalDesktopAction =
  | { readonly kind: "feature"; readonly featureId: string }
  | { readonly kind: "command"; readonly command: string; readonly arg?: string }
  | { readonly kind: "file"; readonly path: string }
  | {
      readonly kind: "symbol";
      readonly path: string;
      readonly line: number;
      readonly column: number;
    };

export interface UniversalDesktopItem extends UniversalSearchItem {
  readonly action: UniversalDesktopAction;
  readonly helpId?: string;
}

export function featureUniversalItems(
  features: readonly FeatureRecord[],
): readonly UniversalDesktopItem[] {
  return features.map((feature) => ({
    id: `feature:${feature.entry.id}`,
    kind: "feature",
    title: feature.entry.title,
    detail: feature.entry.plain,
    keywords: [
      feature.entry.id,
      feature.entry.why,
      feature.entry.how,
      ...feature.keywords,
      ...feature.actions.flatMap((action) =>
        action.kind === "command" ? [action.command, action.label] : [action.settingId, action.label],
      ),
    ],
    action: { kind: "feature", featureId: feature.entry.id },
    helpId: feature.entry.id,
  }));
}

export function commandUniversalItems(
  commands: readonly Pick<Command, "id" | "title">[],
): readonly UniversalDesktopItem[] {
  return commands.map((command) => ({
    id: `command:${command.id}`,
    kind: "command",
    title: command.title,
    detail: command.id,
    keywords: [command.id],
    action: { kind: "command", command: command.id },
  }));
}

export function fileUniversalItems(
  files: readonly QuickOpenHit[],
): readonly UniversalDesktopItem[] {
  return files.map((file) => ({
    id: `file:${file.path}`,
    kind: "file",
    title: file.path.split(/[\\/]/).pop() ?? file.path,
    detail: file.path,
    keywords: [file.path],
    action: { kind: "file", path: file.path },
  }));
}

export function recentUniversalItems(
  recents: readonly RecentFolderView[],
): readonly UniversalDesktopItem[] {
  return recents.map((recent) => ({
    id: `recent:${recent.path}`,
    kind: "recent",
    title: recent.name,
    detail: recent.path,
    keywords: [recent.path, "folder", "workspace", "recent"],
    action: {
      kind: "command",
      command: "workspace.openRecentAt",
      arg: recent.path,
    },
  }));
}

export function symbolUniversalItems(
  symbols: readonly WorkspaceSymbolHit[],
): readonly UniversalDesktopItem[] {
  return symbols.map((symbol) => ({
    id: `symbol:${symbol.path}:${String(symbol.line)}:${String(symbol.column)}:${symbol.name}`,
    kind: "symbol",
    title: symbol.name,
    detail: `${symbol.kind} · ${symbol.path}:${String(symbol.line)}`,
    keywords: [symbol.kind, symbol.path],
    action: {
      kind: "symbol",
      path: symbol.path,
      line: symbol.line,
      column: symbol.column,
    },
  }));
}
