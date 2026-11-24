import { randomUUID } from "node:crypto";
import {
  cleanTranscript,
  type CreateNoteRequest,
  type ExtendNoteRequest,
  type GlossaryEntry,
  type Note,
  type ProgressEvent,
  type QuizItem,
  type Section,
} from "@revision-desk/shared";
import { config } from "../config.ts";
import { continueAgent } from "./continueAgent.ts";
import { diagramAgent, diagramUpdateAgent } from "./diagramAgent.ts";
import { AgentError, mapLimit } from "./llm.ts";
import { outlineAgent, outlineNewContentAgent, type PlannedSection } from "./outlineAgent.ts";
import { sectionWriterAgent } from "./sectionWriterAgent.ts";
import { studyAidsAgent } from "./studyAidsAgent.ts";

export type Emit = (ev: ProgressEvent) => void;

export interface PipelineResult {
  note: Note;
  focusSectionId?: string;
  summary: string;
}

/* ---------- helpers ---------- */

function prepareSource(raw: string, minChars: number, what: string): string {
  const text = cleanTranscript(raw);
  if (text.length < minChars) throw new AgentError(`Paste or upload ${what} first (at least a few sentences).`);
  if (text.length > config.maxTranscriptChars) {
    throw new AgentError(
      `This transcript is ${text.length.toLocaleString()} characters, over the ${config.maxTranscriptChars.toLocaleString()} limit. Split it and add the rest with "Add to transcript".`,
    );
  }
  return text;
}

/** An AbortController that also aborts when the caller's signal does, so one failed agent can stop its siblings. */
function linkedController(signal?: AbortSignal): AbortController {
  const ctrl = new AbortController();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl;
}

/** Section writer + diagram agent for each planned section, in parallel. */
async function writeSections(
  source: string,
  plans: PlannedSection[],
  allHeadings: string[],
  baseIndex: number,
  emit: Emit,
  signal?: AbortSignal,
): Promise<Section[]> {
  const ctrl = linkedController(signal);
  try {
    return await mapLimit(plans, config.agentConcurrency, async (plan, i) => {
      emit({ type: "section", index: baseIndex + i, heading: plan.heading, status: "writing" });
      const written = await sectionWriterAgent(source, plan, allHeadings, ctrl.signal);
      const diagram = await diagramAgent({ heading: plan.heading, ...written }, ctrl.signal);
      emit({ type: "section", index: baseIndex + i, heading: plan.heading, status: "done" });
      return { id: randomUUID(), heading: plan.heading, ...written, diagram };
    });
  } catch (err) {
    ctrl.abort();
    throw err;
  }
}

function mergeGlossary(existing: GlossaryEntry[], added: GlossaryEntry[]): GlossaryEntry[] {
  const have = new Set(existing.map((g) => g.term.trim().toLowerCase()));
  return [...existing, ...added.filter((g) => g.term.trim() && !have.has(g.term.trim().toLowerCase()))];
}

function appendTranscript(base: string, addition: string): string {
  const a = addition.trim();
  if (!a) return base;
  return base.trim() ? `${base.replace(/\s+$/, "")}\n\n${a}` : a;
}

/** The full outline → writers → diagrams → study aids pipeline over one transcript. */
async function buildNotes(source: string, emit: Emit, signal?: AbortSignal) {
  emit({ type: "stage", agent: "outline", message: "Reading the transcript and planning sections…" });
  const outline = await outlineAgent(source, signal);
  if (!outline.sections.length) throw new AgentError("Claude couldn't find any sections in this transcript. Try a longer one.");
  const headings = outline.sections.map((s) => s.heading);
  emit({ type: "outline", title: outline.title, headings });

  emit({ type: "stage", agent: "section-writer", message: `Writing ${headings.length} sections and drawing diagrams…` });
  const sections = await writeSections(source, outline.sections, headings, 0, emit, signal);

  emit({ type: "stage", agent: "study-aids", message: "Picking key terms and writing self-check questions…" });
  const aids = await studyAidsAgent(sections, { signal });

  return { outline, sections, aids };
}

/* ---------- public workflows ---------- */

/** Make a new set of notes from a transcript. */
export async function createNotes(req: CreateNoteRequest, emit: Emit, signal?: AbortSignal): Promise<PipelineResult> {
  const source = prepareSource(req.transcript, 200, "a longer transcript");
  const { outline, sections, aids } = await buildNotes(source, emit, signal);
  const now = Date.now();
  const note: Note = {
    id: randomUUID(),
    title: req.title?.trim() || outline.title,
    subtitle: outline.subtitle,
    bigIdea: outline.bigIdea,
    sections,
    glossary: aids.glossary,
    quiz: aids.quiz,
    transcript: req.transcript,
    sourceName: req.sourceName?.trim() || "Pasted transcript",
    createdAt: now,
    updatedAt: now,
  };
  return { note, summary: "Revision notes ready." };
}

/**
 * Add more transcript content to existing notes without regenerating them:
 * - "new": plan and write new sections for the new content only.
 * - "continue": extend one chosen section with the new content.
 * - "rebuild": regenerate everything from the full transcript (only when asked).
 */
export async function extendNotes(note: Note, req: ExtendNoteRequest, emit: Emit, signal?: AbortSignal): Promise<PipelineResult> {
  const now = Date.now();
  const updated: Note = structuredClone(note);

  if (req.mode === "new") {
    const source = prepareSource(req.content, 40, "the extra transcript content");
    emit({ type: "stage", agent: "outline", message: "Planning new sections for the added content…" });
    const plans = await outlineNewContentAgent(source, { title: note.title, headings: note.sections.map((s) => s.heading) }, signal);
    if (!plans.length) throw new AgentError("Claude didn't find anything new to add. Nothing was changed.");
    const allHeadings = [...note.sections.map((s) => s.heading), ...plans.map((p) => p.heading)];
    emit({ type: "outline", title: note.title, headings: plans.map((p) => p.heading) });

    emit({ type: "stage", agent: "section-writer", message: `Writing ${plans.length} new section${plans.length > 1 ? "s" : ""}…` });
    const added = (await writeSections(source, plans, allHeadings, note.sections.length, emit, signal)).map((s) => ({ ...s, addedAt: now }));

    emit({ type: "stage", agent: "study-aids", message: "Adding key terms and questions for the new sections…" });
    const aids = await studyAidsAgent(added, { extension: true, existingTerms: note.glossary.map((g) => g.term), signal });

    updated.sections.push(...added);
    updated.glossary = mergeGlossary(updated.glossary, aids.glossary);
    updated.quiz = [...updated.quiz, ...aids.quiz];
    updated.transcript = appendTranscript(note.transcript, req.content);
    updated.updatedAt = now;
    return {
      note: updated,
      focusSectionId: added[0]?.id,
      summary: added.length === 1 ? "Added 1 new section." : `Added ${added.length} new sections.`,
    };
  }

  if (req.mode === "continue") {
    const index = updated.sections.findIndex((s) => s.id === req.sectionId);
    if (index < 0) throw new AgentError("That section no longer exists. Pick another section.");
    const source = prepareSource(req.content, 40, "the extra transcript content");
    const section = updated.sections[index];

    emit({ type: "stage", agent: "continue", message: `Extending “${section.heading}”…` });
    const cont = await continueAgent(source, section, note.title, signal);
    const addedText = cont.addedExplanation.trim();
    const addedPoints = cont.addedKeyPoints.map((p) => p.trim()).filter(Boolean);
    const extraExample = cont.extraExample.trim();
    if (!addedText && !addedPoints.length && !extraExample) {
      throw new AgentError("Claude didn't find anything new to add to that section. Nothing was changed.");
    }
    if (addedText) section.explanation = `${section.explanation.replace(/\s+$/, "")}\n\n${addedText}`;
    section.keyPoints = [...section.keyPoints, ...addedPoints];
    if (extraExample) section.example = section.example ? `${section.example}\n\n${extraExample}` : extraExample;
    if (cont.remember.trim()) section.remember = cont.remember.trim();

    emit({ type: "stage", agent: "diagram", message: "Checking whether the diagram needs updating…" });
    const newDiagram = await diagramUpdateAgent(section, section.diagram, addedText, signal);
    if (newDiagram) section.diagram = newDiagram;
    section.updatedAt = now;

    emit({ type: "stage", agent: "study-aids", message: "Adding key terms and questions for the new material…" });
    const aids = await studyAidsAgent([{ heading: section.heading, explanation: addedText || extraExample, keyPoints: addedPoints }], {
      extension: true,
      existingTerms: note.glossary.map((g) => g.term),
      signal,
    });
    updated.glossary = mergeGlossary(updated.glossary, aids.glossary);
    updated.quiz = [...updated.quiz, ...(aids.quiz as QuizItem[])];
    updated.transcript = appendTranscript(note.transcript, req.content);
    updated.updatedAt = now;
    return { note: updated, focusSectionId: section.id, summary: `Extended section ${index + 1}.` };
  }

  // rebuild
  const fullTranscript = appendTranscript(note.transcript, req.content);
  const source = prepareSource(fullTranscript, 200, "a longer transcript");
  const { outline, sections, aids } = await buildNotes(source, emit, signal);
  Object.assign(updated, {
    subtitle: outline.subtitle,
    bigIdea: outline.bigIdea,
    sections,
    glossary: aids.glossary,
    quiz: aids.quiz,
    transcript: fullTranscript,
    updatedAt: now,
  });
  return { note: updated, summary: "Rebuilt all notes from the full transcript." };
}
