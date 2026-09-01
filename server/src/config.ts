import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getConfig() {
  const env = process.env;
  const root = path.resolve(__dirname, "..", "..");
  const dbPath =
    env.DATABASE_PATH ||
    path.join(path.resolve(__dirname, ".."), "data", "demand-radar.db");

  return {
    serverPort: Number(env.PORT || 4174),
    databasePath: dbPath,
    sessionCookie: "sdr_session",
    sessionTtlMs: Number(env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7),
    isTest: env.NODE_ENV === "test" || !!env.IS_TEST,
    isProduction: env.NODE_ENV === "production",
  };
}

export type AppConfig = ReturnType<typeof getConfig>;
