import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { DatabaseConnection } from "../db/index.js";
import { verifyPassword, randomToken } from "../auth/password.js";
import {
  createSession,
  logOutSession,
  authMiddleware,
} from "../auth/session.js";
import { authRateLimiter } from "../middleware/rateLimit.js";
import { getConfig } from "../config.js";
import { audit } from "../auth/session.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setSessionCookie(res: Response, token: string): void {
  const config = getConfig();
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: config.sessionTtlMs,
  });
}

export function registerAuthRoutes(db: DatabaseConnection): Router {
  const router = Router();

  router.post("/login", authRateLimiter(), (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", issues: parsed.error.errors });
    }
    const { email, password } = parsed.data;
    const user = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.password_hash, u.role, u.workspace_id, w.name AS workspace_name
         FROM users u JOIN workspaces w ON w.id = u.workspace_id
         WHERE u.email = ?`
      )
      .get(email.toLowerCase()) as
      | {
          id: number;
          email: string;
          name: string;
          password_hash: string;
          role: string;
          workspace_id: number;
          workspace_name: string;
        }
      | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = randomToken();
    createSession(db, user.id, token);
    setSessionCookie(res, token);

    const fakeReq = {
      user: { id: user.id, workspaceId: user.workspace_id },
    } as Request;
    audit(db, fakeReq as Request, "auth.login", "user", user.id, { email: user.email });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workspaceId: user.workspace_id,
        workspaceName: user.workspace_name,
      },
    });
  });

  router.post("/logout", (req: Request, res: Response) => {
    const config = getConfig();
    const cookie = (req.cookies as Record<string, string> | undefined)?.[
      config.sessionCookie
    ];
    if (cookie) logOutSession(db, cookie);
    res.clearCookie(config.sessionCookie, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/me", authMiddleware(db), (req: Request, res: Response) => {
    return res.json({
      user: {
        id: req.user!.id,
        email: req.user!.email,
        name: req.user!.name,
        role: req.user!.role,
        workspaceId: req.user!.workspaceId,
        workspaceName: req.user!.workspaceName,
      },
    });
  });

  return router;
}
