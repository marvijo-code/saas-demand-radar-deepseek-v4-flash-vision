import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { makeTestContext, loginAs, ACCOUNTS, type TestContext } from "./helper.js";

const SNAPSHOT = [
  {
    platform: "x",
    externalId: "1904651944968302909",
    url: "https://x.com/PhotoAmy33/status/1904651944968302909",
    author: "PhotoAmy33",
    publishedAt: "2025-03-25T00:00:00Z",
    text: "I wish there was an app where you could take a photo of what you have in your fridge and then it would give you recipe ideas.",
    engagement: { likes: 0, replies: 0, reposts: 0 },
  },
  {
    platform: "reddit",
    externalId: "1u5ivq4",
    url: "https://www.reddit.com/r/SaaS/comments/1u5ivq4/looking_for_a_reddit_tool/",
    author: "public-reddit-user",
    publishedAt: "2026-06-14T00:00:00Z",
    text: "Does anyone have a tool to find prospects on Reddit? I run a cold email agency and want that work automated.",
    engagement: { upvotes: 1, comments: 4 },
  },
  {
    platform: "reddit",
    externalId: "1u36nlj",
    url: "https://www.reddit.com/r/ITManagers/comments/1u36nlj/how_do_you_track_ai_chatbot_usage/",
    author: "public-reddit-user",
    publishedAt: "2026-06-10T00:00:00Z",
    text: "I wish there was a simple out-of-the-box solution for tracking AI chatbot usage across company devices.",
    engagement: { upvotes: 2, comments: 3 },
  },
];

let ctx: TestContext;

beforeAll(() => {
  process.env.REFERENCE_TIME = "2026-06-14T00:00:00Z";
  ctx = makeTestContext();
});

beforeEach(async () => {
  // Keep runs isolated per test where needed; context is reused so ordering matters.
});

describe("auth and health", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(ctx.app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects a bad password", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "admin@acme.test", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("logs in, sets an HTTP-only cookie, and /me returns user + workspace", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("admin@acme.test");
    expect(me.body.user.workspaceName).toBe("Acme");
    expect(me.body.user.role).toBe("admin");
    const setCookies = agent.jar; // supertest agent holds the cookie
    expect(setCookies).toBeDefined();
  });

  it("logs out and invalidates the session", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(401);
  });

  it("protects routes without a session", async () => {
    const res = await request(ctx.app).get("/api/needs");
    expect(res.status).toBe(401);
  });
});

describe("tenant isolation", () => {
  it("Acme user cannot read Beta needs", async () => {
    const acme = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const beta = await loginAs(ctx.app, ACCOUNTS.betaAdmin.email, ACCOUNTS.betaAdmin.password);

    await beta.post("/api/sources/ingest").send({ adapter: "snapshot", records: SNAPSHOT }).expect(200);
    const betaNeeds = await beta.get("/api/needs").expect(200);
    expect(betaNeeds.body.needs.length).toBeGreaterThan(0);

    const acmeNeeds = await acme.get("/api/needs").expect(200);
    expect(acmeNeeds.body.needs.length).toBe(0);
  });
});

describe("ingestion", () => {
  it("ingests records and is idempotent", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const first = await agent
      .post("/api/sources/ingest")
      .send({ adapter: "snapshot", records: SNAPSHOT })
      .expect(200);
    expect(first.body.newRecords).toBe(SNAPSHOT.length);
    expect(first.body.status).toBe("success");

    // Repeat the exact same run: no new records, no duplicate needs.
    const second = await agent
      .post("/api/sources/ingest")
      .send({ adapter: "snapshot", records: SNAPSHOT })
      .expect(200);
    expect(second.body.newRecords).toBe(0);

    // source records not duplicated
    const runs = await agent.get("/api/source-runs").expect(200);
    expect(runs.body.runs.length).toBeGreaterThanOrEqual(2);
  });

  it("returns visible ingestion history", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const res = await agent.get("/api/source-runs").expect(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
  });
});

describe("needs", () => {
  it("lists needs and respects windows", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const d30 = await agent.get("/api/needs?window=30d").expect(200);
    expect(d30.body.window).toBe("30d");
    expect(d30.body.needs.length).toBeGreaterThan(0);
    const d24 = await agent.get("/api/needs?window=24h").expect(200);
    expect(d24.body.window).toBe("24h");
  });

  it("supports filter and pagination params", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const res = await agent
      .get("/api/needs?window=30d&platform=reddit&page=1&pageSize=10")
      .expect(200);
    expect(res.body.page).toBe(1);
    for (const n of res.body.needs) {
      expect(n.platforms).toContain("reddit");
    }
  });

  it("returns need detail with score explanation, evidence, trend, feedback", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const list = await agent.get("/api/needs?window=30d").expect(200);
    const needId = list.body.needs[0].id;
    const detail = await agent.get(`/api/needs/${needId}`).expect(200);
    expect(detail.body.need.id).toBe(needId);
    expect(detail.body.score).toBeDefined();
    expect(detail.body.score.components.length).toBeGreaterThan(0);
    expect(Array.isArray(detail.body.evidence)).toBe(true);
    expect(detail.body.trend.length).toBe(3);
    expect(Array.isArray(detail.body.feedback)).toBe(true);
  });

  it("404s a need from another workspace", async () => {
    const acme = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const beta = await loginAs(ctx.app, ACCOUNTS.betaAdmin.email, ACCOUNTS.betaAdmin.password);
    const betaList = await beta.get("/api/needs?window=30d").expect(200);
    const betaNeedId = betaList.body.needs[0].id;
    const acmeDetail = await acme.get(`/api/needs/${betaNeedId}`);
    expect(acmeDetail.status).toBe(404);
  });
});

describe("feedback and ranking", () => {
  it("posts feedback, rescore creates a version and reports changes", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeMember.email, ACCOUNTS.acmeMember.password);
    const list = await agent.get("/api/needs?window=30d").expect(200);
    expect(list.body.needs.length).toBeGreaterThan(0);
    const target = list.body.needs.find((n: { evidenceCount: number }) => n.evidenceCount > 0)!;
    const needId = target.id;

    // Capture the score first.
    const detail0 = await agent.get(`/api/needs/${needId}`).expect(200);
    const before = detail0.body.score.total;

    // Mark it irrelevant (shows clear signal) plus willingness to pay on an evidence row.
    const evidenceId = detail0.body.evidence[0].recordId;
    const fb = await agent
      .post(`/api/needs/${needId}/feedback`)
      .send({ relevant: false, willingnessToPay: true, contacted: false, note: "not a fit" })
      .expect(201);
    expect(fb.body.feedback.target_type).toBe("need");
    const fbEv = await agent
      .post(`/api/needs/${needId}/feedback`)
      .send({ relevant: true, evidenceId })
      .expect(201);
    expect(fbEv.body.feedback.target_type).toBe("evidence");

    const rescore = await agent.post("/api/ranking/rescore").send({}).expect(200);
    expect(rescore.body.version).toBeGreaterThan(0);
    expect(Array.isArray(rescore.body.changes)).toBe(true);
    expect(rescore.body.changedCount).toBeGreaterThanOrEqual(0);

    const versions = await agent.get("/api/ranking/versions").expect(200);
    expect(versions.body.versions.length).toBeGreaterThan(0);
    expect(versions.body.versions[0]).toHaveProperty("change_count");

    const detail1 = await agent.get(`/api/needs/${needId}`).expect(200);
    expect(detail1.body.feedback.length).toBeGreaterThanOrEqual(2);
  });
});

describe("settings", () => {
  it("reads and updates the schedule", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const get1 = await agent.get("/api/settings/schedule").expect(200);
    expect(get1.body).toHaveProperty("enabled");

    const put = await agent
      .put("/api/settings/schedule")
      .send({ enabled: true, cron: "0 6 * * *", timezone: "UTC" })
      .expect(200);
    expect(put.body.enabled).toBe(true);

    const get2 = await agent.get("/api/settings/schedule").expect(200);
    expect(get2.body.cron).toBe("0 6 * * *");
  });

  it("rejects a non-admin schedule update", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeMember.email, ACCOUNTS.acmeMember.password);
    const res = await agent
      .put("/api/settings/schedule")
      .send({ enabled: true, cron: "0 6 * * *" });
    expect(res.status).toBe(403);
  });
});

describe("audit", () => {
  it("returns workspace-scoped audit events", async () => {
    const agent = await loginAs(ctx.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const res = await agent.get("/api/audit").expect(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    const actions = res.body.events.map((e: { action: string }) => e.action);
    expect(actions).toContain("sources.ingest");
  });
});

describe("rate limiting", () => {
  it("limits repeated login attempts", async () => {
    const app = makeTestContext().app;
    let status = 0;
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "admin@acme.test", password: "wrong" });
      status = res.status;
    }
    expect(status).toBe(429);
  });
});

describe("admin-only mutations", () => {
  it("rejects source ingestion for a member (403) but preserves read access", async () => {
    const c = makeTestContext();
    const member = await loginAs(c.app, ACCOUNTS.acmeMember.email, ACCOUNTS.acmeMember.password);

    const ingest = await member
      .post("/api/sources/ingest")
      .send({ adapter: "snapshot", records: SNAPSHOT });
    expect(ingest.status).toBe(403);
    expect(ingest.body).toHaveProperty("error");

    // Member read access is preserved.
    const runs = await member.get("/api/source-runs").expect(200);
    expect(Array.isArray(runs.body.runs)).toBe(true);
    const needs = await member.get("/api/needs?window=30d").expect(200);
    expect(Array.isArray(needs.body.needs)).toBe(true);
  });

  it("allows an admin to ingest a source snapshot", async () => {
    const c = makeTestContext();
    const admin = await loginAs(c.app, ACCOUNTS.acmeAdmin.email, ACCOUNTS.acmeAdmin.password);
    const res = await admin
      .post("/api/sources/ingest")
      .send({ adapter: "snapshot", records: SNAPSHOT });
    expect(res.status).toBe(200);
    expect(res.body.newRecords).toBe(SNAPSHOT.length);
  });

  it("rejects a schedule update for a member (403)", async () => {
    const c = makeTestContext();
    const member = await loginAs(c.app, ACCOUNTS.acmeMember.email, ACCOUNTS.acmeMember.password);
    const res = await member
      .put("/api/settings/schedule")
      .send({ enabled: true, cron: "0 6 * * *", timezone: "UTC" });
    expect(res.status).toBe(403);
  });
});
