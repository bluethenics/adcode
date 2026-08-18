/**
 * The command registry.
 *
 * Menu items, keyboard shortcuts, and (later) the palette all resolve to a command id.
 * Having one table means a menu entry and its shortcut cannot drift apart, and it means
 * "what can this editor do?" has a single answer that can be read in one screen.
 *
 * Most editing commands are Monaco actions. Those are triggered by id rather than
 * reimplemented, because Monaco's own multi-cursor and selection handling is the thing
 * §2 says we are here to use rather than rebuild.
 */

export interface Command {
  readonly id: string;
  readonly title: string;
  /**
   * `arg` is what the command acts on when the caller has something specific in mind - a
   * recent folder's path, from the row in the File menu that names it.
   *
   * One command taking an argument rather than one command per folder: the palette lists
   * every registered command, and ten of these would crowd out the ones you can type.
   */
  readonly run: (arg?: string) => void | Promise<void>;
}

export interface CommandRegistry {
  register(command: Command): void;
  /** Register a command that just triggers a Monaco action. */
  registerEditorAction(id: string, title: string, actionId: string): void;
  run(id: string, arg?: string): void;
  has(id: string): boolean;
  all(): Command[];
}

export function createCommandRegistry(deps: {
  readonly runEditorAction: (actionId: string) => void;
  readonly onUnknown: (id: string) => void;
}): CommandRegistry {
  const commands = new Map<string, Command>();

  return {
    register(command) {
      commands.set(command.id, command);
    },

    registerEditorAction(id, title, actionId) {
      commands.set(id, { id, title, run: () => deps.runEditorAction(actionId) });
    },

    run(id, arg) {
      const command = commands.get(id);
      if (command === undefined) {
        deps.onUnknown(id);
        return;
      }

      // Commands are fire-and-forget from the caller's point of view; a menu click must
      // not leave an unhandled rejection behind if one of them throws.
      void Promise.resolve(command.run(arg)).catch(() => deps.onUnknown(id));
    },

    has: (id) => commands.has(id),
    all: () => [...commands.values()].sort((a, b) => a.title.localeCompare(b.title)),
  };
}
