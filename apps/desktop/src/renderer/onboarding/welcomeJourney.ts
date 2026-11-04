/** Sign-in is required on every account change; the first-build tour is remembered separately. */
export async function showFirstOnboarding(
  account: { wait(): Promise<void> },
  onboarding: { completed(): Promise<boolean>; open(): void },
  settle = () => new Promise<void>(resolve => window.setTimeout(resolve, 900)),
): Promise<boolean> {
  await account.wait();
  if (await onboarding.completed()) return false;
  await settle();
  // A sign-out during the welcome delay must not put onboarding on top of sign-in.
  await account.wait();
  if (await onboarding.completed()) return false;
  onboarding.open();
  return true;
}
