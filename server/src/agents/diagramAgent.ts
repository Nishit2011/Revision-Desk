import { z } from "zod";
import { Diagram, type Section } from "@revision-desk/shared";
import { runAgent } from "./llm.ts";

const DiagramChoice = z.object({
  reason: z.string().describe("One sentence on why this diagram type fits, or why no diagram is needed"),
  diagram: Diagram.nullable(),
});

const GUIDE = `Diagram types:
- flow: a process, sequence, or cause and effect (3-6 steps in order).
- cycle: a loop that repeats (3-6 steps).
- hierarchy: a whole broken into parts, types or categories (2-4 parts, 1-4 facts each).
- compare: differences between 2-3 things, or pros and cons (3-5 points per column, in matching order).
Keep every label short (see the field descriptions). Use the student's language, not jargon.`;

type SectionText = Pick<Section, "heading" | "explanation" | "keyPoints" | "example">;

/**
 * Diagram agent: decides whether a picture would help explain a section and,
 * if so, designs one (flow, cycle, hierarchy or comparison) that the app draws as SVG.
 */
export async function diagramAgent(section: SectionText, signal?: AbortSignal): Promise<Diagram | null> {
  const res = await runAgent({
    agent: "diagram",
    context: JSON.stringify(section, null, 2),
    schema: DiagramChoice,
    signal,
    task: `You are the DIAGRAM agent. The source material is one section of revision notes.

Design one diagram that makes this section easier to understand at a glance. Most sections benefit from one; set "diagram" to null only when a picture would add nothing.

${GUIDE}`,
  });
  return res.diagram;
}

/**
 * Diagram agent, update mode: after a section has been extended, decide whether
 * its diagram should change. Returns null to keep the existing diagram as it is.
 */
export async function diagramUpdateAgent(
  section: SectionText,
  existing: Diagram | null,
  addedText: string,
  signal?: AbortSignal,
): Promise<Diagram | null> {
  const res = await runAgent({
    agent: "diagram-update",
    context: JSON.stringify({ section, existingDiagram: existing, newlyAdded: addedText }, null, 2),
    schema: DiagramChoice,
    signal,
    task: `You are the DIAGRAM agent. The source material is a section of revision notes that has just been extended ("newlyAdded"), plus its current diagram ("existingDiagram", may be null).

If the new material changes or extends the picture, return a complete updated diagram (keep the existing type when it still fits). If the existing diagram still works, or no diagram is needed, set "diagram" to null and the existing one is kept.

${GUIDE}`,
  });
  return res.diagram;
}
