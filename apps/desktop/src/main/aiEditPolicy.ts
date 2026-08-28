/**
 * A renderer setting write is not sufficient authority for automatic project writes.
 * The IPC layer uses this decision to require an OS-native confirmation that model or
 * web content inside the renderer cannot click on the user's behalf.
 */
export function requiresTrustedEditConfirmation(
  id: string,
  next: boolean | string,
  current: boolean | string | undefined,
): boolean {
  return id === "adcode.ai.editPolicy" && next === "trusted" && current !== "trusted";
}
