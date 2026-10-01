export interface NoticePackage {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly text: string | null;
}

export function packageNameOf(specifier: string): string | null;

export function bareImports(source: string): string[];

export function licenceOf(manifest: { license?: unknown; licenses?: unknown }): string;

export function renderNotices(packages: readonly NoticePackage[]): string;

export function collectPackages(root: string): NoticePackage[];

export function copiedNotices(root: string): string[];
