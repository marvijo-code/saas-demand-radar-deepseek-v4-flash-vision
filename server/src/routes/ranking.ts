import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { DatabaseConnection } from "../db/index.js";
import { authMiddleware, audit } from "../auth/session.js";
import { mutationRateLimiter } from "../middleware/rateLimit.js";
import { createRescoreVersion, listVersions } from "../ranking/versions.js";

const rescoreSchema = z.object({
  note: z.string().max(2000).optional(),
  triggeredByFeedbackId: z.number().int().optional(),
});

export function registerRankingRoutes(db: DatabaseConnection): Router {
  const router = Router();

  router.post(
    "/rescore",
    authMiddleware(db),
    mutationRateLimiter(),
    (req: Request, res: Response) => {
      const parsed = rescoreSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", issues: parsed.error.errors });
      }
      const result = createRescoreVersion(db, req.user!.workspaceId, req.user!.id, {
        note: parsed.data.note,
        triggeredByFeedbackId: parsed.data.triggeredByFeedbackId,
      });
      audit(db, req, "ranking.rescore", "model_version", result.versionId, {
        version: result.version,
        changedCount: result.changedCount,
      });
      return res.json(result);
    }
  );

  router.get("/versions", authMiddleware(db), (req: Request, res: Response) => {
    const versions = listVersions(db, req.user!.workspaceId);
    return res.json({ versions });
  });

  return router;
}
