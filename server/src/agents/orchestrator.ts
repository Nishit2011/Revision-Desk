import { randomUUID } from "node:crypto";
import {
  cleanTranscript,
  type CreateNoteRequest,
  type ExtendNoteRequest,
  type Figure,
  type GlossaryEntry,
  type MaterialItem,
  type Note,
  type ProgressEvent,
  type Section,
} from "@revision-desk/shared";
import { config } from "../config.ts";
import { assetsRepo } from "../db.ts";
import type { ProcessedUploads, StoredAsset } from "../materials.ts";
import { continueAgent } from "./continueAgent.ts";
import { diagramAgent, diagramUpdateAgent } from "./diagramAgent.ts";
import { AgentError, mapLimit } from "./llm.ts";
import { materialReaderAgent, materialsAsText, type AssetLoader } from "./materialReaderAgent.ts";
import { outlineAgent, outlineNewContentAgent, type PlannedSection } from "./outlineAgent.ts";
import { placementAgent, type Placement, type PlacementCandidate } from "./placementAgent.ts";
import { sectionWriterAgent } from "./sectionWriterAgent.ts";
import { studyAidsAgent } from "./studyAidsAgent.ts";

export type Emit = (ev: ProgressEvent) => void;

export interface PipelineResult {
  note: Note;
  focusSectionId?: string;
  summary: string;
  warnings: string[];
  /** New images to store alongside the note. */
  assets: StoredAsset[];
}

interface Ctx {
  emit: Emit;
  signal?: AbortSignal;
  loadAsset: AssetLoader;
}

const TEXT_ITEM = "__added_text__";

/* ---------- helpers ---------- */

function checkLength(text: string) {
  if (text.length > config.maxTranscriptChars) {
    throw new AgentError(
      `This is ${text.length.toLocaleString()} characters, over the ${config.maxTranscriptChars.toLocaleString()} limit. Split it and add the rest with "Add to transcript".`,
    );
  }
}

function linkedController(signal?: AbortSignal): AbortController {
  const ctrl = new AbortController();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl;
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Transcript text and slide/image descriptions combined into one source for the writing agents. */
function assemble(text: string, items: MaterialItem[]): string {
  return [text && `TRANSCRIPT\n${text}`, items.length && `SLIDES AND IMAGES\n${materialsAsText(items)}`].filter(Boolean).join("\n\n");
}

function candidates(items: MaterialItem[]): PlacementCandidate[] {
  return items.map((i) => ({
    id: i.id,
    label: i.label,
    description: [i.digest?.description, i.digest?.keyFacts.join("; ")].filter(Boolean).join(" Facts: "),
    hasImage: i.assetIds.length > 0,
  }));
}

function figuresFor(item: MaterialItem, caption?: string): Figure[] {
  return item.assetIds.map((assetId) => ({ assetId, caption: caption || item.digest?.caption || item.label, source: item.label }));
}

function groupBy(placements: Placement[]): Map<string, Placement[]> {
  const m = new Map<string, Placement[]>();
  for (const p of placements) m.set(p.target, [...(m.get(p.target) ?? []), p]);
  return m;
}

async function readMaterials(items: MaterialItem[], subject: string, ctx: Ctx) {
  const todo = items.filter((i) => !i.digest);
  if (!todo.length) return;
  const slides = todo.filter((i) => i.kind === "slide").length;
  const images = todo.length - slides;
  const parts = [slides && plural(slides, "slide"), images && plural(images, "image")].filter(Boolean).join(" and ");
  ctx.emit({ type: "stage", agent: "material-reader", message: `Reading ${parts}…` });
  await materialReaderAgent(todo, ctx.loadAsset, subject, ctx.signal);
}

/** Section writer + diagram agent for each planned section, in parallel. */
async function writeSections(
  source: string,
  plans: PlannedSection[],
  allHeadings: string[],
  baseIndex: number,
  ctx: Ctx,
  materialFor: (i: number) => string = () => "",
): Promise<Section[]> {
  const ctrl = linkedController(ctx.signal);
  try {
    return await mapLimit(plans, config.agentConcurrency, async (plan, i) => {
      ctx.emit({ type: "section", index: baseIndex + i, heading: plan.heading, status: "writing" });
      const written = await sectionWriterAgent(source, plan, allHeadings, ctrl.signal, materialFor(i));
      const diagram = await diagramAgent({ heading: plan.heading, ...written }, ctrl.signal);
      ctx.emit({ type: "section", index: baseIndex + i, heading: plan.heading, status: "done" });
      return { id: randomUUID(), heading: plan.heading, ...written, diagram, figures: [] };
    });
  } catch (err) {
    ctrl.abort();
    throw err;
  }
}

/**
 * Plan sections → match slides/images to them → write each section with its material → diagrams.
 * Used for brand-new notes, a full rebuild, and new sections added to existing notes.
 */
async function planAndWrite(
  source: string,
  plans: PlannedSection[],
  allHeadings: string[],
  baseIndex: number,
  items: MaterialItem[],
  ctx: Ctx,
): Promise<Section[]> {
  let placements: Placement[] = [];
  if (items.length) {
    ctx.emit({ type: "stage", agent: "placement", message: "Matching slides and images to sections…" });
    placements = await placementAgent(
      plans.map((p, i) => ({ key: `s${i}`, heading: p.heading, summary: p.focus })),
      candidates(items),
      { allowNew: false, signal: ctx.signal },
    );
  }
  const groups = groupBy(placements);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const assigned = (i: number) => (groups.get(`s${i}`) ?? []).map((p) => itemById.get(p.itemId)!).filter(Boolean);

  ctx.emit({ type: "stage", agent: "section-writer", message: `Writing ${plural(plans.length, "section")} and drawing diagrams…` });
  const sections = await writeSections(source, plans, allHeadings, baseIndex, ctx, (i) => materialsAsText(assigned(i)));
  sections.forEach((s, i) => {
    for (const p of groups.get(`s${i}`) ?? []) {
      const item = itemById.get(p.itemId);
      if (item && p.showImage) s.figures!.push(...figuresFor(item, p.caption));
    }
  });
  return sections;
}

/** Outline → placement → writers → diagrams → study aids, over a transcript and/or slides and images. */
async function buildNotes(transcript: string, items: MaterialItem[], ctx: Ctx) {
  await readMaterials(items, transcript.slice(0, 20_000) || "(No transcript: the notes are built from slides and images only.)", ctx);
  const useful = items.filter((i) => i.digest?.useful);
  const source = assemble(transcript, useful);
  if (!source) throw new AgentError("The slides and images had nothing to build notes from. Add a transcript or more slides.");
  checkLength(source);

  ctx.emit({ type: "stage", agent: "outline", message: "Planning sections…" });
  const outline = await outlineAgent(source, ctx.signal);
  if (!outline.sections.length) throw new AgentError("Claude couldn't find any sections in this material. Try a longer transcript.");
  const headings = outline.sections.map((s) => s.heading);
  ctx.emit({ type: "outline", title: outline.title, headings });

  const sections = await planAndWrite(source, outline.sections, headings, 0, useful, ctx);

  ctx.emit({ type: "stage", agent: "study-aids", message: "Picking key terms and writing self-check questions…" });
  const aids = await studyAidsAgent(sections, { signal: ctx.signal });
  return { outline, sections, aids };
}

/**
 * Extend one existing section with new material (text and/or slides and images): the continue
 * agent writes only what is new, the diagram agent decides whether the diagram changes, and
 * chosen pictures are appended as figures.
 */
async function extendSection(section: Section, source: string, figures: Figure[], noteTitle: string, ctx: Ctx) {
  ctx.emit({ type: "stage", agent: "continue", message: `Adding to “${section.heading}”…` });
  const cont = await continueAgent(source, section, noteTitle, ctx.signal);
  const addedText = cont.addedExplanation.trim();
  const addedPoints = cont.addedKeyPoints.map((p) => p.trim()).filter(Boolean);
  const extraExample = cont.extraExample.trim();
  if (addedText) section.explanation = `${section.explanation.replace(/\s+$/, "")}\n\n${addedText}`;
  section.keyPoints = [...section.keyPoints, ...addedPoints];
  if (extraExample) section.example = section.example ? `${section.example}\n\n${extraExample}` : extraExample;
  if (cont.remember.trim()) section.remember = cont.remember.trim();
  section.figures = [...(section.figures ?? []), ...figures];

  const changed = !!(addedText || addedPoints.length || extraExample || figures.length);
  if (addedText) {
    const newDiagram = await diagramUpdateAgent(section, section.diagram, addedText, ctx.signal);
    if (newDiagram) section.diagram = newDiagram;
  }
  if (changed) section.updatedAt = Date.now();
  return { changed, forAids: { heading: section.heading, explanation: addedText || extraExample, keyPoints: addedPoints } };
}

/* ---------- public workflows ---------- */

export function assetLoader(newAssets: StoredAsset[]): AssetLoader {
  const fresh = new Map(newAssets.map((a) => [a.id, a]));
  return (id) => fresh.get(id) ?? assetsRepo.get(id);
}

/** Make a new set of notes from a transcript and/or uploaded slides and images. */
export async function createNotes(req: CreateNoteRequest, uploads: ProcessedUploads, emit: Emit, signal?: AbortSignal): Promise<PipelineResult> {
  const transcript = cleanTranscript(req.transcript);
  if (transcript.length < 200 && !uploads.items.length) {
    throw new AgentError("Paste a longer transcript (at least a few paragraphs) or upload slides or images.");
  }
  checkLength(transcript);
  const ctx: Ctx = { emit, signal, loadAsset: assetLoader(uploads.assets) };
  const { outline, sections, aids } = await buildNotes(transcript, uploads.items, ctx);

  const now = Date.now();
  const names = uploads.attachments.map((a) => a.name);
  const note: Note = {
    id: randomUUID(),
    title: req.title?.trim() || outline.title,
    subtitle: outline.subtitle,
    bigIdea: outline.bigIdea,
    sections,
    glossary: aids.glossary,
    quiz: aids.quiz,
    transcript: req.transcript,
    sourceName: req.sourceName?.trim() || (transcript ? "Pasted transcript" : names.join(", ")),
    attachments: uploads.attachments,
    materials: uploads.items,
    createdAt: now,
    updatedAt: now,
  };
  return { note, summary: "Revision notes ready.", warnings: uploads.warnings, assets: uploads.assets };
}

/**
 * Add more material to existing notes without regenerating them (unless mode is "rebuild"):
 * - auto: the placement agent decides, for the added text and each slide or image, which existing
 *   section it belongs to (that section is extended) or whether it needs a new section.
 * - new: the added text becomes new sections; slides and images are placed among those new sections.
 * - continue: everything added goes into one chosen section.
 * - rebuild: regenerate all notes from scratch from the full transcript and every upload.
 */
export async function extendNotes(
  note: Note,
  req: ExtendNoteRequest,
  uploads: ProcessedUploads,
  emit: Emit,
  signal?: AbortSignal,
): Promise<PipelineResult> {
  const ctx: Ctx = { emit, signal, loadAsset: assetLoader(uploads.assets) };
  const updated: Note = structuredClone(note);
  updated.attachments ??= [];
  updated.materials ??= [];
  const now = Date.now();
  const text = cleanTranscript(req.content);
  const newItems = uploads.items;
  const subject = `Revision notes: "${note.title}". Sections: ${note.sections.map((s) => s.heading).join("; ")}.`;
  let summary = "";
  let focusSectionId: string | undefined;

  const finish = (): PipelineResult => {
    updated.attachments!.push(...uploads.attachments);
    updated.materials!.push(...newItems);
    updated.transcript = appendTranscript(note.transcript, req.content);
    updated.updatedAt = now;
    return { note: updated, focusSectionId, summary, warnings: uploads.warnings, assets: uploads.assets };
  };

  if (req.mode !== "rebuild" && text.length < 40 && !newItems.length) {
    throw new AgentError("Paste the extra transcript text or upload slides or images first.");
  }
  checkLength(text);

  /* ----- rebuild: regenerate everything from scratch ----- */
  if (req.mode === "rebuild") {
    const fullTranscript = appendTranscript(note.transcript, req.content);
    const allItems = [...updated.materials, ...newItems];
    const clean = cleanTranscript(fullTranscript);
    if (clean.length < 200 && !allItems.length) throw new AgentError("There isn't enough transcript or slide material to rebuild from.");
    checkLength(clean);
    const { outline, sections, aids } = await buildNotes(clean, allItems, ctx);
    Object.assign(updated, { subtitle: outline.subtitle, bigIdea: outline.bigIdea, sections, glossary: aids.glossary, quiz: aids.quiz });
    summary = "Rebuilt all notes from scratch.";
    return finish();
  }

  await readMaterials(newItems, subject, ctx);
  const useful = newItems.filter((i) => i.digest?.useful);
  const itemById = new Map(useful.map((i) => [i.id, i]));
  const aidsInput: { heading: string; explanation: string; keyPoints: string[] }[] = [];

  /* ----- continue: everything goes into one chosen section ----- */
  if (req.mode === "continue") {
    const section = updated.sections.find((s) => s.id === req.sectionId);
    if (!section) throw new AgentError("That section no longer exists. Pick another section.");
    const source = assemble(text, useful);
    if (!source) throw new AgentError("The uploaded files had nothing to add. Nothing was changed.");
    const figures = useful.flatMap((i) => figuresFor(i));
    const res = await extendSection(section, source, figures, note.title, ctx);
    if (!res.changed) throw new AgentError("Claude didn't find anything new to add to that section. Nothing was changed.");
    aidsInput.push(res.forAids);
    focusSectionId = section.id;
    summary = `Extended “${section.heading}”${figures.length ? ` and added ${plural(figures.length, "picture")}` : ""}.`;
  }

  /* ----- new: added text becomes new sections; files placed among them ----- */
  if (req.mode === "new") {
    const source = assemble(text, useful);
    if (!source) throw new AgentError("The uploaded files had nothing to add. Nothing was changed.");
    const added = await addNewSections(source, useful, updated, ctx, now);
    aidsInput.push(...added);
    focusSectionId = added[0] && updated.sections[updated.sections.length - added.length].id;
    summary = `Added ${plural(added.length, "new section")}.`;
  }

  /* ----- auto: the placement agent decides where each piece belongs ----- */
  if (req.mode === "auto") {
    const cands = candidates(useful);
    if (text.length >= 40) cands.push({ id: TEXT_ITEM, label: "Added transcript text", description: text.slice(0, 6000), hasImage: false });
    if (!cands.length) throw new AgentError("The uploaded files had nothing to add to the notes. Nothing was changed.");

    ctx.emit({ type: "stage", agent: "placement", message: "Working out where the new material belongs…" });
    const placements = await placementAgent(
      updated.sections.map((s) => ({ key: s.id, heading: s.heading, summary: s.explanation.slice(0, 300) })),
      cands,
      { allowNew: true, signal },
    );
    const groups = groupBy(placements);
    const sourceFor = (ps: Placement[]) =>
      assemble(ps.some((p) => p.itemId === TEXT_ITEM) ? text : "", ps.map((p) => itemById.get(p.itemId)).filter((i): i is MaterialItem => !!i));

    // Extend existing sections that received material.
    const targets = updated.sections.filter((s) => groups.has(s.id));
    let extended = 0;
    let pictures = 0;
    const ctrl = linkedController(signal);
    await mapLimit(targets, config.agentConcurrency, async (section) => {
      const ps = groups.get(section.id)!;
      const figures = ps.flatMap((p) => (p.showImage && itemById.has(p.itemId) ? figuresFor(itemById.get(p.itemId)!, p.caption) : []));
      const res = await extendSection(section, sourceFor(ps), figures, note.title, { ...ctx, signal: ctrl.signal }).catch((err) => {
        ctrl.abort();
        throw err;
      });
      if (res.changed) {
        extended++;
        pictures += figures.length;
        aidsInput.push(res.forAids);
        focusSectionId ??= section.id;
      }
    });

    // Material no section covers becomes new sections.
    let addedCount = 0;
    const fresh = groups.get("new");
    if (fresh?.length) {
      const freshItems = fresh.map((p) => itemById.get(p.itemId)).filter((i): i is MaterialItem => !!i);
      const added = await addNewSections(sourceFor(fresh), freshItems, updated, ctx, now);
      addedCount = added.length;
      aidsInput.push(...added);
      focusSectionId ??= updated.sections[updated.sections.length - added.length]?.id;
    }

    if (!extended && !addedCount) throw new AgentError("Claude found nothing in the new material to add to these notes. Nothing was changed.");
    const skipped = (groups.get("none")?.length ?? 0) + (newItems.length - useful.length);
    summary = [
      extended && `Extended ${plural(extended, "section")}`,
      addedCount && `added ${plural(addedCount, "new section")}`,
      pictures && `placed ${plural(pictures, "picture")}`,
    ]
      .filter(Boolean)
      .join(", ");
    summary = summary.charAt(0).toUpperCase() + summary.slice(1) + "." + (skipped ? ` ${plural(skipped, "item")} had nothing to add.` : "");
  }

  if (aidsInput.length) {
    ctx.emit({ type: "stage", agent: "study-aids", message: "Adding key terms and questions for the new material…" });
    const aids = await studyAidsAgent(aidsInput, { extension: true, existingTerms: updated.glossary.map((g) => g.term), signal });
    updated.glossary = mergeGlossary(updated.glossary, aids.glossary);
    updated.quiz = [...updated.quiz, ...aids.quiz];
  }
  return finish();
}

/** Plan and write new sections for new material, appended after the existing ones. Returns study-aid input. */
async function addNewSections(source: string, items: MaterialItem[], updated: Note, ctx: Ctx, now: number) {
  ctx.emit({ type: "stage", agent: "outline", message: "Planning new sections for the added material…" });
  const plans = await outlineNewContentAgent(source, { title: updated.title, headings: updated.sections.map((s) => s.heading) }, ctx.signal);
  if (!plans.length) throw new AgentError("Claude didn't find anything new to add. Nothing was changed.");
  const allHeadings = [...updated.sections.map((s) => s.heading), ...plans.map((p) => p.heading)];
  ctx.emit({ type: "outline", title: updated.title, headings: plans.map((p) => p.heading) });
  const added = (await planAndWrite(source, plans, allHeadings, updated.sections.length, items, ctx)).map((s) => ({ ...s, addedAt: now }));
  updated.sections.push(...added);
  return added.map((s) => ({ heading: s.heading, explanation: s.explanation, keyPoints: s.keyPoints }));
}
