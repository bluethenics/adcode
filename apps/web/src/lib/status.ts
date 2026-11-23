/**
 * The public status page's data.
 *
 * Same shape and the same rule as `releases.ts`: read from the API so an incident posted
 * from the admin panel appears without a deploy, revalidated rather than cached forever,
 * and failing to null rather than to an error. A status page that 500s because its own
 * API is unreachable is worse than one that says so in a sentence.
 *
 * The shapes and parser live in `statusView.ts`, which has no imports, because the
 * header's live status is a client component and cannot pull in `next/cache` through
 * this file. They are re-exported here so the page and its tests keep one import.
 */
import { readApi } from "./apiRead";
import { parseStatusView, type StatusView } from "./statusView";

export {
  IMPACT_LABELS,
  INCIDENT_STATUS_LABELS,
  LEVEL_LABELS,
  shownLevel,
  parseStatusView,
  type StatusDay,
  type StatusCandle,
  type StatusIncident,
  type StatusIncidentUpdate,
  type StatusModel,
  type StatusView,
} from "./statusView";

export async function readStatus(): Promise<StatusView | null> {
  try {
    const response = await readApi("/v1/status", 60);
    if (!response.ok) return null;
    return parseStatusView(await response.json());
  } catch {
    return null;
  }
}
