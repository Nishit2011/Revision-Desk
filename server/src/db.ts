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
`);

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
    return Number(deleteStmt.run(id).changes) > 0;
  },
};
