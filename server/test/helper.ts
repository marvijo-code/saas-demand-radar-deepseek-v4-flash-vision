import request from "supertest";
import type Database from "better-sqlite3";
import { openDatabase, runMigrations } from "../src/db/index.js";
import { seedDatabase } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";

export function makeTestContext() {
  const db: Database.Database = openDatabase(":memory:");
  runMigrations(db);
  seedDatabase(db);
  const app = createApp(db);
  return { db, app };
}

export type TestContext = ReturnType<typeof makeTestContext>;

export async function loginAs(app: ReturnType<typeof createApp>, email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export const ACCOUNTS = {
  acmeAdmin: { email: "admin@acme.test", password: "AcmeAdmin!2026" },
  acmeMember: { email: "member@acme.test", password: "AcmeMember!2026" },
  betaAdmin: { email: "admin@beta.test", password: "BetaAdmin!2026" },
};
