/** Persistent application profile for a local source checkout. */
export function sourceProfile(
  repository: string,
  environment?: Readonly<Record<string, string | undefined>>,
  platform?: string,
  home?: string,
): string;
