import { z } from "zod";
import type { Section } from "@revision-desk/shared";
import { runAgent } from "./llm.ts";

const Continuation = z.object({
  addedExplanation: z.string().describe("1-2 short paragraphs covering only the new material, following on from the existing text"),
  addedKeyPoints: z.array(z.string()).describe("0-3 new short points"),
  extraExample: z.string().describe("Another everyday example if the new material needs one, otherwise an empty string"),
  remember: z.string().describe("One-sentence takeaway for the whole section, updated if needed"),
});
export type Continuation = z.infer<typeof Continuation>;

/**
 * Continue agent: extends one existing section with new transcript content.
 * It writes only what is new; the section's existing text is kept as it is.
 */
export function continueAgent(newContent: string, section: Section, noteTitle: string, signal?: AbortSignal): Promise<Continuation> {
  return runAgent({
    agent: "continue",
    context: newContent,
    schema: Continuation,
    signal,
    task: `You are the CONTINUE agent. The source material is NEW transcript content that continues one section of existing revision notes.

Notes: "${noteTitle}"
The existing section:
${JSON.stringify(
  { heading: section.heading, explanation: section.explanation, keyPoints: section.keyPoints, example: section.example, remember: section.remember },
  null,
  2,
)}

Write only what the new content adds. Do not rewrite, summarise or repeat what the section already says.
- addedExplanation: 1-2 short paragraphs that follow on naturally from the existing explanation. Wrap 1-3 key terms in **double asterisks**.
- addedKeyPoints: 0-3 new points (none if nothing new is worth a point).
- extraExample: another everyday example only if the new material needs one; otherwise "".
- remember: the one-sentence takeaway for the whole section, updated if the new material changes it, otherwise the same as now.`,
  });
}
