import { z } from "zod";
import { runAgent } from "./llm.ts";

const PlannedSection = z.object({
  heading: z.string().describe("Clear, specific subheading for this section"),
  focus: z.string().describe("1-2 sentences: exactly which part of the source this section covers"),
});
export type PlannedSection = z.infer<typeof PlannedSection>;

const Outline = z.object({
  title: z.string().describe("Short heading title for the whole transcript"),
  subtitle: z.string().describe("One line saying what it covers"),
  bigIdea: z.string().describe("2-3 sentences: the main idea of the whole transcript"),
  sections: z.array(PlannedSection).describe("3-8 sections, in the order the transcript covers them"),
});
export type Outline = z.infer<typeof Outline>;

/**
 * Outline agent: reads the whole transcript and plans the notes —
 * a title, a one-line subtitle, the big idea, and the list of sections.
 */
export function outlineAgent(transcript: string, signal?: AbortSignal): Promise<Outline> {
  return runAgent({
    agent: "outline",
    context: transcript,
    schema: Outline,
    signal,
    task: `You are the OUTLINE agent. The source material is a full transcript, possibly followed by the student's slides and images (described in text). If there is no transcript, plan from the slides and images alone.

Plan the revision notes:
- title: a short heading title for the whole transcript.
- subtitle: one line on what it covers.
- bigIdea: 2-3 sentences a student should remember if they remember nothing else.
- sections: 3-8 sections that follow the transcript's order. Each covers one distinct idea, with no overlap. Give each a clear, specific subheading and a "focus" saying exactly which part of the transcript it covers.

Other agents will write each section from your plan, so make the focus precise.`,
  });
}

const NewSections = z.object({
  sections: z.array(PlannedSection).describe("1-4 new sections covering only the new content"),
});

/**
 * Outline agent, extension mode: plans new sections for added transcript content,
 * without repeating what the existing sections already cover.
 */
export async function outlineNewContentAgent(
  newContent: string,
  existing: { title: string; headings: string[] },
  signal?: AbortSignal,
): Promise<PlannedSection[]> {
  const res = await runAgent({
    agent: "outline-extend",
    context: newContent,
    schema: NewSections,
    signal,
    task: `You are the OUTLINE agent, extending existing notes. The source material is NEW material (more transcript text and/or descriptions of uploaded slides and images) that continues a transcript already turned into notes.

Existing notes: "${existing.title}"
Existing sections:
${existing.headings.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Plan 1-4 NEW sections that cover only what the new content adds and follow on from the existing ones. Do not repeat or re-cover what the existing sections already cover. Give each a clear subheading and a precise "focus".`,
  });
  return res.sections;
}
