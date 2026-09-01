import type {
  Request,
  Response,
  NextFunction,
} from "express";
import type { DatabaseConnection } from "../db/index.js";
import { getConfig } from "../config.js";
import { findUserBySession } from "../auth/session.js";

export interface AdminMutationRule {
  method: string;
  path: string;
}

// Every Admin-only mutation named in PROMPT.md. Members may never perform
// these; they are enforced centrally once, rather than per route.
export const ADMIN_ONLY_MUTATIONS: readonly AdminMutationRule[] = [
  { method: "POST", path: "/api/sources/ingest" },
  { method: "PUT", path: "/api/settings/schedule" },
];

interface FoundSessionUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  workspace_id: number;
  workspace_name: string;
}

// Returns a middleware that authenticates and enforces the Admin role for any
// Admin-only mutation. All other requests pass straight through, preserving
// Member read access.
export function requireAdminOn(db: DatabaseConnection) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const fullPath = `${req.baseUrl}${req.path}`;
    const adminOnly = ADMIN_ONLY_MUTATIONS.some(
      (m) => m.method === req.method && m.path === fullPath
    );
    if (!adminOnly) return next();

    const cookie = (req.cookies as Record<string, unknown> | undefined)?.[
      getConfig().sessionCookie
    ] as string | undefined;
    const user = cookie ? findUserBySession(db, cookie) : null;
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin role required" });
    }

    const found = user as unknown as FoundSessionUser;
    req.user = {
      id: found.id,
      email: found.email,
      name: found.name,
      role: found.role,
      workspaceId: found.workspace_id,
      workspaceName: found.workspace_name,
    };
    return next();
  };
}
