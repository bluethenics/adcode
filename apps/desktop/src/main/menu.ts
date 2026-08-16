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
 */
import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { MENU_BAR, type MenuEntry } from "../shared/menuModel.ts";

/** Send a command to whichever window the user is actually looking at. */
function dispatch(command: string): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.send(CHANNELS.menuCommand, command);
}

function toElectron(entries: readonly MenuEntry[]): MenuItemConstructorOptions[] {
  return entries.map((entry): MenuItemConstructorOptions => {
    if ("kind" in entry && entry.kind === "separator") return { type: "separator" };

    if ("kind" in entry && entry.kind === "submenu") {
      return { label: entry.label, submenu: toElectron(entry.items) };
    }

    // Roles are used where Electron's own implementation is the correct one: clipboard
    // and undo/redo have to reach the focused native control, which a renderer message
    // cannot do reliably.
    if (entry.role !== undefined) {
      const role = entry.role as NonNullable<MenuItemConstructorOptions["role"]>;
      return {
        label: entry.label,
        role,
        ...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator }),
      };
    }

    return {
      label: entry.label,
      ...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator }),
      click: () => dispatch(entry.command),
    };
  });
}

export function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = MENU_BAR.map((top) => ({
    label: top.label,
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
