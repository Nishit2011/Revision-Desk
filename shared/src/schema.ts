import { z } from "zod";

/* ---------- Diagrams ---------- */

const Step = z.object({
  label: z.string().describe("Short step name, at most 4 words"),
  note: z.string().describe("Plain explanation of the step, at most 9 words"),
});

export const FlowDiagram = z.object({
  type: z.literal("flow"),
  title: z.string(),
  steps: z.array(Step).describe("3-6 steps in order"),
});

export const CycleDiagram = z.object({
  type: z.literal("cycle"),
  title: z.string(),
  steps: z.array(Step).describe("3-6 steps of a repeating loop"),
});

export const HierarchyDiagram = z.object({
  type: z.literal("hierarchy"),
  title: z.string(),
  root: z.string().describe("The whole idea, at most 5 words"),
  children: z
    .array(
      z.object({
        label: z.string().describe("A part, type or category, at most 4 words"),
        items: z.array(z.string()).describe("1-4 short facts, at most 7 words each"),
      }),
    )
    .describe("2-4 parts"),
});

export const CompareDiagram = z.object({
  type: z.literal("compare"),
  title: z.string(),
  columns: z
    .array(
      z.object({
        label: z.string().describe("Thing being compared, at most 3 words"),
        items: z.array(z.string()).describe("3-5 points, at most 8 words each, in matching order across columns"),
      }),
    )
    .describe("2-3 columns"),
});

export const Diagram = z.union([FlowDiagram, CycleDiagram, HierarchyDiagram, CompareDiagram]);
export type Diagram = z.infer<typeof Diagram>;
export type DiagramType = Diagram["type"];

export const DIAGRAM_LABEL: Record<DiagramType, string> = {
  flow: "Process",
  cycle: "Cycle",
  hierarchy: "Breakdown",
  compare: "Comparison",
};

/* ---------- Notes ---------- */

export const GlossaryEntry = z.object({ term: z.string(), meaning: z.string() });
export type GlossaryEntry = z.infer<typeof GlossaryEntry>;

export const QuizItem = z.object({ q: z.string(), a: z.string() });
export type QuizItem = z.infer<typeof QuizItem>;

/* ---------- Slides and images ---------- */

/** A file the user uploaded alongside the transcript: a slide deck or an image. */
export interface Attachment {
  id: string;
  name: string;
  kind: "pptx" | "image";
  /** Slides (for a deck) or 1 (for an image) that carried usable content. */
  itemCount: number;
  addedAt: number;
}

/** What the reader agent understood from one slide or image. */
export interface MaterialDigest {
  description: string;
  keyFacts: string[];
  /** False for title slides, logos, decorative pictures and the like. */
  useful: boolean;
  caption: string;
}

/** One unit of extra context: a single slide, a single image, or a block of added text. */
export interface MaterialItem {
  id: string;
  attachmentId: string;
  kind: "slide" | "image";
  /** e.g. "Slide 4 · week6.pptx" or "whiteboard.jpg" */
  label: string;
  /** Slide text and speaker notes (empty for a plain image). */
  text: string;
  /** Images stored by the server, shown in the notes and sent to Claude. */
  assetIds: string[];
  digest?: MaterialDigest;
}

/** An image placed in a section of the notes. */
export interface Figure {
  assetId: string;
  caption: string;
  /** Where it came from, e.g. "Slide 4 · week6.pptx". */
  source: string;
}

export interface Section {
  id: string;
  heading: string;
  explanation: string;
  keyPoints: string[];
  example: string;
  remember: string;
  diagram: Diagram | null;
  /** Images from the uploaded slides or pictures that belong to this section. */
  figures?: Figure[];
  addedAt?: number;
  updatedAt?: number;
}

export interface Note {
  id: string;
  title: string;
  subtitle: string;
  bigIdea: string;
  sections: Section[];
  glossary: GlossaryEntry[];
  quiz: QuizItem[];
  transcript: string;
  sourceName: string;
  /** Uploaded slide decks and images (older notes may not have these). */
  attachments?: Attachment[];
  materials?: MaterialItem[];
  createdAt: number;
  updatedAt: number;
}

export const ACCEPTED_UPLOADS = ".pptx,.png,.jpg,.jpeg,.webp,.gif";
export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface NoteSummary {
  id: string;
  title: string;
  sectionCount: number;
  createdAt: number;
  updatedAt: number;
}

/* ---------- API contracts ---------- */

/** Text fields of the create request (sent as multipart form fields alongside any files). */
export const CreateNoteRequest = z.object({
  transcript: z.string().default(""),
  title: z.string().max(160).optional(),
  sourceName: z.string().max(200).optional(),
});
export type CreateNoteRequest = z.infer<typeof CreateNoteRequest>;

/**
 * - auto: the agents decide where the added text, slides and images belong (existing sections or new ones).
 * - new: the added text becomes new sections; uploaded files are placed among those new sections.
 * - continue: everything added goes into one chosen section.
 * - rebuild: regenerate all notes from scratch from the full transcript and every upload.
 */
export const ExtendMode = z.enum(["auto", "new", "continue", "rebuild"]);
export type ExtendMode = z.infer<typeof ExtendMode>;

export const ExtendNoteRequest = z.object({
  mode: ExtendMode,
  /** The additional transcript content. May be empty only for "rebuild". */
  content: z.string().default(""),
  /** Section to continue (mode "continue"). */
  sectionId: z.string().optional(),
});
export type ExtendNoteRequest = z.infer<typeof ExtendNoteRequest>;

export const UpdateNoteRequest = z.object({
  title: z.string().min(1).max(160).optional(),
  transcript: z.string().optional(),
});
export type UpdateNoteRequest = z.infer<typeof UpdateNoteRequest>;

/** Events streamed (as Server-Sent Events) while agents work. */
export type ProgressEvent =
  | { type: "stage"; agent: string; message: string }
  | { type: "outline"; title: string; headings: string[] }
  | { type: "section"; index: number; heading: string; status: "writing" | "done" }
  | { type: "done"; note: Note; focusSectionId?: string; summary: string; warnings?: string[] }
  | { type: "error"; message: string };
