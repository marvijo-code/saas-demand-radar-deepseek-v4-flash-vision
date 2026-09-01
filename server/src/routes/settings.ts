import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { DatabaseConnection } from "../db/index.js";
import { authMiddleware, audit } from "../auth/session.js";
import { mutationRateLimiter } from "../middleware/rateLimit.js";

const scheduleSchema = z.object({
  enabled: z.boolean(),
  cron: z.string().min(5).max(200).optional(),
  timezone: z.string().max(100).optional(),
});

function parseCronParts(cron: string): string[] {
  return cron.trim().split(/\s+/);
}

function isValidCron(cron: string): boolean {
  const parts = parseCronParts(cron);
  return parts.length >= 5 && parts.length <= 6;
}

export function registerSettingsRoutes(db: DatabaseConnection): Router {
  const router = Router();

  router.get("/schedule", authMiddleware(db), (req: Request, res: Response) => {
    const row = db
      .prepare(`SELECT * FROM workspace_settings WHERE workspace_id = ?`)
      .get(req.user!.workspaceId) as
      | { schedule_enabled: number; schedule_cron: string | null; schedule_timezone: string }
      | undefined;
    if (!row) {
      return res.json({
        enabled: false,
        cron: null,
        timezone: "UTC",
        lastRun: null,
        nextRun: null,
      });
    }
    return res.json({
      enabled: !!row.schedule_enabled,
      cron: row.schedule_cron,
      timezone: row.schedule_timezone,
    });
  });

  router.put(
    "/schedule",
    authMiddleware(db),
    mutationRateLimiter(),
    (req: Request, res: Response) => {
      const parsed = scheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", issues: parsed.error.errors });
      }
      const { enabled, cron, timezone } = parsed.data;
      if (enabled && cron) {
        if (!isValidCron(cron)) {
          return res.status(400).json({ error: "Invalid cron expression" });
        }
      }
      db.prepare(
        `INSERT INTO workspace_settings
           (workspace_id, schedule_enabled, schedule_cron, schedule_timezone, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(workspace_id) DO UPDATE SET
           schedule_enabled = excluded.schedule_enabled,
           schedule_cron = excluded.schedule_cron,
           schedule_timezone = excluded.schedule_timezone,
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`
      ).run(
        req.user!.workspaceId,
        enabled ? 1 : 0,
        enabled && cron ? cron : null,
        timezone ?? "UTC",
        req.user!.id
      );
      audit(db, req, "settings.schedule.update", "workspace_settings", req.user!.workspaceId, {
        enabled,
        cron: enabled ? cron : null,
      });
      return res.json({
        enabled,
        cron: enabled ? cron ?? null : null,
        timezone: timezone ?? "UTC",
      });
    }
  );

  router.get("/team", authMiddleware(db), (req: Request, res: Response) => {
    const members = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.created_at
         FROM users u WHERE u.workspace_id = ? ORDER BY u.id`
      )
      .all(req.user!.workspaceId);
    return res.json({ members, role: req.user!.role });
  });

  return router;
}
