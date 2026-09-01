import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config.js";

export interface SourceRecordIngest {
  platform: string;
  externalId: string;
  url: string;
  author: string;
  publishedAt: string;
  text: string;
  engagement: Record<string, number>;
}

export type DatabaseConnection = Database.Database;

export function openDatabase(dbPath?: string): DatabaseConnection {
  const config = getConfig();
  const resolved = dbPath || config.databasePath;
  if (resolved !== ":memory:") {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function runMigrations(db: DatabaseConnection): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','member')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS source_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      adapter TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','success','failed')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      records_ingested INTEGER NOT NULL DEFAULT 0,
      records_total INTEGER NOT NULL DEFAULT 0,
      new_records INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      trigger TEXT NOT NULL DEFAULT 'manual',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_workspace ON source_runs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started ON source_runs(started_at);

    CREATE TABLE IF NOT EXISTS source_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      run_id INTEGER NOT NULL REFERENCES source_runs(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      external_id TEXT NOT NULL,
      url TEXT NOT NULL,
      author TEXT NOT NULL,
      published_at TEXT NOT NULL,
      text TEXT NOT NULL,
      likes INTEGER NOT NULL DEFAULT 0,
      replies INTEGER NOT NULL DEFAULT 0,
      reposts INTEGER NOT NULL DEFAULT 0,
      upvotes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (workspace_id, platform, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_records_ws_platform ON source_records(workspace_id, platform);
    CREATE INDEX IF NOT EXISTS idx_records_published ON source_records(published_at);

    CREATE TABLE IF NOT EXISTS phrases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      phrase_type TEXT NOT NULL CHECK (phrase_type IN ('buying_intent','tool_request','workaround','price_complaint','operational_pain')),
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (workspace_id, text, phrase_type)
    );

    CREATE TABLE IF NOT EXISTS demand_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      record_id INTEGER NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
      phrase_id INTEGER NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
      signal_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (workspace_id, record_id, phrase_id)
    );

    CREATE INDEX IF NOT EXISTS idx_signals_record ON demand_signals(record_id);
    CREATE INDEX IF NOT EXISTS idx_signals_ws ON demand_signals(workspace_id);

    CREATE TABLE IF NOT EXISTS needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','won','ignored')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_needs_ws ON needs(workspace_id);

    CREATE TABLE IF NOT EXISTS need_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      need_id INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      record_id INTEGER NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (need_id, record_id)
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_need ON need_evidence(need_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_record ON need_evidence(record_id);

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      need_id INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      evidence_id INTEGER REFERENCES need_evidence(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('need','evidence')),
      relevant INTEGER,
      willingness_to_pay INTEGER NOT NULL DEFAULT 0,
      contacted INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_ws ON feedback(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_need ON feedback(need_id);

    CREATE TABLE IF NOT EXISTS ranking_model_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      label TEXT NOT NULL,
      weights TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      note TEXT,
      triggered_by_feedback_id INTEGER REFERENCES feedback(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_model_version_ws ON ranking_model_versions(workspace_id);

    CREATE TABLE IF NOT EXISTS ranking_active (
      workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      model_weights TEXT NOT NULL,
      phrase_weights TEXT NOT NULL,
      platform_weights TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ranking_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id INTEGER NOT NULL REFERENCES ranking_model_versions(id) ON DELETE CASCADE,
      need_id INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      previous_score REAL,
      new_score REAL,
      previous_rank INTEGER,
      new_rank INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_changes_version ON ranking_changes(version_id);

    CREATE TABLE IF NOT EXISTS workspace_settings (
      workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      schedule_enabled INTEGER NOT NULL DEFAULT 0,
      schedule_cron TEXT,
      schedule_timezone TEXT NOT NULL DEFAULT 'UTC',
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_logs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);
}

export interface SeedAccount {
  email: string;
  name: string;
  password: string;
  role: "admin" | "member";
  workspace: string;
}
