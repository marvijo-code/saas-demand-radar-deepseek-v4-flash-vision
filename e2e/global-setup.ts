import { request } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.resolve(__dirname, "..", "source-snapshot.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
  records: unknown[];
};

export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext({
    baseURL: "http://127.0.0.1:4174",
  });
  try {
    const login = await ctx.post("/api/auth/login", {
      data: { email: "admin@acme.test", password: "AcmeAdmin!2026" },
    });
    if (!login.ok()) {
      throw new Error(`e2e login failed: ${login.status()} ${await login.text()}`);
    }

    const ingest = await ctx.post("/api/sources/ingest", {
      data: { adapter: "snapshot", records: snapshot.records },
    });
    if (!ingest.ok()) {
      throw new Error(`e2e ingest failed: ${ingest.status()} ${await ingest.text()}`);
    }
  } finally {
    await ctx.dispose();
  }
}
