import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import type { DatabaseConnection } from "../db/index.js";
import { authMiddleware, audit } from "../auth/session.js";
import { mutationRateLimiter } from "../middleware/rateLimit.js";
import { ingestRecords, type IngestResult } from "../ingest.js";

const ingestSchema = z.object({
  adapter: z.enum(["snapshot", "x", "reddit"]).default("snapshot"),
  records: z
    .array(
      z.object({
        platform: z.string().min(1),
        externalId: z.string().optional().default(""),
        url: z.string().optional().default(""),
        author: z.string().optional().default("anonymous"),
        publishedAt: z.string().optional().default(new Date().toISOString()),
        text: z.string().min(1),
        engagement: z
          .object({
            likes: z.number().optional(),
            replies: z.number().optional(),
            reposts: z.number().optional(),
            upvotes: z.number().optional(),
            comments: z.number().optional(),
          })
          .optional()
          .default({}),
      })
    )
    .min(1),
});

export function registerSourceRoutes(db: DatabaseConnection): Router {
  const router = Router();

  router.post(
    "/ingest",
    authMiddleware(db),
    mutationRateLimiter(),
    (req: Request, res: Response) => {
      let parsed;
      try {
        parsed = ingestSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          return res.status(400).json({ error: "Invalid ingest payload", issues: err.errors });
        }
        return res.status(400).json({ error: "Invalid ingest payload" });
      }

      const adapter = parsed.adapter;
      let result: IngestResult;
      try {
        // For deterministic testing, ad-hoc records are accepted for any
        // adapter; live X/Reddit adapters would fetch their own records.
        result = ingestRecords(db, req.user!.workspaceId, adapter, parsed.records, {
          userId: req.user!.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Ingestion failed";
        return res.status(500).json({ error: message });
      }

      audit(db, req, "sources.ingest", "source_run", result.runId, {
        adapter,
        total: result.recordsTotal,
        new: result.newRecords,
      });
      return res.status(200).json(result);
    }
  );

  router.get("/runs", authMiddleware(db), (req: Request, res: Response) => {
    const runs = db
      .prepare(
        `SELECT id, adapter, status, started_at, finished_at, records_ingested,
                records_total, new_records, error, trigger, created_by
         FROM source_runs
         WHERE workspace_id = ?
         ORDER BY id DESC
         LIMIT 100`
      )
      .all(req.user!.workspaceId);
    return res.json({ runs });
  });

  return router;
}
