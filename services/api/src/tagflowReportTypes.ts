import type { IncludedProviderId } from "./includedProviders.ts";
import type { AudienceDimension } from "./modelAudience.ts";

export type ModelRequestOutcome = "pending" | "success" | "provider_error" | "relay_error" | "rejected" | "cancelled";
export type ModelRequestSource = "chat" | "agent" | "completion" | "edit" | "admin-test" | "unknown";
export const MODEL_FEEDBACK_CATEGORIES = ["quality", "instructions", "tools", "speed", "reliability", "other"] as const;
export type ModelFeedbackCategory = typeof MODEL_FEEDBACK_CATEGORIES[number];
export type ModelFeedbackRating = "helpful" | "not-helpful";

export interface ModelIdentity {
  modelId: string;
  modelName: string;
  provider: IncludedProviderId;
  upstreamModel: string;
}

/** Operational metadata only. No messages, tool arguments, paths or provider errors. */
export interface ModelRequestRecord extends ModelIdentity {
  id: string;
  uid: string;
  startedAt: number;
  finishedAt: number | null;
  providerStartedAt: number | null;
  outcome: ModelRequestOutcome;
  errorCode: string | null;
  upstreamStatus: number | null;
  source: ModelRequestSource;
  country?: string;
  aiPersona?: string;
  useCase?: string;
  platform?: string;
  streamed: boolean;
  toolsOffered: boolean;
  toolCalls: number;
  finishReason: string | null;
  contextWindow: number;
  requestedOutput: number;
  estimatedInput: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimated: boolean;
  durationMs: number | null;
  firstTokenMs: number | null;
  /** Input tokens the provider served from its prompt cache; absent when it did not say. */
  cachedInputTokens?: number | null;
}

export interface ModelFeedbackRecord {
  requestId: string;
  uid: string;
  rating: ModelFeedbackRating;
  category: ModelFeedbackCategory;
  comment: string;
  shareWithProvider: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelReportMetrics {
  attempts: number;
  providerCalls: number;
  successes: number;
  providerErrors: number;
  relayErrors: number;
  rejected: number;
  cancelled: number;
  unfinished: number;
  activeUsers: number;
  repeatUsers: number;
  newUsers: number;
  returningUsers: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimatedRequests: number;
  toolRequests: number;
  toolCalls: number;
  streamedRequests: number;
  outputLimitStops: number;
  refusals: number;
  peakRpm: number;
  peakTpm: number;
  peakConcurrency: number;
  latencySamples: number;
  firstTokenSamples: number;
  throughputSamples: number;
  durationP50: number | null;
  durationP95: number | null;
  firstTokenP50: number | null;
  firstTokenP95: number | null;
  inputP50: number | null;
  inputP95: number | null;
  outputP50: number | null;
  outputP95: number | null;
  outputTpsP50: number | null;
  outputTpsP95: number | null;
  helpful: number;
  notHelpful: number;
  feedbackUsers: number;
}

export interface ModelReportDay {
  day: string;
  attempts: number;
  successes: number;
  providerErrors: number;
  rejected: number;
  activeUsers: number;
  inputTokens: number;
  outputTokens: number;
  helpful: number;
  notHelpful: number;
}

export interface ModelReport extends ModelIdentity {
  configuration?: { contextWindow: number; inputLimit: number; outputLimit: number; enabled: boolean };
  audience?: Record<AudienceDimension, ModelAudienceSegment[]>;
  current: ModelReportMetrics;
  previous: ModelReportMetrics;
  daily: ModelReportDay[];
  errors: { outcome: ModelRequestOutcome; code: string; upstreamStatus: number | null; count: number; firstAt: number; lastAt: number }[];
  sources: { source: ModelRequestSource; requests: number }[];
  hourly: { hour: number; requests: number }[];
  inputBands: { band: string; requests: number }[];
  feedbackCategories: { category: ModelFeedbackCategory; helpful: number; notHelpful: number }[];
  sharedComments: { at: number; rating: ModelFeedbackRating; category: ModelFeedbackCategory; comment: string }[];
  sharedCommentCount: number;
}

export interface ModelAudienceSegment {
  value: string;
  requests: number;
  activeUsers: number;
  successes: number;
  providerErrors: number;
  inputTokens: number;
  outputTokens: number;
  previousRequests: number;
  previousActiveUsers: number;
}

export interface ModelReportRange {
  from: string;
  to: string;
  fromAt: number;
  toAt: number;
  previousFromAt: number;
  previousToAt: number;
}

export interface ModelReportData {
  collectionStartedAt: number | null;
  audienceStartedAt?: number | null;
  models: ModelReport[];
}

export interface ModelReportResponse extends ModelReportData {
  range: ModelReportRange;
  generatedAt: number;
  definitions: Record<string, string>;
}
