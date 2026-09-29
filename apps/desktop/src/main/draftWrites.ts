/**
 * Recovery drafts still on their way to disk.
 *
 * The renderer sends drafts fire-and-forget, which is right while someone types. It is
 * wrong for one moment: "Restart now" for an update, where the app is about to quit and a
 * draft still in flight would be the only copy of that text. The restart waits here.
 */
const inFlight = new Set<Promise<void>>();

export function trackDraftWrite(write: Promise<unknown>): void {
  const settled = write.then(
    () => undefined,
    () => undefined,
  );
  inFlight.add(settled);
  void settled.then(() => inFlight.delete(settled));
}

export async function draftWritesSettled(): Promise<void> {
  await Promise.all([...inFlight]);
}
