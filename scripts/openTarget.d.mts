export type OpenTargetValidation =
  | { readonly ok: true; readonly target: string | null }
  | { readonly ok: false; readonly message: string };

export function validateOpenTarget(
  arguments_: readonly string[],
  cwd: string,
): Promise<OpenTargetValidation>;
