import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { DatabaseConnection } from "./db/index.js";
import { audit, authMiddleware } from "./auth/session.js";
import { requireAdminOn } from "./middleware/roles.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerNeedRoutes } from "./routes/needs.js";
import {
  registerFeedbackLearningRoute,
  registerNeedFeedbackRoute,
} from "./routes/feedback.js";
import { registerRankingRoutes } from "./routes/ranking.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerAuditRoutes } from "./routes/audit.js";

export function createApp(db: DatabaseConnection): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  // Centralized Admin-only mutation guard. It authenticates and enforces the
  // Admin role on every Admin-only mutation in one place, without affecting
  // Member read access. Registered before the routes so it runs first.
  app.use("/api", requireAdminOn(db));

  app.use("/api", registerHealthRoutes());

  const auth = registerAuthRoutes(db);
  const sources = registerSourceRoutes(db);
  const needs = registerNeedRoutes(db);
  const feedback = registerFeedbackLearningRoute(db);
  const needFeedback = registerNeedFeedbackRoute(db);
  const ranking = registerRankingRoutes(db);
  const settings = registerSettingsRoutes(db);
  const audit = registerAuditRoutes(db);

  app.use("/api/auth", auth);
  app.use("/api/sources", sources);
  app.use("/api/needs", needs);
  app.use("/api/needs", needFeedback);
  app.use("/api/feedback", feedback);
  app.use("/api/ranking", ranking);
  app.use("/api/settings", settings);
  app.use("/api/audit", audit);

  // Fixed route alias for ingestion history.
  app.get("/api/source-runs", authMiddleware(db), (req: express.Request, res: express.Response) => {
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
    res.json({ runs });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: (err as Error)?.message ?? "Internal error" });
  });

  return app;
}
