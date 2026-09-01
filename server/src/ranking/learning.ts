import type { DatabaseConnection } from "../db/index.js";
import type { RankingConfig } from "./service.js";
import { getActiveConfig } from "./service.js";

interface FeedbackRow {
  id: number;
  target_type: "need" | "evidence";
  need_id: number;
  evidence_id: number | null;
  relevant: number | null;
  willingness_to_pay: number;
  contacted: number;
}

function multiplierFor(f: FeedbackRow): number {
  let m = 1;
  if (f.relevant === 1) m *= 1.3;
  else if (f.relevant === 0) m *= 0.4;
  if (f.willingness_to_pay) m *= 1.4;
  if (f.contacted) m *= 1.4;
  return m;
}

function clampMul(m: number): number {
  return Math.min(5, Math.max(0.2, m));
}

// A feedback record targets the signals of one or more evidence records.
function affectedKeys(
  db: DatabaseConnection,
  workspaceId: number,
  f: FeedbackRow
): { phraseKeys: string[]; platforms: string[] } {
  const phraseKeys: string[] = [];
  const platforms: string[] = [];

  const addForRecord = (recordId: number) => {
    const signals = db
      .prepare(
        `SELECT p.phrase_type, p.text FROM demand_signals ds
         JOIN phrases p ON p.id = ds.phrase_id
         WHERE ds.workspace_id = ? AND ds.record_id = ?`
      )
      .all(workspaceId, recordId) as Array<{ phrase_type: string; text: string }>;
    for (const s of signals) phraseKeys.push(`${s.phrase_type}:${s.text}`);

    const rec = db
      .prepare(
        `SELECT platform FROM source_records WHERE id = ? AND workspace_id = ?`
      )
      .get(recordId, workspaceId) as { platform: string } | undefined;
    if (rec) platforms.push(rec.platform);
  };

  if (f.target_type === "evidence" && f.evidence_id !== null) {
    const ev = db
      .prepare(`SELECT record_id FROM need_evidence WHERE id = ?`)
      .get(f.evidence_id) as { record_id: number } | undefined;
    if (ev) addForRecord(ev.record_id);
  } else {
    const records = db
      .prepare(
        `SELECT ne.record_id FROM need_evidence ne
         WHERE ne.need_id = ?`
      )
      .all(f.need_id) as Array<{ record_id: number }>;
    for (const r of records) addForRecord(r.record_id);
  }

  return { phraseKeys: [...new Set(phraseKeys)], platforms: [...new Set(platforms)] };
}

export function computeLearningConfig(
  db: DatabaseConnection,
  workspaceId: number
): RankingConfig {
  const base = getActiveConfig(db, workspaceId);
  const phraseLog: Record<string, number> = {};
  const platformLog: Record<string, number> = {};

  const feedback = db
    .prepare(
      `SELECT id, target_type, need_id, evidence_id, relevant, willingness_to_pay, contacted
       FROM feedback WHERE workspace_id = ?`
    )
    .all(workspaceId) as FeedbackRow[];

  for (const f of feedback) {
    const m = multiplierFor(f);
    if (m === 1) continue;
    const { phraseKeys, platforms } = affectedKeys(db, workspaceId, f);
    const log = Math.log2(m);
    for (const key of phraseKeys) phraseLog[key] = (phraseLog[key] ?? 0) + log;
    for (const p of platforms) platformLog[p] = (platformLog[p] ?? 0) + log;
  }

  const phraseWeights: Record<string, number> = { ...base.phraseWeights };
  for (const [key, log] of Object.entries(phraseLog)) {
    phraseWeights[key] = clampMul(Math.pow(2, log) * (base.phraseWeights[key] ?? 1));
  }
  const platformWeights: Record<string, number> = { ...base.platformWeights };
  for (const [p, log] of Object.entries(platformLog)) {
    platformWeights[p] = clampMul(Math.pow(2, log) * (base.platformWeights[p] ?? 1));
  }

  return {
    modelWeights: { ...base.modelWeights },
    phraseWeights,
    platformWeights,
  };
}
