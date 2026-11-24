import { z } from "zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { MaterialDigest, MaterialItem } from "@revision-desk/shared";
import { config } from "../config.ts";
import { mapLimit, runAgent } from "./llm.ts";

const Read = z.object({
  items: z.array(
    z.object({
      itemId: z.string(),
      description: z.string().describe("2-3 plain sentences: what this slide or image shows and teaches"),
      keyFacts: z.array(z.string()).describe("0-5 facts, numbers, labels or steps a student should take from it"),
      useful: z.boolean().describe("false for title slides, agendas, thank-you slides, logos, decoration or blurry/unreadable images"),
      caption: z.string().describe("A short caption to show under the image in the notes, at most 12 words"),
    }),
  ),
});

export type AssetLoader = (assetId: string) => { mime: string; data: Uint8Array } | null;

const MAX_IMAGES_PER_CALL = 10;
const MAX_ITEMS_PER_CALL = 14;

/** Split items into batches that keep each call under the image and item limits. */
function batches(items: MaterialItem[]): MaterialItem[][] {
  const out: MaterialItem[][] = [];
  let cur: MaterialItem[] = [];
  let images = 0;
  for (const item of items) {
    const n = item.assetIds.length;
    if (cur.length && (cur.length >= MAX_ITEMS_PER_CALL || images + n > MAX_IMAGES_PER_CALL)) {
      out.push(cur);
      cur = [];
      images = 0;
    }
    cur.push(item);
    images += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Material reader agent: looks at each uploaded slide or image (the picture itself plus any
 * slide text and speaker notes) and writes down what it teaches. Its digest is what the other
 * agents use to plan, write and place material. Items that already have a digest are skipped.
 */
export async function materialReaderAgent(
  items: MaterialItem[],
  loadAsset: AssetLoader,
  subject: string,
  signal?: AbortSignal,
): Promise<void> {
  const todo = items.filter((i) => !i.digest);
  if (!todo.length) return;

  await mapLimit(batches(todo), config.agentConcurrency, async (batch) => {
    const content: BetaContentBlockParam[] = [
      {
        type: "text",
        text: `You are the MATERIAL READER agent. The student uploaded the slides and images below to go with their notes. For each item, read the picture and any slide text or speaker notes, and describe what it teaches in plain words. Mark an item not useful if it adds nothing for revision. Return one entry per item, using its ITEM id exactly.`,
      },
    ];
    for (const item of batch) {
      content.push({ type: "text", text: `ITEM ${item.id} — ${item.label}\n${item.text ? item.text : "(image only, no text)"}` });
      for (const id of item.assetIds) {
        const asset = loadAsset(id);
        if (asset) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: asset.mime as "image/jpeg" | "image/png", data: Buffer.from(asset.data).toString("base64") },
          });
        }
      }
    }

    const res = await runAgent({ agent: "material-reader", context: subject, task: content, schema: Read, signal });
    const byId = new Map(res.items.map((r) => [r.itemId, r]));
    for (const item of batch) {
      const r = byId.get(item.id);
      const digest: MaterialDigest = r
        ? { description: r.description, keyFacts: r.keyFacts, useful: r.useful, caption: r.caption }
        : { description: item.text.slice(0, 400), keyFacts: [], useful: !!item.text, caption: item.label };
      item.digest = digest;
    }
  });
}

/** Material as text the planning and writing agents can read. */
export function materialsAsText(items: MaterialItem[]): string {
  return items
    .map((i) =>
      [
        `### ${i.label}`,
        i.digest?.description && `What it shows: ${i.digest.description}`,
        i.digest?.keyFacts.length ? `Key facts: ${i.digest.keyFacts.join("; ")}` : "",
        i.text && `Slide text:\n${i.text}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}
