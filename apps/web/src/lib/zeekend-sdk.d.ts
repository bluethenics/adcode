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
