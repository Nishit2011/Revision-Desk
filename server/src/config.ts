import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "../..");

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

const effortEnv = (process.env.CLAUDE_EFFORT ?? "medium") as Effort;

export const config = {
  port: Number(process.env.PORT ?? 8787),
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  effort: EFFORTS.includes(effortEnv) ? effortEnv : ("medium" as Effort),
  databasePath: path.resolve(ROOT_DIR, process.env.DATABASE_PATH ?? "./data/revision-desk.db"),
  webDist: path.resolve(ROOT_DIR, "web/dist"),
  /** Section writers and diagram agents run in parallel, up to this many at once. */
  agentConcurrency: Number(process.env.AGENT_CONCURRENCY ?? 4),
  /** Transcripts longer than this are rejected with a clear message rather than silently cut. */
  maxTranscriptChars: Number(process.env.MAX_TRANSCRIPT_CHARS ?? 600_000),
};
