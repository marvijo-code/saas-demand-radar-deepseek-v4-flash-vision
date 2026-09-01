import type { DatabaseConnection } from "../db/index.js";
import type { RankingConfig } from "./service.js";

export function saveConfigForWorkspace(
  db: DatabaseConnection,
  workspaceId: number,
  config: RankingConfig
): void {
  db.prepare(
    `INSERT INTO ranking_active
       (workspace_id, model_weights, phrase_weights, platform_weights, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(workspace_id) DO UPDATE SET
       model_weights = excluded.model_weights,
       phrase_weights = excluded.phrase_weights,
       platform_weights = excluded.platform_weights,
       updated_at = datetime('now')`
  ).run(
    workspaceId,
    JSON.stringify(config.modelWeights),
    JSON.stringify(config.phraseWeights),
    JSON.stringify(config.platformWeights)
  );
}
