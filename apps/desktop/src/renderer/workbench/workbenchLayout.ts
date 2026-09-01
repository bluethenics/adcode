export const SIDEBAR_OVERLAY_BREAKPOINT = 820;

export type SidebarViewId =
  | "explorer"
  | "search"
  | "structure"
  | "scm"
  | "earnings"
  | "features"
  | "settings";

export type SidebarMode = "docked" | "overlay";

export interface WorkbenchLayoutState {
  readonly activeSidebarView: SidebarViewId;
  readonly sidebarOpen: boolean;
  readonly dockedSidebarOpen: boolean;
  readonly sidebarMode: SidebarMode;
  readonly panelMaximized: boolean;
}

export type WorkbenchLayoutEvent =
  | { readonly type: "show-sidebar"; readonly view: SidebarViewId }
  | { readonly type: "restore-sidebar-view"; readonly view: SidebarViewId }
  | { readonly type: "toggle-sidebar"; readonly view: SidebarViewId }
  | { readonly type: "close-sidebar" }
  | { readonly type: "viewport"; readonly width: number }
  | { readonly type: "toggle-panel-maximized" }
  | { readonly type: "restore-panel" };

const sidebarModeFor = (width: number): SidebarMode =>
  width < SIDEBAR_OVERLAY_BREAKPOINT ? "overlay" : "docked";

export function initialWorkbenchLayout(
  width: number,
  activeSidebarView: SidebarViewId = "explorer",
): WorkbenchLayoutState {
  const sidebarMode = sidebarModeFor(width);

  return {
    activeSidebarView,
    sidebarOpen: sidebarMode === "docked",
    dockedSidebarOpen: true,
    sidebarMode,
    panelMaximized: false,
  };
}

export function reduceWorkbenchLayout(
  state: WorkbenchLayoutState,
  event: WorkbenchLayoutEvent,
): WorkbenchLayoutState {
  switch (event.type) {
    case "restore-sidebar-view":
      // Session restore chooses the view without changing disclosure. In particular, a
      // narrow launch must not slide a drawer over the editor before the user asks for it.
      return { ...state, activeSidebarView: event.view };

    case "show-sidebar":
      return {
        ...state,
        activeSidebarView: event.view,
        sidebarOpen: true,
        dockedSidebarOpen: state.sidebarMode === "docked" ? true : state.dockedSidebarOpen,
      };

    case "toggle-sidebar":
      if (state.sidebarOpen && state.activeSidebarView === event.view) {
        return {
          ...state,
          sidebarOpen: false,
          dockedSidebarOpen: state.sidebarMode === "docked" ? false : state.dockedSidebarOpen,
        };
      }

      return {
        ...state,
        activeSidebarView: event.view,
        sidebarOpen: true,
        dockedSidebarOpen: state.sidebarMode === "docked" ? true : state.dockedSidebarOpen,
      };

    case "close-sidebar":
      return {
        ...state,
        sidebarOpen: false,
        dockedSidebarOpen: state.sidebarMode === "docked" ? false : state.dockedSidebarOpen,
      };

    case "viewport": {
      const sidebarMode = sidebarModeFor(event.width);
      if (sidebarMode === state.sidebarMode) return state;

      return {
        ...state,
        sidebarMode,
        sidebarOpen: sidebarMode === "docked" ? state.dockedSidebarOpen : false,
      };
    }

    case "toggle-panel-maximized":
      return { ...state, panelMaximized: !state.panelMaximized };

    case "restore-panel":
      return state.panelMaximized ? { ...state, panelMaximized: false } : state;
  }
}
