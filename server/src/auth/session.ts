import type { Request, Response, NextFunction } from "express";
import type { DatabaseConnection } from "../db/index.js";
import { hashToken } from "./password.js";
import { getConfig } from "../config.js";
import type { SessionUser } from "../types.js";

export function createSession(
  db: DatabaseConnection,
  userId: number,
  token: string
): void {
  const config = getConfig();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();
  db.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
  ).run(userId, hashToken(token), expiresAt);
}

export function logOutSession(db: DatabaseConnection, token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}

export function findUserBySession(
  db: DatabaseConnection,
  token: string
): (SessionUser & { expires_at: string }) | null {
  const row = db
    .prepare(
      `SELECT s.token_hash, s.expires_at, u.id, u.email, u.name, u.role,
              u.workspace_id, w.name AS workspace_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN workspaces w ON w.id = u.workspace_id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(token)) as
    | (SessionUser & { expires_at: string })
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
    return null;
  }
  return row;
}

export function authMiddleware(db: DatabaseConnection) {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = getConfig();
    const cookie = (req.cookies as Record<string, string> | undefined)?.[
      config.sessionCookie
    ];
    if (!cookie) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const found = findUserBySession(db, cookie);
    if (!found) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.user = {
      id: found.id,
      email: found.email,
      name: found.name,
      role: found.role,
      workspaceId: found.workspace_id,
      workspaceName: found.workspace_name,
    };
    req.sessionId = cookie;
    next();
  };
}

export function adminRequired(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin role required" });
  }
  next();
}

export function audit(
  db: DatabaseConnection,
  req: Request,
  action: string,
  entityType?: string,
  entityId?: number,
  details?: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    req.user?.workspaceId ?? null,
    req.user?.id ?? null,
    action,
    entityType ?? null,
    entityId ?? null,
    details ? JSON.stringify(details) : null
  );
}
