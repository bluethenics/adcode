/** Human-facing formatting shared by every screen. */

export function formatMicros(micros: number, options: { compact?: boolean } = {}): string {
  const dollars = Math.max(0, micros) / 1_000_000;
  if (options.compact === true) {
    if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
    if (dollars >= 10) return `$${dollars.toFixed(0)}`;
    return `$${dollars.toFixed(2)}`;
  }
  return `$${dollars.toFixed(dollars >= 1 ? 2 : 4)}`;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function shortDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(1, Math.max(0, part / whole));
}

export function truncateText(value: string, maximum: number): string {
  const text = String(value);
  if (text.length <= maximum) return text;
  if (maximum <= 1) return "…";
  return `${text.slice(0, maximum - 1)}…`;
}

export function parseDuration(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(value.trim());
  if (match === null) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60_000;
  return amount * 3_600_000;
}

export function titleFrom(text: string, limit = 48): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return "New conversation";
  return truncateText(cleaned, limit);
}

export function isoDay(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
