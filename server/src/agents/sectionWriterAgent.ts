import { z } from "zod";
import { runAgent } from "./llm.ts";
import type { PlannedSection } from "./outlineAgent.ts";

const WrittenSection = z.object({
  explanation: z.string().describe("2-3 short paragraphs separated by a blank line, with 1-3 **key terms**"),
  keyPoints: z.array(z.string()).describe("3-5 short points"),
  example: z.string().describe("A concrete everyday example or analogy, 1-3 sentences"),
  remember: z.string().describe("A one-sentence takeaway"),
});
export type WrittenSection = z.infer<typeof WrittenSection>;

/**
 * Section writer agent: writes one section of the notes from the transcript,
 * guided by the outline agent's plan. Many of these run in parallel.
 */
export function sectionWriterAgent(
  source: string,
  plan: PlannedSection,
  allHeadings: string[],
  signal?: AbortSignal,
  /** Slides or images assigned to this section by the placement agent, as text. */
  assignedMaterial = "",
): Promise<WrittenSection> {
  return runAgent({
    agent: "section-writer",
    context: source,
    schema: WrittenSection,
    signal,
    task: `You are a SECTION WRITER agent. Write ONE section of the revision notes from the source material.

Your section: "${plan.heading}"
What it covers: ${plan.focus}

The full set of sections (other writers handle the rest, so don't cover their material):
${allHeadings.map((h, i) => `${i + 1}. ${h}`).join("\n")}
${
  assignedMaterial
    ? `\nThe student's slides and images for this section (use their facts, labels and examples; their pictures will appear next to your text):\n${assignedMaterial}\n`
    : ""
}
Write:
- explanation: 2-3 short paragraphs in plain language that explain the idea step by step. Wrap 1-3 key terms in **double asterisks**.
- keyPoints: 3-5 short points to revise from.
- example: one concrete, everyday example or analogy that makes the idea click.
- remember: a single-sentence takeaway.`,
  });
}
