import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { DatabaseConnection } from "../db/index.js";
import { authMiddleware, audit } from "../auth/session.js";
import { mutationRateLimiter } from "../middleware/rateLimit.js";
import { computeLearningConfig } from "../ranking/learning.js";
import { saveConfigForWorkspace } from "../ranking/mutate.js";

const feedbackSchema = z.object({
  relevant: z.boolean().nullable().optional(),
  willingnessToPay: z.boolean().optional().default(false),
  contacted: z.boolean().optional().default(false),
  note: z.string().max(2000).optional(),
  evidenceId: z.number().int().optional(),
});

export function registerFeedbackLearningRoute(db: DatabaseConnection): Router {
  const router = Router();

  router.get("/", authMiddleware(db), (req: Request, res: Response) => {
    const items = db
      .prepare(
        `SELECT f.id, f.need_id, f.evidence_id, f.target_type, f.relevant,
                f.willingness_to_pay, f.contacted, f.note, f.created_at,
                u.email AS created_by_email, n.title AS need_title,
                r.author AS record_author, r.url AS record_url, r.text AS record_text
         FROM feedback f
         LEFT JOIN users u ON u.id = f.created_by
         LEFT JOIN needs n ON n.id = f.need_id
         LEFT JOIN need_evidence ne ON ne.id = f.evidence_id
         LEFT JOIN source_records r ON r.id = ne.record_id
         WHERE f.workspace_id = ?
         ORDER BY f.id DESC
         LIMIT 200`
      )
      .all(req.user!.workspaceId);
    return res.json({ feedback: items });
  });

  return router;
}

export function registerNeedFeedbackRoute(db: DatabaseConnection): Router {
  const router = Router();

  router.post(
    "/:id/feedback",
    authMiddleware(db),
    mutationRateLimiter(),
    (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "Invalid need id" });
      }
      const parsed = feedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", issues: parsed.error.errors });
      }

      const need = db
        .prepare(`SELECT id FROM needs WHERE id = ? AND workspace_id = ?`)
        .get(id, req.user!.workspaceId) as { id: number } | undefined;
      if (!need) return res.status(404).json({ error: "Need not found" });

      const targetType = parsed.data.evidenceId ? "evidence" : "need";
      let evidenceId: number | null = null;
      if (parsed.data.evidenceId) {
        const ev = db
          .prepare(
            `SELECT ne.id FROM need_evidence ne
             JOIN needs n ON n.id = ne.need_id
             WHERE ne.id = ? AND ne.need_id = ? AND n.workspace_id = ?`
          )
          .get(parsed.data.evidenceId, id, req.user!.workspaceId) as
          | { id: number }
          | undefined;
        if (!ev) return res.status(404).json({ error: "Evidence not found" });
        evidenceId = ev.id;
      }

      const res2 = db
        .prepare(
          `INSERT INTO feedback
             (workspace_id, need_id, evidence_id, target_type, relevant,
              willingness_to_pay, contacted, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.user!.workspaceId,
          id,
          evidenceId,
          targetType,
          parsed.data.relevant === undefined ? null : parsed.data.relevant ? 1 : 0,
          parsed.data.willingnessToPay ? 1 : 0,
          parsed.data.contacted ? 1 : 0,
          parsed.data.note ?? null,
          req.user!.id
        );
      const feedbackId = Number(res2.lastInsertRowid);

      // Persist the learned weights so scoring reflects the feedback before a
      // new model version is explicitly created.
      const config = computeLearningConfig(db, req.user!.workspaceId);
      saveConfigForWorkspace(db, req.user!.workspaceId, config);

      audit(db, req, "feedback.create", "feedback", feedbackId, {
        needId: id,
        targetType,
        relevant: parsed.data.relevant,
        willingnessToPay: parsed.data.willingnessToPay,
        contacted: parsed.data.contacted,
      });

      const feedback = db
        .prepare(
          `SELECT id, need_id, evidence_id, target_type, relevant,
                  willingness_to_pay, contacted, note, created_at
           FROM feedback WHERE id = ? AND workspace_id = ?`
        )
        .get(feedbackId, req.user!.workspaceId);

      return res.status(201).json({ feedback });
    }
  );

  return router;
}
