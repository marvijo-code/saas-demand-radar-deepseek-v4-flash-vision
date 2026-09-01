import { Router, type Request, type Response } from "express";

export function registerHealthRoutes(): Router {
  const router = Router();
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });
  return router;
}
