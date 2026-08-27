export interface DemandView {
  clearingCpmMicros: string;
  activeCampaigns: number;
  demandLevel: "low" | "medium" | "high";
  floorCpmMicros: string;
  asOf: number;
  history: Array<{ at: number; clearingCpmMicros: string }>;
}

export async function fetchDemand(signal?: AbortSignal): Promise<DemandView | null> {
  try {
    const response = await fetch("/v1/demand", {
      cache: "no-store",
      ...(signal === undefined ? {} : { signal }),
    });
    return response.ok ? ((await response.json()) as DemandView) : null;
  } catch {
    return null;
  }
}
