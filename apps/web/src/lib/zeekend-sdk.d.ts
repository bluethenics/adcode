/**
 * The part of Zeekend's SDK (@zeekend/sdk, plain JavaScript without types) the sponsored page
 * uses: a client, one slot request, and the SDK's own unit, which draws the placement and
 * reports its viewable impression and click.
 */
declare module "@zeekend/sdk" {
  export interface ZeekendSlot {
    slotId: string;
    format: string;
    disclosure?: string;
    [field: string]: unknown;
  }
  export interface ZeekendClient {
    request(options: {
      placementId?: string;
      context: { type: "conversation"; question: string; answer: string | null; conversationId?: string };
      dimensions?: { maxWidth?: number; maxHeight?: number };
    }): Promise<{ slot: ZeekendSlot | null; reason: string | null }>;
    render(slot: ZeekendSlot, mount: HTMLElement, options?: { theme?: Record<string, string> }): HTMLElement | null;
    /** Report a viewable impression (half the unit on screen for a second) when drawing the slot yourself. Once per slot. */
    impression(slot: ZeekendSlot): Promise<void>;
    /** Report a click on a slot drawn yourself. Once per slot. */
    click(slot: ZeekendSlot): Promise<void>;
  }
  export const Zeekend: {
    client(config: {
      publisherKey: string;
      sessionId?: string;
      keepPinned?: boolean;
      transport?: (payload: Record<string, unknown>) => unknown;
    }): ZeekendClient;
  };
}
