/**
 * The application menu, for the platform that has one.
 *
 * macOS puts menus in the system bar, so there this builds a native `Menu` from the
 * shared model and forwards each choice to the focused window. Windows and Linux use a
 * hidden title bar (§3), which leaves a native menu nowhere to live - the renderer draws
 * its own bar from the same model, so the two cannot disagree about what exists.
 *
 * Accelerators are registered here on every platform regardless, because a menu is where
 * Electron learns about shortcuts, and a shortcut that only works while the editor has
 * focus is not the same shortcut.
 *
 * Rebuilt rather than built once, because the recent folders are part of the model now.
 * `installApplicationMenu` is therefore also the refresh: anything that changes the list
 * calls it again, and Electron replaces the menu wholesale.
 */
import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { buildMenuBar, stripMnemonic, type MenuEntry } from "../shared/menuModel.ts";
import { recentFolders } from "./recents.ts";

/** Send a command to whichever window the user is actually looking at. */
function dispatch(command: string, arg?: string): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.send(CHANNELS.menuCommand, command, arg);
}

function toElectron(entries: readonly MenuEntry[]): MenuItemConstructorOptions[] {
  return entries.map((entry): MenuItemConstructorOptions => {
    if ("kind" in entry && entry.kind === "separator") return { type: "separator" };

    if ("kind" in entry && entry.kind === "submenu") {
      return { label: stripMnemonic(entry.label), submenu: toElectron(entry.items) };
    }

    // Roles are used where Electron's own implementation is the correct one: clipboard
    // and undo/redo have to reach the focused native control, which a renderer message
    // cannot do reliably.
    if (entry.role !== undefined) {
      const role = entry.role as NonNullable<MenuItemConstructorOptions["role"]>;
      return {
        label: stripMnemonic(entry.label),
        role,
        ...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator }),
      };
    }

    return {
      label: stripMnemonic(entry.label),
      ...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator }),
      ...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
      // Where a recent folder is. Electron has nowhere to draw a second string on a row,
      // so it becomes the tooltip rather than being crammed into the label.
      ...(entry.detail === undefined ? {} : { toolTip: entry.detail }),
      click: () => dispatch(entry.command, entry.arg),
    };
  });
}

/**
 * Build the menu and install it.
 *
 * Called again whenever the recents change. A failure to read them yields a menu with an
 * empty list rather than no menu at all - the recents are the least important thing on it.
 */
export async function installApplicationMenu(): Promise<void> {
  const recents = await recentFolders().catch(() => []);

  const template: MenuItemConstructorOptions[] = buildMenuBar({ recents }).map((top) => ({
    label: stripMnemonic(top.label),
    submenu: toElectron(top.items),
  }));

  if (process.platform === "darwin") {
    // macOS expects the app's own menu first, and expects Quit and Preferences to live
    // in it rather than under File.
    template.unshift({
      label: app.name,
      submenu: [
        { label: "About ADCode", click: () => dispatch("help.about") },
        { type: "separator" },
        { label: "Preferences…", accelerator: "Cmd+,", click: () => dispatch("settings.open") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }

  // Windows and Linux: the renderer draws the bar, but the accelerators still have to be
  // registered, so the menu is set and then hidden rather than not built at all.
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  for (const window of BrowserWindow.getAllWindows()) window.setMenuBarVisibility(false);
}
