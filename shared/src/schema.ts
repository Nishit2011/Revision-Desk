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

export interface Section {
  id: string;
  heading: string;
  explanation: string;
  keyPoints: string[];
  example: string;
  remember: string;
  diagram: Diagram | null;
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
  createdAt: number;
  updatedAt: number;
}

export interface NoteSummary {
  id: string;
  title: string;
  sectionCount: number;
  createdAt: number;
  updatedAt: number;
}

/* ---------- API contracts ---------- */

export const CreateNoteRequest = z.object({
  transcript: z.string().min(1),
  title: z.string().max(160).optional(),
  sourceName: z.string().max(200).optional(),
});
export type CreateNoteRequest = z.infer<typeof CreateNoteRequest>;

export const ExtendMode = z.enum(["new", "continue", "rebuild"]);
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
  | { type: "done"; note: Note; focusSectionId?: string; summary: string }
  | { type: "error"; message: string };
