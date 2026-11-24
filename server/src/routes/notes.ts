import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  CreateNoteRequest,
  ExtendNoteRequest,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  UpdateNoteRequest,
  type ProgressEvent,
} from "@revision-desk/shared";
import { createNotes, extendNotes, type PipelineResult } from "../agents/orchestrator.ts";
import { AgentError } from "../agents/llm.ts";
import { notesRepo, saveNoteWithAssets } from "../db.ts";
import { emptyUploads, processUploads, type ProcessedUploads } from "../materials.ts";
import { renderNotesPdf } from "../pdf.ts";

export const notesRouter = Router();

/** Slide decks and images arrive as multipart "files" alongside the text fields. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES } });
const acceptFiles = (req: Request, res: Response, next: NextFunction) =>
  upload.array("files", MAX_UPLOAD_FILES)(req, res, (err: unknown) => {
    if (!err) return next();
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? `Each file must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
        : err instanceof multer.MulterError && (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE")
          ? `Upload at most ${MAX_UPLOAD_FILES} files at a time.`
          : "The upload couldn't be read. Try again.";
    res.status(400).json({ error: message });
  });

const uploadedFiles = (req: Request) =>
  ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({
    // Browsers send UTF-8 names, which multer reads as latin1.
    originalname: Buffer.from(f.originalname, "latin1").toString("utf8"),
    buffer: f.buffer,
  }));

/**
 * Run an agent workflow and stream its progress to the browser as Server-Sent Events.
 * Uploaded files are unpacked first. If the browser disconnects (the user pressed Cancel),
 * the agents are aborted and nothing is saved.
 */
async function streamWorkflow(
  req: Request,
  res: Response,
  run: (uploads: ProcessedUploads, emit: (ev: ProgressEvent) => void, signal: AbortSignal) => Promise<PipelineResult>,
) {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const ctrl = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ctrl.abort();
  });
  const send = (ev: ProgressEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  const heartbeat = setInterval(() => !res.writableEnded && res.write(": keep-alive\n\n"), 15_000);

  let uploads = emptyUploads();
  try {
    const files = uploadedFiles(req);
    if (files.length) {
      send({ type: "stage", agent: "files", message: `Opening ${files.length} uploaded file${files.length > 1 ? "s" : ""}…` });
      uploads = await processUploads(files);
    }
    const result = await run(uploads, send, ctrl.signal);
    if (ctrl.signal.aborted) return;
    saveNoteWithAssets(result.note, result.assets);
    send({ type: "done", note: result.note, focusSectionId: result.focusSectionId, summary: result.summary, warnings: result.warnings });
  } catch (err) {
    if (!ctrl.signal.aborted) {
      const base = err instanceof AgentError ? err.message : "Something went wrong. Nothing was changed. Try again.";
      // Say why uploaded files were skipped, since that is often the reason there was nothing to use.
      send({ type: "error", message: [base, ...uploads.warnings].join(" ") });
      if (!(err instanceof AgentError)) console.error(err);
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

function badRequest(res: Response, message: string) {
  res.status(400).json({ error: message });
}

notesRouter.get("/", (_req, res) => {
  res.json(notesRepo.list());
});

notesRouter.get("/:id", (req, res) => {
  const note = notesRepo.get(req.params.id);
  if (!note) return void res.status(404).json({ error: "These notes don't exist any more." });
  res.json(note);
});

notesRouter.post("/", acceptFiles, async (req: Request, res: Response) => {
  const parsed = CreateNoteRequest.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, "Send a transcript, or slides and images, to turn into notes.");
  await streamWorkflow(req, res, (uploads, emit, signal) => createNotes(parsed.data, uploads, emit, signal));
});

notesRouter.post("/:id/extend", acceptFiles, async (req: Request, res: Response) => {
  const note = notesRepo.get(String(req.params.id));
  if (!note) return void res.status(404).json({ error: "These notes don't exist any more." });
  const parsed = ExtendNoteRequest.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, "Choose how to add the material.");
  if (parsed.data.mode === "continue" && !parsed.data.sectionId) return badRequest(res, "Pick the section to continue.");
  await streamWorkflow(req, res, (uploads, emit, signal) => extendNotes(note, parsed.data, uploads, emit, signal));
});

notesRouter.patch("/:id", (req, res) => {
  const note = notesRepo.get(req.params.id);
  if (!note) return void res.status(404).json({ error: "These notes don't exist any more." });
  const parsed = UpdateNoteRequest.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Titles must be 1-160 characters.");
  if (parsed.data.title !== undefined) note.title = parsed.data.title.trim();
  if (parsed.data.transcript !== undefined) note.transcript = parsed.data.transcript;
  note.updatedAt = Date.now();
  res.json(notesRepo.save(note));
});

notesRouter.delete("/:id", (req, res) => {
  if (!notesRepo.remove(req.params.id)) return void res.status(404).json({ error: "These notes don't exist any more." });
  res.status(204).end();
});

notesRouter.get("/:id/pdf", async (req, res) => {
  const note = notesRepo.get(req.params.id);
  if (!note) return void res.status(404).json({ error: "These notes don't exist any more." });
  try {
    const pdf = await renderNotesPdf(note);
    const filename = (note.title || "revision-notes").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "revision-notes";
    res
      .status(200)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, "_")}.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}.pdf`,
      })
      .end(Buffer.from(pdf));
  } catch (err) {
    console.error("PDF export failed", err);
    res.status(500).json({ error: "Couldn't build the PDF. Make sure Chrome for Puppeteer is installed (see README)." });
  }
});
