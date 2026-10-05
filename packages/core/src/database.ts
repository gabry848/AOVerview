import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const schemaVersion = 2;

export function connectDatabase(path: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly, timeout: 5000, enableForeignKeyConstraints: true });
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  if (readOnly) db.exec("PRAGMA query_only = ON;");
  return db;
}

export function migrateDatabase(path: string): void {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = connectDatabase(path);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; BEGIN IMMEDIATE;");
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    if (version > schemaVersion) throw new Error("The database belongs to a newer AOVerview version.");
    if (version === 0) {
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, rootAgentId TEXT NOT NULL,
          createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE agents (
          id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id),
          parentAgentId TEXT REFERENCES agents(id), parentBlockId TEXT, goalId TEXT,
          handle TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mandate TEXT,
          status TEXT NOT NULL CHECK(status IN ('reserved','running','completed','failed','cancelled')),
          revision INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
          endedAt INTEGER, integratedAt INTEGER, integratedIntoBlockId TEXT, integrationNote TEXT
        ) STRICT;
        CREATE INDEX agents_session ON agents(sessionId, createdAt);
        CREATE INDEX agents_parent ON agents(parentAgentId);
        CREATE TABLE goals (
          sessionId TEXT NOT NULL REFERENCES sessions(id), id TEXT NOT NULL,
          title TEXT NOT NULL, description TEXT, status TEXT NOT NULL
            CHECK(status IN ('pending','active','blocked','completed','cancelled')),
          position INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
          PRIMARY KEY(sessionId, id)
        ) STRICT;
        CREATE TABLE blocks (
          agentId TEXT NOT NULL REFERENCES agents(id), id TEXT NOT NULL,
          goalId TEXT, title TEXT NOT NULL, summary TEXT, status TEXT NOT NULL
            CHECK(status IN ('proposed','active','blocked','completed','failed','cancelled')),
          outcome TEXT, concern TEXT, position INTEGER NOT NULL,
          createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, startedAt INTEGER, endedAt INTEGER,
          PRIMARY KEY(agentId, id)
        ) STRICT;
        CREATE INDEX blocks_activity ON blocks(agentId, status, startedAt);
        CREATE TABLE details (
          agentId TEXT NOT NULL, blockId TEXT NOT NULL, id TEXT NOT NULL,
          action TEXT NOT NULL, result TEXT, position INTEGER NOT NULL,
          createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
          PRIMARY KEY(agentId, blockId, id),
          FOREIGN KEY(agentId, blockId) REFERENCES blocks(agentId, id)
        ) STRICT;
        CREATE TABLE receipts (
          scope TEXT NOT NULL, requestId TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL,
          PRIMARY KEY(scope, requestId)
        ) STRICT;
        CREATE TABLE changes (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          sessionId TEXT NOT NULL REFERENCES sessions(id), agentId TEXT NOT NULL REFERENCES agents(id)
        ) STRICT;
        PRAGMA user_version = 1;
      `);
    }
    if (version < 2) {
      db.exec(`
        ALTER TABLE sessions ADD COLUMN detailLevel TEXT NOT NULL DEFAULT 'medium'
          CHECK(detailLevel IN ('low','medium','high'));
        ALTER TABLE details ADD COLUMN reference TEXT;
        PRAGMA user_version = 2;
      `);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.close();
  }
}
