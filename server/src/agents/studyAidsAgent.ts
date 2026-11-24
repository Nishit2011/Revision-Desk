import { z } from "zod";
import { GlossaryEntry, QuizItem, type Section } from "@revision-desk/shared";
import { runAgent } from "./llm.ts";

const StudyAids = z.object({
  glossary: z.array(GlossaryEntry).describe("Key terms, each with a one-sentence plain meaning"),
  quiz: z.array(QuizItem).describe("Self-check questions with short answers"),
});
export type StudyAids = z.infer<typeof StudyAids>;

/**
 * Study aids agent: builds the key-terms glossary and self-check quiz from the
 * written sections. In extension mode it only adds terms and questions for the new material.
 */
export function studyAidsAgent(
  sections: Pick<Section, "heading" | "explanation" | "keyPoints">[],
  opts: { existingTerms?: string[]; extension?: boolean; signal?: AbortSignal } = {},
): Promise<StudyAids> {
  const ext = opts.extension;
  return runAgent({
    agent: "study-aids",
    context: sections.map((s) => `## ${s.heading}\n${s.explanation}\nKey points: ${s.keyPoints.join("; ")}`).join("\n\n"),
    schema: StudyAids,
    signal: opts.signal,
    effort: "low",
    task: `You are the STUDY AIDS agent. The source material is ${ext ? "newly added sections of" : "all sections of"} a student's revision notes.

Write:
- glossary: ${ext ? "0-5" : "4-10"} key terms, each with a one-sentence meaning in plain words.${
      opts.existingTerms?.length ? ` Do not include these terms, which are already listed: ${opts.existingTerms.join(", ")}.` : ""
    }
- quiz: ${ext ? "1-3" : "4-6"} self-check questions that test understanding (not trivia), each with a short answer.`,
  });
}
