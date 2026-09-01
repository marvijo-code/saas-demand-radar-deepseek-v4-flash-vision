import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { DatabaseConnection } from "../db/index.js";
import { authMiddleware } from "../auth/session.js";
import { parseWindow } from "../ranking/score.js";
import { rankNeeds, scoreNeed, getReferenceTime } from "../ranking/service.js";

const listQuerySchema = z.object({
  window: z.enum(["24h", "7d", "30d"]).optional(),
  search: z.string().optional(),
  platform: z.string().optional(),
  status: z.string().optional(),
  sort: z.enum(["score", "newest", "title"]).optional().default("score"),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
});

interface EvidenceDisplay {
  recordId: number;
  externalId: string;
  platform: string;
  author: string;
  url: string;
  publishedAt: string;
  text: string;
  engagement: Record<string, number>;
  isRelevant: boolean | null;
  willingnessToPay: boolean;
  contacted: boolean;
}

function loadEvidenceForNeed(
  db: DatabaseConnection,
  workspaceId: number,
  needId: number,
  windowRaw?: string
): EvidenceDisplay[] {
  const rows = db
    .prepare(
      `SELECT ne.id AS evidence_id, r.id AS record_id, r.external_id, r.platform, r.author,
              r.url, r.published_at, r.text, r.likes, r.replies, r.reposts, r.upvotes, r.comments
       FROM need_evidence ne
       JOIN source_records r ON r.id = ne.record_id
       WHERE ne.need_id = ? AND r.workspace_id = ?
       ORDER BY r.published_at DESC`
    )
    .all(needId, workspaceId) as Array<{
    evidence_id: number;
    record_id: number;
    external_id: string;
    platform: string;
    author: string;
    url: string;
    published_at: string;
    text: string;
    likes: number;
    replies: number;
    reposts: number;
    upvotes: number;
    comments: number;
  }>;

  const needFeedback = db
    .prepare(
      `SELECT relevant, willingness_to_pay, contacted FROM feedback
       WHERE workspace_id = ? AND need_id = ? AND target_type = 'need'
       ORDER BY id DESC LIMIT 1`
    )
    .get(workspaceId, needId) as
    | { relevant: number | null; willingness_to_pay: number; contacted: number }
    | undefined;

  const evStmt = db.prepare(
    `SELECT relevant, willingness_to_pay, contacted FROM feedback
     WHERE workspace_id = ? AND evidence_id = ? AND target_type = 'evidence'
     ORDER BY id DESC LIMIT 1`
  );

  return rows.map((r) => {
    const ev = evStmt.get(workspaceId, r.evidence_id) as
      | { relevant: number | null; willingness_to_pay: number; contacted: number }
      | undefined;
    let relevant = needFeedback?.relevant ?? null;
    let wtp = !!needFeedback?.willingness_to_pay;
    let contacted = !!needFeedback?.contacted;
    if (ev) {
      if (ev.relevant !== null) relevant = ev.relevant === 1;
      wtp = wtp || !!ev.willingness_to_pay;
      contacted = contacted || !!ev.contacted;
    }
    return {
      recordId: r.record_id,
      externalId: r.external_id,
      platform: r.platform,
      author: r.author,
      url: r.url,
      publishedAt: r.published_at,
      text: r.text,
      engagement: {
        likes: r.likes,
        replies: r.replies,
        reposts: r.reposts,
        upvotes: r.upvotes,
        comments: r.comments,
      },
      isRelevant: relevant === null ? null : relevant === 1,
      willingnessToPay: wtp,
      contacted,
    };
  });
}

export function registerNeedRoutes(db: DatabaseConnection): Router {
  const router = Router();

  router.get("/", authMiddleware(db), (req: Request, res: Response) => {
    const parsed = listQuerySchema.parse(req.query);
    const windowKey = parseWindow(parsed.window);
    const ranked = rankNeeds(db, req.user!.workspaceId, windowKey);

    const needRows = db
      .prepare(
        `SELECT id, title, summary, status, created_at, updated_at
         FROM needs WHERE workspace_id = ?`
      )
      .all(req.user!.workspaceId) as Array<{
      id: number;
      title: string;
      summary: string;
      status: string;
      created_at: string;
      updated_at: string;
    }>;

    const rankMap = new Map(ranked.map((n) => [n.needId, n]));

    let items = needRows.map((row) => {
      const sc = rankMap.get(row.id);
      return {
        id: row.id,
        title: row.title,
        summary: row.summary,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        score: sc?.score.total ?? 0,
        breakdown: sc?.score ?? null,
        rank: sc?.rank ?? null,
        evidenceCount: sc?.evidenceCount ?? 0,
        platforms: sc?.platforms ?? [],
      };
    });

    const q = (parsed.search ?? "").trim().toLowerCase();
    if (q) {
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q)
      );
    }
    if (parsed.platform) {
      items = items.filter((i) => i.platforms.includes(parsed.platform!));
    }
    if (parsed.status) {
      items = items.filter((i) => i.status === parsed.status);
    }

    if (parsed.sort === "newest") {
      items.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else if (parsed.sort === "title") {
      items.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      items.sort((a, b) => b.score - a.score);
    }

    const total = items.length;
    const start = (parsed.page - 1) * parsed.pageSize;
    const paged = items.slice(start, start + parsed.pageSize);

    return res.json({
      needs: paged,
      total,
      page: parsed.page,
      pageSize: parsed.pageSize,
      window: windowKey,
    });
  });

  router.get("/:id", authMiddleware(db), (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

    const need = db
      .prepare(`SELECT * FROM needs WHERE id = ? AND workspace_id = ?`)
      .get(id, req.user!.workspaceId) as
      | { id: number; title: string; summary: string; status: string; created_at: string; updated_at: string }
      | undefined;
    if (!need) return res.status(404).json({ error: "Need not found" });

    const windowRaw = req.query.window as string | undefined;
    const windowKey = parseWindow(windowRaw);
    const breakdown = scoreNeed(db, req.user!.workspaceId, id, windowKey);
    const evidence = loadEvidenceForNeed(db, req.user!.workspaceId, id);

    const trend = (["24h", "7d", "30d"] as const).map((w) => {
      const s = scoreNeed(db, req.user!.workspaceId, id, w);
      const now = getReferenceTime(db, req.user!.workspaceId);
      const count = db
        .prepare(
          `SELECT COUNT(*) AS c FROM need_evidence ne
           JOIN source_records r ON r.id = ne.record_id
           WHERE ne.need_id = ? AND r.workspace_id = ? AND r.published_at >= ? AND r.published_at <= ?`
        )
        .get(id, req.user!.workspaceId, new Date(now - (w === "24h" ? 864e5 : w === "7d" ? 7 * 864e5 : 30 * 864e5)).toISOString(), new Date(now).toISOString()) as { c: number };
      return { window: w, score: s.total, evidenceCount: count.c };
    });

    const feedback = db
      .prepare(
        `SELECT f.id, f.target_type, f.relevant, f.willingness_to_pay, f.contacted,
                f.note, f.created_at, u.email AS created_by_email,
                r.author AS record_author, r.url AS record_url, r.text AS record_text
         FROM feedback f
         LEFT JOIN users u ON u.id = f.created_by
         LEFT JOIN need_evidence ne ON ne.id = f.evidence_id
         LEFT JOIN source_records r ON r.id = ne.record_id
         WHERE f.workspace_id = ? AND f.need_id = ?
         ORDER BY f.id DESC`
      )
      .all(req.user!.workspaceId, id);

    return res.json({
      need,
      window: windowKey,
      score: breakdown,
      evidence,
      trend,
      feedback,
    });
  });

  return router;
}
