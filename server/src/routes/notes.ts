import { Router, type Request, type Response } from "express";
import { CreateNoteRequest, ExtendNoteRequest, UpdateNoteRequest, type ProgressEvent } from "@revision-desk/shared";
import { createNotes, extendNotes, type PipelineResult } from "../agents/orchestrator.ts";
import { AgentError } from "../agents/llm.ts";
import { notesRepo } from "../db.ts";
import { renderNotesPdf } from "../pdf.ts";

export const notesRouter = Router();

/**
 * Run an agent workflow and stream its progress to the browser as Server-Sent Events.
 * If the browser disconnects (the user pressed Cancel), the agents are aborted and nothing is saved.
 */
async function streamWorkflow(res: Response, run: (emit: (ev: ProgressEvent) => void, signal: AbortSignal) => Promise<PipelineResult>) {
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

  try {
    const result = await run(send, ctrl.signal);
    if (ctrl.signal.aborted) return;
    notesRepo.save(result.note);
    send({ type: "done", note: result.note, focusSectionId: result.focusSectionId, summary: result.summary });
  } catch (err) {
    if (!ctrl.signal.aborted) {
      send({ type: "error", message: err instanceof AgentError ? err.message : "Something went wrong. Nothing was changed. Try again." });
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

notesRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateNoteRequest.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Send a transcript to turn into notes.");
  await streamWorkflow(res, (emit, signal) => createNotes(parsed.data, emit, signal));
});

notesRouter.post("/:id/extend", async (req: Request, res: Response) => {
  const note = notesRepo.get(String(req.params.id));
  if (!note) return void res.status(404).json({ error: "These notes don't exist any more." });
  const parsed = ExtendNoteRequest.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Choose how to add the content: new sections, continue a section, or rebuild.");
  if (parsed.data.mode === "continue" && !parsed.data.sectionId) return badRequest(res, "Pick the section to continue.");
  await streamWorkflow(res, (emit, signal) => extendNotes(note, parsed.data, emit, signal));
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
