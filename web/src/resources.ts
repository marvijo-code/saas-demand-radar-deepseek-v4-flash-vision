import { apiRequest } from "./api";

export type WindowKey = "24h" | "7d" | "30d";

export interface ScoreComponent {
  key: string;
  label: string;
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface ScoreBreakdown {
  total: number;
  components: ScoreComponent[];
}

export interface NeedSummary {
  id: number;
  title: string;
  summary: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  score: number;
  breakdown: ScoreBreakdown | null;
  rank: number | null;
  evidenceCount: number;
  platforms: string[];
}

export interface NeedListResponse {
  needs: NeedSummary[];
  total: number;
  page: number;
  pageSize: number;
  window: WindowKey;
}

export interface Evidence {
  recordId: number;
  externalId: string;
  platform: string;
  author: string;
  url: string;
  publishedAt: string;
  text: string;
  engagement: Record<string, number>;
  isRelevant: boolean | null;
  willingnessToPay: boolean;
  contacted: boolean;
}

export interface FeedbackRecord {
  id: number;
  need_id: number;
  evidence_id: number | null;
  target_type: string;
  relevant: number | null;
  willingness_to_pay: number;
  contacted: number;
  note: string | null;
  created_at: string;
  created_by_email: string | null;
  need_title?: string;
  record_author?: string | null;
  record_url?: string | null;
  record_text?: string | null;
}

export interface NeedDetail {
  need: {
    id: number;
    title: string;
    summary: string;
    status: string;
    created_at: string;
    updated_at: string;
  };
  window: WindowKey;
  score: ScoreBreakdown;
  evidence: Evidence[];
  trend: Array<{ window: WindowKey; score: number; evidenceCount: number }>;
  feedback: FeedbackRecord[];
}

export interface RunInfo {
  id: number;
  adapter: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  records_ingested: number;
  records_total: number;
  new_records: number;
  error: string | null;
  trigger: string;
}

export interface RankingVersion {
  id: number;
  version: number;
  label: string;
  created_at: string;
  note: string | null;
  triggered_by_feedback_id: number | null;
  created_by_email: string | null;
  change_count: number;
  weightsParsed: Record<string, unknown>;
}

export interface AuditEvent {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: string | null;
  created_at: string;
  user_email: string | null;
}

export interface TeamMember {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  created_at: string;
}

export const resources = {
  listNeeds: (params: {
    window?: WindowKey;
    search?: string;
    platform?: string;
    status?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) =>
    apiRequest<NeedListResponse>("/needs", { query: { ...params } }),

  getNeed: (id: string | number, window?: WindowKey) =>
    apiRequest<NeedDetail>(`/needs/${id}`, { query: { window } }),

  ingest: (adapter: string, records: unknown[]) =>
    apiRequest<{
      runId: number;
      adapter: string;
      status: string;
      recordsTotal: number;
      newRecords: number;
      demandSignals: number;
      needs: number;
    }>("/sources/ingest", { method: "POST", body: { adapter, records } }),

  sourceRuns: () => apiRequest<{ runs: RunInfo[] }>("/source-runs"),

  feedback: () => apiRequest<{ feedback: FeedbackRecord[] }>("/feedback"),

  postFeedback: (
    needId: string | number,
    body: {
      relevant?: boolean | null;
      willingnessToPay?: boolean;
      contacted?: boolean;
      note?: string;
      evidenceId?: number;
    }
  ) =>
    apiRequest<{ feedback: FeedbackRecord }>(`/needs/${needId}/feedback`, {
      method: "POST",
      body,
    }),

  rescore: (note?: string) =>
    apiRequest<{
      version: number;
      changedCount: number;
      changes: Array<{
        needId: number;
        title: string;
        previousScore: number | null;
        newScore: number | null;
        previousRank: number | null;
        newRank: number | null;
        changed: boolean;
      }>;
    }>("/ranking/rescore", { method: "POST", body: { note } }),

  rankingVersions: () =>
    apiRequest<{ versions: RankingVersion[] }>("/ranking/versions"),

  getSchedule: () =>
    apiRequest<{ enabled: boolean; cron: string | null; timezone: string }>(
      "/settings/schedule"
    ),
  putSchedule: (body: { enabled: boolean; cron?: string; timezone?: string }) =>
    apiRequest<{ enabled: boolean; cron: string | null; timezone: string }>(
      "/settings/schedule",
      { method: "PUT", body }
    ),
  team: () =>
    apiRequest<{ members: TeamMember[]; role: "admin" | "member" }>(
      "/settings/team"
    ),
  audit: () => apiRequest<{ events: AuditEvent[] }>("/audit"),
  health: () => apiRequest<{ status: string }>("/health"),
};
