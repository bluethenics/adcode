export type PopupId =
  | "source-control"
  | "chat"
  | "features"
  | "settings"
  | "structure"
  | "earnings"
  | "connect"
  | "help";

export interface PopupLayerState {
  readonly primary: PopupId | null;
  readonly dependent: PopupId | null;
}

export type PopupLayerEvent =
  | { readonly type: "open-primary"; readonly id: PopupId }
  | { readonly type: "toggle-primary"; readonly id: PopupId }
  | { readonly type: "open-dependent"; readonly id: PopupId; readonly owner: PopupId }
  | { readonly type: "close"; readonly id: PopupId }
  | { readonly type: "escape" };

export const initialPopupLayer = (): PopupLayerState => ({ primary: null, dependent: null });

export function reducePopupLayer(
  state: PopupLayerState,
  event: PopupLayerEvent,
): PopupLayerState {
  switch (event.type) {
    case "open-primary":
      return { primary: event.id, dependent: null };
    case "toggle-primary":
      return state.primary === event.id && state.dependent === null
        ? initialPopupLayer()
        : { primary: event.id, dependent: null };
    case "open-dependent":
      return state.primary === event.owner ? { ...state, dependent: event.id } : state;
    case "close":
      if (state.dependent === event.id) return { ...state, dependent: null };
      if (state.primary === event.id) return initialPopupLayer();
      return state;
    case "escape":
      if (state.dependent !== null) return { ...state, dependent: null };
      return initialPopupLayer();
  }
}
