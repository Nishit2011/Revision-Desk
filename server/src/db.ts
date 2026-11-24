import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Note, NoteSummary } from "@revision-desk/shared";
import { config } from "./config.ts";

mkdirSync(path.dirname(config.databasePath), { recursive: true });
const db = new DatabaseSync(config.databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    section_count INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    body          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notes_created_at ON notes (created_at DESC);
  CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL,
    mime       TEXT NOT NULL,
    data       BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assets_note ON assets (note_id);
`);

const assetGetStmt = db.prepare("SELECT mime, data FROM assets WHERE id = ?");
const assetInsertStmt = db.prepare("INSERT OR IGNORE INTO assets (id, note_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)");
const assetDeleteForNoteStmt = db.prepare("DELETE FROM assets WHERE note_id = ?");

export const assetsRepo = {
  get(id: string): { mime: string; data: Uint8Array } | null {
    const row = assetGetStmt.get(id);
    return row ? { mime: String(row.mime), data: row.data as Uint8Array } : null;
  },
};

/** Save a note and any new images in one transaction, so a failure never leaves half a save. */
export function saveNoteWithAssets(note: Note, assets: { id: string; mime: string; data: Buffer }[]) {
  db.exec("BEGIN");
  try {
    const now = Date.now();
    for (const a of assets) assetInsertStmt.run(a.id, note.id, a.mime, a.data, now);
    notesRepo.save(note);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const listStmt = db.prepare(
  "SELECT id, title, section_count, created_at, updated_at FROM notes ORDER BY created_at DESC",
);
const getStmt = db.prepare("SELECT body FROM notes WHERE id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO notes (id, title, section_count, created_at, updated_at, body)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    section_count = excluded.section_count,
    updated_at = excluded.updated_at,
    body = excluded.body
`);
const deleteStmt = db.prepare("DELETE FROM notes WHERE id = ?");

export const notesRepo = {
  list(): NoteSummary[] {
    return listStmt.all().map((r) => ({
      id: String(r.id),
      title: String(r.title),
      sectionCount: Number(r.section_count),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  },

  get(id: string): Note | null {
    const row = getStmt.get(id);
    return row ? (JSON.parse(String(row.body)) as Note) : null;
  },

  save(note: Note): Note {
    upsertStmt.run(note.id, note.title, note.sections.length, note.createdAt, note.updatedAt, JSON.stringify(note));
    return note;
  },

  remove(id: string): boolean {
    assetDeleteForNoteStmt.run(id);
    return Number(deleteStmt.run(id).changes) > 0;
  },
};
