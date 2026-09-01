import type { DatabaseConnection } from "./db/index.js";
import { detectSignals, matchTopic } from "./detection/phrases.js";
import type { IngestRecordInput } from "./adapters/types.js";
import { normalizeRecord } from "./adapters/types.js";

export interface IngestResult {
  runId: number;
  adapter: string;
  status: string;
  recordsTotal: number;
  recordsIngested: number;
  newRecords: number;
  sourceRecords: number;
  demandSignals: number;
  needs: number;
  error?: string;
}

function ensurePhrase(
  db: DatabaseConnection,
  workspaceId: number,
  text: string,
  phraseType: string,
  weight: number
): number {
  db.prepare(
    `INSERT OR IGNORE INTO phrases (workspace_id, text, phrase_type, weight)
     VALUES (?, ?, ?, ?)`
  ).run(workspaceId, text, phraseType, weight);
  const row = db
    .prepare(
      `SELECT id FROM phrases WHERE workspace_id = ? AND text = ? AND phrase_type = ?`
    )
    .get(workspaceId, text, phraseType) as { id: number };
  return row.id;
}

function linkRecordToNeed(
  db: DatabaseConnection,
  workspaceId: number,
  recordId: number,
  title: string,
  summary: string
): number {
  let need = db
    .prepare(`SELECT id FROM needs WHERE workspace_id = ? AND title = ?`)
    .get(workspaceId, title) as { id: number } | undefined;
  if (!need) {
    const res = db
      .prepare(
        `INSERT INTO needs (workspace_id, title, summary) VALUES (?, ?, ?)`
      )
      .run(workspaceId, title, summary);
    need = { id: Number(res.lastInsertRowid) };
  } else {
    db.prepare(
      `UPDATE needs SET summary = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(summary, need.id);
  }
  db.prepare(
    `INSERT OR IGNORE INTO need_evidence (need_id, record_id) VALUES (?, ?)`
  ).run(need.id, recordId);
  return need.id;
}

export function ingestRecords(
  db: DatabaseConnection,
  workspaceId: number,
  adapter: string,
  rawRecords: IngestRecordInput[],
  options: { userId?: number; trigger?: string } = {}
): IngestResult {
  const trigger = options.trigger ?? "manual";
  const runRes = db
    .prepare(
      `INSERT INTO source_runs (workspace_id, adapter, status, trigger, created_by)
       VALUES (?, ?, 'running', ?, ?)`
    )
    .run(workspaceId, adapter, trigger, options.userId ?? null);
  const runId = Number(runRes.lastInsertRowid);

  const records = rawRecords.map((r) => normalizeRecord(r));

  let sourceRecords = 0;
  let newRecords = 0;
  let demandSignals = 0;
  const needTitles: Set<number> = new Set();

  const insertRecord = db.prepare(
    `INSERT OR IGNORE INTO source_records
       (workspace_id, run_id, platform, external_id, url, author, published_at, text,
        likes, replies, reposts, upvotes, comments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const findRecord = db.prepare(
    `SELECT id FROM source_records WHERE workspace_id = ? AND platform = ? AND external_id = ?`
  );

  for (const rec of records) {
    const inserted = insertRecord.run(
      workspaceId,
      runId,
      rec.platform,
      rec.externalId,
      rec.url,
      rec.author,
      rec.publishedAt,
      rec.text,
      rec.engagement.likes,
      rec.engagement.replies,
      rec.engagement.reposts,
      rec.engagement.upvotes,
      rec.engagement.comments
    );
    const existed = inserted.changes === 0;

    const recRow = findRecord.get(workspaceId, rec.platform, rec.externalId) as {
      id: number;
    };
    const recordId = recRow.id;
    sourceRecords++;
    if (!existed) newRecords++;

    // Signals
    const signals = detectSignals(rec.text);
    for (const signal of signals) {
      const phraseId = ensurePhrase(
        db,
        workspaceId,
        signal.label,
        signal.type,
        signal.weight
      );
      const insertedSignal = db
        .prepare(
          `INSERT OR IGNORE INTO demand_signals (workspace_id, record_id, phrase_id, signal_type, weight)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(workspaceId, recordId, phraseId, signal.type, signal.weight);
      if (insertedSignal.changes > 0) demandSignals++;
    }

    // Group into needs
    const topic = matchTopic(rec.text, rec.author);
    const title = topic ?? `${rec.platform} signal: ${rec.author}`;
    const summary = rec.text.length > 280 ? `${rec.text.slice(0, 277)}...` : rec.text;
    const needId = linkRecordToNeed(db, workspaceId, recordId, title, summary);
    needTitles.add(needId);
  }

  db.prepare(
    `UPDATE source_runs SET status = 'success', finished_at = datetime('now'),
       records_ingested = ?, records_total = ?, new_records = ?
     WHERE id = ?`
  ).run(sourceRecords, records.length, newRecords, runId);

  return {
    runId,
    adapter,
    status: "success",
    recordsTotal: records.length,
    recordsIngested: sourceRecords,
    newRecords,
    sourceRecords,
    demandSignals,
    needs: needTitles.size,
  };
}

export function failRun(
  db: DatabaseConnection,
  runId: number,
  error: string
): void {
  db.prepare(
    `UPDATE source_runs SET status = 'failed', finished_at = datetime('now'), error = ? WHERE id = ?`
  ).run(error, runId);
}
