import { z } from "zod";
import { runAgent } from "./llm.ts";

export interface PlacementTarget {
  key: string;
  heading: string;
  summary: string;
}

export interface PlacementCandidate {
  id: string;
  label: string;
  description: string;
  hasImage: boolean;
}

const Placements = z.object({
  placements: z.array(
    z.object({
      itemId: z.string(),
      target: z.string().describe('A section key, "new" for material no section covers, or "none" if it adds nothing'),
      showImage: z.boolean().describe("Whether the picture itself helps a student revising this section"),
      caption: z.string().describe("Caption for the picture in this section, at most 12 words"),
    }),
  ),
});

export interface Placement {
  itemId: string;
  target: string; // a target key, "new" or "none"
  showImage: boolean;
  caption: string;
}

/**
 * Placement agent: decides which section each uploaded slide, image or block of added text
 * belongs to. With `allowNew`, material that no existing section covers is marked "new" so
 * new sections can be written for it instead of regenerating the notes.
 */
export async function placementAgent(
  targets: PlacementTarget[],
  candidates: PlacementCandidate[],
  opts: { allowNew: boolean; signal?: AbortSignal },
): Promise<Placement[]> {
  if (!candidates.length) return [];
  if (!targets.length && !opts.allowNew) return [];
  const res = await runAgent({
    agent: "placement",
    context: JSON.stringify({ sections: targets, material: candidates }, null, 2),
    schema: Placements,
    signal: opts.signal,
    effort: "low",
    task: `You are the PLACEMENT agent. The source material lists the sections of a student's revision notes (each with a "key") and some new material (slides, images or added transcript text, each with an "id").

For every material item, choose where it belongs:
- the key of the one section whose topic it fits best;
${opts.allowNew ? '- "new" if it covers a topic none of the sections cover;\n' : ""}- "none" if it adds nothing for revision (for example a title slide or a logo).

Set showImage to true when the picture itself (a diagram, chart, photo, worked example or labelled figure) would help a student, and false for text-only slides or decorative pictures. Return exactly one placement per item.`,
  });

  const keys = new Set(targets.map((t) => t.key));
  const seen = new Set<string>();
  const out: Placement[] = [];
  for (const p of res.placements) {
    if (seen.has(p.itemId) || !candidates.some((c) => c.id === p.itemId)) continue;
    seen.add(p.itemId);
    const target = keys.has(p.target) || p.target === "none" || (opts.allowNew && p.target === "new") ? p.target : "none";
    out.push({ ...p, target });
  }
  return out;
}
