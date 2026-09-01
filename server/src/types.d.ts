import type { Request } from "express";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  workspaceId: number;
  workspaceName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

export {};
