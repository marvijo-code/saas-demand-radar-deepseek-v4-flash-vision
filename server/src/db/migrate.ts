import { openDatabase, runMigrations, type DatabaseConnection } from "./index.js";
import { hashPassword } from "../auth/password.js";

export const SEED_ACCOUNTS = [
  {
    workspace: "Acme",
    email: "admin@acme.test",
    name: "Acme Admin",
    password: "AcmeAdmin!2026",
    role: "admin",
  },
  {
    workspace: "Acme",
    email: "member@acme.test",
    name: "Acme Member",
    password: "AcmeMember!2026",
    role: "member",
  },
  {
    workspace: "Beta",
    email: "admin@beta.test",
    name: "Beta Admin",
    password: "BetaAdmin!2026",
    role: "admin",
  },
] as const;

export function seedDatabase(db: DatabaseConnection): void {
  const insertWorkspace = db.prepare(
    "INSERT OR IGNORE INTO workspaces (name) VALUES (?)"
  );
  const getWorkspace = db.prepare("SELECT id FROM workspaces WHERE name = ?");
  const insertUser = db.prepare(
    `INSERT OR IGNORE INTO users (workspace_id, email, name, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertSettings = db.prepare(
    `INSERT OR IGNORE INTO workspace_settings (workspace_id, schedule_enabled, schedule_cron, schedule_timezone)
     VALUES (?, 0, NULL, 'UTC')`
  );

  for (const account of SEED_ACCOUNTS) {
    insertWorkspace.run(account.workspace);
    const workspace = getWorkspace.get(account.workspace) as { id: number };
    insertSettings.run(workspace.id);
    insertUser.run(
      workspace.id,
      account.email,
      account.name,
      hashPassword(account.password),
      account.role
    );
  }
}

export function migrateDatabase(dbPath?: string): void {
  const db = openDatabase(dbPath);
  runMigrations(db);
  seedDatabase(db);
  db.close();
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  migrateDatabase();
  // eslint-disable-next-line no-console
  console.log("Database migrated and seeded.");
}
