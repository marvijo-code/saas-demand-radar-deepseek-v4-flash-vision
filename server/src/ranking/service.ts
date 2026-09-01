import type { DatabaseConnection } from "../db/index.js";
import {
  computeScore,
  normalizeWeights,
  WINDOW_MS,
  parseWindow,
  DEFAULT_MODEL_WEIGHTS,
  type ModelWeights,
  type ScoreBreakdown,
  type WindowKey,
  type EvidenceForScore,
} from "./score.js";

export interface RankingConfig {
  modelWeights: ModelWeights;
  phraseWeights: Record<string, number>;
  platformWeights: Record<string, number>;
}

export function defaultRankingConfig(): RankingConfig {
  return {
    modelWeights: { ...DEFAULT_MODEL_WEIGHTS },
    phraseWeights: {},
    platformWeights: {},
  };
}

// Reference time used for windowing and recency. It is anchored to the newest
// source record in the workspace so historical snapshots still produce
// meaningful windows, falling back to the system clock when no data exists.
export function getReferenceTime(
  db: DatabaseConnection,
  workspaceId: number
): number {
  if (process.env.REFERENCE_TIME) {
    const t = Date.parse(process.env.REFERENCE_TIME);
    if (!Number.isNaN(t)) return t;
  }
  const row = db
    .prepare(
      `SELECT MAX(published_at) AS m FROM source_records WHERE workspace_id = ?`
    )
    .get(workspaceId) as { m: string | null } | undefined;
  if (row && row.m) {
    const t = Date.parse(row.m);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}

// Kept for compatibility with call sites that only need a clock.
export function getNow(): number {
  return Date.now();
}

export function getActiveConfig(
  db: DatabaseConnection,
  workspaceId: number
): RankingConfig {
  const active = db
    .prepare(
      `SELECT model_weights, phrase_weights, platform_weights
       FROM ranking_active WHERE workspace_id = ?`
    )
    .get(workspaceId) as
    | { model_weights: string; phrase_weights: string; platform_weights: string }
    | undefined;
  if (active) {
    try {
      return {
        modelWeights: normalizeWeights(JSON.parse(active.model_weights) ?? {}),
        phraseWeights: JSON.parse(active.phrase_weights) ?? {},
        platformWeights: JSON.parse(active.platform_weights) ?? {},
      };
    } catch {
      // fall through to version snapshot
    }
  }
  const row = db
    .prepare(
      `SELECT weights FROM ranking_model_versions
       WHERE workspace_id = ? ORDER BY version DESC LIMIT 1`
    )
    .get(workspaceId) as { weights: string } | undefined;
  if (row) {
    try {
      const parsed = JSON.parse(row.weights) as Partial<RankingConfig>;
      return {
        modelWeights: normalizeWeights(parsed.modelWeights ?? {}),
        phraseWeights: parsed.phraseWeights ?? {},
        platformWeights: parsed.platformWeights ?? {},
      };
    } catch {
      return defaultRankingConfig();
    }
  }
  return defaultRankingConfig();
}

export interface EvidenceRow {
  evidence_id: number;
  record_id: number;
  published_at: string;
  platform: string;
  likes: number;
  replies: number;
  reposts: number;
  upvotes: number;
  comments: number;
  author: string;
  url: string;
  text: string;
  external_id: string;
}

function loadRecordSignals(
  db: DatabaseConnection,
  recordId: number,
  config: RankingConfig
): { effectiveWeights: number[]; keys: string[] } {
  const signals = db
    .prepare(
      `SELECT ds.id, p.text, p.phrase_type, p.weight
       FROM demand_signals ds
       JOIN phrases p ON p.id = ds.phrase_id
       WHERE ds.record_id = ?`
    )
    .all(recordId) as Array<{
    id: number;
    text: string;
    phrase_type: string;
    weight: number;
  }>;

  const effectiveWeights: number[] = [];
  const keys: string[] = [];
  for (const s of signals) {
    const key = `${s.phrase_type}:${s.text}`;
    const learned = config.phraseWeights[key] ?? 1;
    effectiveWeights.push(s.weight * learned);
    keys.push(key);
  }
  return { effectiveWeights, keys };
}

function platformMultiplier(config: RankingConfig, platform: string): number {
  return config.platformWeights[platform] ?? 1;
}

export function gatherEvidenceForNeed(
  db: DatabaseConnection,
  workspaceId: number,
  needId: number,
  windowKey: WindowKey,
  now: number,
  config: RankingConfig
): EvidenceForScore[] {
  const windowMs = WINDOW_MS[windowKey];
  const start = now - windowMs;

  const rows = db
    .prepare(
      `SELECT ne.id AS evidence_id, r.id AS record_id, r.published_at, r.platform, r.likes, r.replies, r.reposts,
              r.upvotes, r.comments, r.author, r.url, r.text, r.external_id
       FROM need_evidence ne
       JOIN source_records r ON r.id = ne.record_id
       WHERE ne.need_id = ? AND r.workspace_id = ?
       ORDER BY r.published_at DESC`
    )
    .all(needId, workspaceId) as EvidenceRow[];

  // Feedback aggregates for need + each evidence.
  const needFeedback = db
    .prepare(
      `SELECT relevant, willingness_to_pay, contacted FROM feedback
       WHERE workspace_id = ? AND need_id = ? AND target_type = 'need'
       ORDER BY id DESC LIMIT 1`
    )
    .get(workspaceId, needId) as
    | { relevant: number | null; willingness_to_pay: number; contacted: number }
    | undefined;

  const evidenceFeedbackStmt = db.prepare(
    `SELECT relevant, willingness_to_pay, contacted FROM feedback
     WHERE workspace_id = ? AND evidence_id = ? AND target_type = 'evidence'
     ORDER BY id DESC LIMIT 1`
  );

  const result: EvidenceForScore[] = [];
  for (const row of rows) {
    const published = Date.parse(row.published_at);
    if (published < start || published > now + 60_000) continue;

    const { effectiveWeights } = loadRecordSignals(db, row.record_id, config);
    const platformW = platformMultiplier(config, row.platform);

    const ev = evidenceFeedbackStmt.get(workspaceId, row.evidence_id) as
      | { relevant: number | null; willingness_to_pay: number; contacted: number }
      | undefined;

    // Combine need-level + evidence-level feedback for a per-evidence multiplier.
    let relevant: boolean | null = null;
    let willingness = false;
    let contacted = false;
    if (needFeedback && needFeedback.relevant !== null) {
      relevant = needFeedback.relevant === 1;
    }
    if (needFeedback) {
      willingness = !!needFeedback.willingness_to_pay;
      contacted = !!needFeedback.contacted;
    }
    if (ev) {
      if (ev.relevant !== null) relevant = ev.relevant === 1;
      willingness = willingness || !!ev.willingness_to_pay;
      contacted = contacted || !!ev.contacted;
    }

    // Learning from feedback is applied through the persisted ranking-model
    // weights (phraseWeights/platformWeights), versioned on rescore.
    const avgPhrase = effectiveWeights.length
      ? effectiveWeights.reduce((a, b) => a + b, 0) / effectiveWeights.length
      : 1;
    const weight = platformW * avgPhrase;

    result.push({
      publishedAt: row.published_at,
      platform: row.platform,
      likes: row.likes,
      replies: row.replies,
      reposts: row.reposts,
      upvotes: row.upvotes,
      comments: row.comments,
      signalWeights: effectiveWeights,
      isRelevant: relevant,
      willingnessToPay: willingness,
      contacted,
      weight,
      recordId: row.record_id,
      author: row.author,
      url: row.url,
      text: row.text,
      externalId: row.external_id,
    });
  }
  return result;
}

export interface NeedScoreRecord {
  needId: number;
  title: string;
  summary: string;
  status: string;
  evidenceCount: number;
  platforms: string[];
  score: ScoreBreakdown;
  rank: number;
}

export function scoreNeed(
  db: DatabaseConnection,
  workspaceId: number,
  needId: number,
  windowKey: WindowKey,
  config: RankingConfig | null
): ScoreBreakdown {
  const now = getReferenceTime(db, workspaceId);
  const cfg = config ?? getActiveConfig(db, workspaceId);
  const evidence = gatherEvidenceForNeed(
    db,
    workspaceId,
    needId,
    windowKey,
    now,
    cfg
  );
  return computeScore(evidence, cfg.modelWeights, now);
}

export function rankNeeds(
  db: DatabaseConnection,
  workspaceId: number,
  windowKey: WindowKey,
  config: RankingConfig | null = null
): NeedScoreRecord[] {
  const now = getReferenceTime(db, workspaceId);
  const cfg = config ?? getActiveConfig(db, workspaceId);
  const needs = db
    .prepare(
      `SELECT id, title, summary, status FROM needs WHERE workspace_id = ?`
    )
    .all(workspaceId) as Array<{
    id: number;
    title: string;
    summary: string;
    status: string;
  }>;

  const scored: NeedScoreRecord[] = [];
  for (const need of needs) {
    const evidence = gatherEvidenceForNeed(
      db,
      workspaceId,
      need.id,
      windowKey,
      now,
      cfg
    );
    const breakdown = computeScore(evidence, cfg.modelWeights, now);
    const platforms = [...new Set(evidence.map((e) => e.platform))];
    scored.push({
      needId: need.id,
      title: need.title,
      summary: need.summary,
      status: need.status,
      evidenceCount: evidence.length,
      platforms,
      score: breakdown,
      rank: 0,
    });
  }

  scored.sort((a, b) => b.score.total - a.score.total);
  scored.forEach((s, i) => (s.rank = i + 1));
  return scored;
}
