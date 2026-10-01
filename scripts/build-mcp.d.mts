export const MCP_BUNDLE: {
  readonly entry: string;
  readonly outDir: string;
  readonly resourceDir: string;
  readonly file: string;
};

export function buildMcpBundle(outDir?: string): Promise<string>;
