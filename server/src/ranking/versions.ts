import type { DatabaseConnection } from "../db/index.js";
import { rankNeeds, getActiveConfig, defaultRankingConfig } from "./service.js";
import { normalizeWeights } from "./score.js";

export interface RescoreResult {
  versionId: number;
  version: number;
  label: string;
  changes: Array<{
    needId: number;
    title: string;
    previousScore: number | null;
    newScore: number | null;
    previousRank: number | null;
    newRank: number | null;
    changed: boolean;
  }>;
  changedCount: number;
}

export function nextVersionNumber(
  db: DatabaseConnection,
  workspaceId: number
): number {
  const row = db
    .prepare(
      `SELECT MAX(version) AS max FROM ranking_model_versions WHERE workspace_id = ?`
    )
    .get(workspaceId) as { max: number | null };
  return (row.max ?? 0) + 1;
}

export function createRescoreVersion(
  db: DatabaseConnection,
  workspaceId: number,
  userId: number | null,
  options: { note?: string; triggeredByFeedbackId?: number } = {}
): RescoreResult {
  // Old config = the last committed version snapshot (or defaults).
  const prevVersion = db
    .prepare(
      `SELECT weights FROM ranking_model_versions
       WHERE workspace_id = ? ORDER BY version DESC LIMIT 1`
    )
    .get(workspaceId) as { weights: string } | undefined;
  let oldConfig = defaultRankingConfig();
  if (prevVersion) {
    try {
      oldConfig = {
        modelWeights: normalizeWeights(JSON.parse(prevVersion.weights).modelWeights ?? {}),
        phraseWeights: JSON.parse(prevVersion.weights).phraseWeights ?? {},
        platformWeights: JSON.parse(prevVersion.weights).platformWeights ?? {},
      };
    } catch {
      oldConfig = defaultRankingConfig();
    }
  }

  // New config = the currently effective (feedback-learned) weights.
  const newConfig = getActiveConfig(db, workspaceId);

  const window = "30d";
  const prev = rankNeeds(db, workspaceId, window, oldConfig);
  const prevMap = new Map<number, { score: number; rank: number; title: string }>();
  for (const n of prev) {
    prevMap.set(n.needId, { score: n.score.total, rank: n.rank, title: n.title });
  }

  const next = rankNeeds(db, workspaceId, window, newConfig);
  const nextMap = new Map<number, { score: number; rank: number }>();
  for (const n of next) nextMap.set(n.needId, { score: n.score.total, rank: n.rank });

  const version = nextVersionNumber(db, workspaceId);
  const label = `Ranking model v${version}`;
  const res = db
    .prepare(
      `INSERT INTO ranking_model_versions
         (workspace_id, version, label, weights, created_by, note, triggered_by_feedback_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      workspaceId,
      version,
      label,
      JSON.stringify(newConfig),
      userId,
      options.note ?? null,
      options.triggeredByFeedbackId ?? null
    );
  const versionId = Number(res.lastInsertRowid);

  const allIds = new Set([...prevMap.keys(), ...nextMap.keys()]);
  const changes: RescoreResult["changes"] = [];
  const insertChange = db.prepare(
    `INSERT INTO ranking_changes
       (workspace_id, version_id, need_id, previous_score, new_score, previous_rank, new_rank)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const needId of allIds) {
    const p = prevMap.get(needId);
    const n = nextMap.get(needId);
    const changed =
      (p?.rank ?? null) !== (n?.rank ?? null) ||
      Math.abs((p?.score ?? 0) - (n?.score ?? 0)) > 1e-9;
    insertChange.run(
      workspaceId,
      versionId,
      needId,
      p?.score ?? null,
      n?.score ?? null,
      p?.rank ?? null,
      n?.rank ?? null
    );
    changes.push({
      needId,
      title: p?.title ?? n?.title ?? "",
      previousScore: p?.score ?? null,
      newScore: n?.score ?? null,
      previousRank: p?.rank ?? null,
      newRank: n?.rank ?? null,
      changed,
    });
  }

  return {
    versionId,
    version,
    label,
    changes,
    changedCount: changes.filter((c) => c.changed).length,
  };
}

export function listVersions(
  db: DatabaseConnection,
  workspaceId: number
): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT v.id, v.version, v.label, v.weights, v.created_at, v.note,
              v.triggered_by_feedback_id, u.email AS created_by_email,
              (SELECT COUNT(*) FROM ranking_changes c WHERE c.version_id = v.id) AS change_count
       FROM ranking_model_versions v
       LEFT JOIN users u ON u.id = v.created_by
       WHERE v.workspace_id = ?
       ORDER BY v.version DESC`
    )
    .all(workspaceId);
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    let weights = {} as Record<string, unknown>;
    try {
      weights = JSON.parse(String(row.weights));
    } catch {
      weights = {};
    }
    delete row.weights;
    row.weightsParsed = weights;
    return row;
  });
}
