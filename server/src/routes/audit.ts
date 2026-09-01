import { Router, type Request, type Response } from "express";
import type { DatabaseConnection } from "../db/index.js";
import { authMiddleware } from "../auth/session.js";

export function registerAuditRoutes(db: DatabaseConnection): Router {
  const router = Router();

  router.get("/", authMiddleware(db), (req: Request, res: Response) => {
    const events = db
      .prepare(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
                u.email AS user_email
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.workspace_id = ?
         ORDER BY a.id DESC
         LIMIT 200`
      )
      .all(req.user!.workspaceId);
    return res.json({ events });
  });

  return router;
}
