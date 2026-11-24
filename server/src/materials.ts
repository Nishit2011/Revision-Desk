import { randomUUID } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import type { Attachment, MaterialItem } from "@revision-desk/shared";

/** An image ready to store and to send to Claude. */
export interface StoredAsset {
  id: string;
  mime: "image/jpeg" | "image/png";
  data: Buffer;
}

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

export interface ProcessedUploads {
  attachments: Attachment[];
  items: MaterialItem[];
  assets: StoredAsset[];
  warnings: string[];
}

export const emptyUploads = (): ProcessedUploads => ({ attachments: [], items: [], assets: [], warnings: [] });

const MAX_SLIDES = 120;
const MAX_IMAGES_PER_SLIDE = 4;
const MIN_IMAGE_BYTES = 4_000; // smaller images are almost always icons or bullets
const MAX_EDGE = 1568; // long edge sent to Claude; larger images cost more without helping

/** Shrink to at most MAX_EDGE px, fix rotation, and re-encode as JPEG (or PNG when transparent). */
async function normalizeImage(input: Buffer): Promise<StoredAsset | null> {
  try {
    const img = sharp(input, { failOn: "none", animated: false }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height || meta.width < 48 || meta.height < 48) return null;
    const resized = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
    if (meta.hasAlpha) return { id: randomUUID(), mime: "image/png", data: await resized.png({ compressionLevel: 9 }).toBuffer() };
    return { id: randomUUID(), mime: "image/jpeg", data: await resized.jpeg({ quality: 82 }).toBuffer() };
  } catch {
    return null;
  }
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** Text of a DrawingML part, one line per paragraph. */
function xmlText(xml: string): string {
  return xml
    .split(/<\/a:p>/)
    .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(""))
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l))
    .join("\n");
}

function relationships(xml: string | undefined): { id: string; type: string; target: string }[] {
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => {
    const attr = (name: string) => m[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
    return { id: attr("Id"), type: attr("Type"), target: attr("Target") };
  });
}

const resolvePart = (fromDir: string, target: string) =>
  target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(fromDir, target));

/** Slide part paths in presentation order. */
async function slideOrder(zip: JSZip): Promise<string[]> {
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  const rels = relationships(await zip.file("ppt/_rels/presentation.xml.rels")?.async("string"));
  const byId = new Map(rels.map((r) => [r.id, resolvePart("ppt", r.target)]));
  const ordered = pres ? [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => byId.get(m[1])).filter((p): p is string => !!p && !!zip.file(p)) : [];
  if (ordered.length) return ordered;
  return Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
}

async function processPptx(file: UploadedFile, out: ProcessedUploads) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file.buffer);
  } catch {
    out.warnings.push(`${file.originalname} couldn't be opened as a PowerPoint file, so it was skipped.`);
    return;
  }
  let slides = await slideOrder(zip);
  if (!slides.length) {
    out.warnings.push(`${file.originalname} has no slides, so it was skipped.`);
    return;
  }
  if (slides.length > MAX_SLIDES) {
    out.warnings.push(`${file.originalname} has ${slides.length} slides; only the first ${MAX_SLIDES} were used.`);
    slides = slides.slice(0, MAX_SLIDES);
  }

  // Gather each slide's text, notes and picture references first, so pictures repeated
  // on many slides (logos, template art) can be recognised and left out.
  const parsed = await Promise.all(
    slides.map(async (slidePath) => {
      const dir = path.posix.dirname(slidePath);
      const xml = (await zip.file(slidePath)?.async("string")) ?? "";
      const rels = relationships(await zip.file(`${dir}/_rels/${path.posix.basename(slidePath)}.rels`)?.async("string"));
      const notesRel = rels.find((r) => r.type.endsWith("/notesSlide"));
      const notesXml = notesRel ? await zip.file(resolvePart(dir, notesRel.target))?.async("string") : undefined;
      const usedIds = new Set([...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]));
      const media = rels.filter((r) => r.type.endsWith("/image") && usedIds.has(r.id)).map((r) => resolvePart(dir, r.target));
      return { text: xmlText(xml), notes: notesXml ? xmlText(notesXml) : "", media: [...new Set(media)] };
    }),
  );
  const usage = new Map<string, number>();
  for (const s of parsed) for (const m of s.media) usage.set(m, (usage.get(m) ?? 0) + 1);
  const isTemplateArt = (m: string) => slides.length >= 4 && (usage.get(m) ?? 0) >= Math.max(3, slides.length * 0.4);

  const attachment: Attachment = { id: randomUUID(), name: file.originalname, kind: "pptx", itemCount: 0, addedAt: Date.now() };
  const assetByMedia = new Map<string, StoredAsset | null>();

  for (let i = 0; i < parsed.length; i++) {
    const s = parsed[i];
    const assetIds: string[] = [];
    for (const m of s.media.filter((m) => !isTemplateArt(m)).slice(0, MAX_IMAGES_PER_SLIDE)) {
      if (!/\.(png|jpe?g|gif|webp|tiff?)$/i.test(m)) continue; // EMF/WMF vector art can't be shown
      if (!assetByMedia.has(m)) {
        const buf = await zip.file(m)?.async("nodebuffer");
        const asset = buf && buf.length >= MIN_IMAGE_BYTES ? await normalizeImage(buf) : null;
        if (asset) out.assets.push(asset);
        assetByMedia.set(m, asset);
      }
      const asset = assetByMedia.get(m);
      if (asset) assetIds.push(asset.id);
    }
    const text = [s.text, s.notes && `Speaker notes:\n${s.notes}`].filter(Boolean).join("\n\n");
    if (!text && !assetIds.length) continue;
    out.items.push({ id: randomUUID(), attachmentId: attachment.id, kind: "slide", label: `Slide ${i + 1} · ${file.originalname}`, text, assetIds });
    attachment.itemCount++;
  }

  if (attachment.itemCount) out.attachments.push(attachment);
  else out.warnings.push(`${file.originalname} had no text or pictures that could be used.`);
}

async function processImage(file: UploadedFile, out: ProcessedUploads) {
  const asset = await normalizeImage(file.buffer);
  if (!asset) {
    out.warnings.push(`${file.originalname} couldn't be read as an image (use PNG, JPG, WebP or GIF), so it was skipped.`);
    return;
  }
  const attachment: Attachment = { id: randomUUID(), name: file.originalname, kind: "image", itemCount: 1, addedAt: Date.now() };
  out.assets.push(asset);
  out.attachments.push(attachment);
  out.items.push({ id: randomUUID(), attachmentId: attachment.id, kind: "image", label: file.originalname, text: "", assetIds: [asset.id] });
}

/** Turn uploaded files into material items (one per slide or image) and stored images. */
export async function processUploads(files: UploadedFile[]): Promise<ProcessedUploads> {
  const out = emptyUploads();
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pptx") await processPptx(file, out);
    else if (ext === ".ppt") out.warnings.push(`${file.originalname} is an old .ppt file. Save it as .pptx in PowerPoint or Keynote and upload it again.`);
    else if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) await processImage(file, out);
    else out.warnings.push(`${file.originalname} isn't a supported file. Upload .pptx slides or PNG, JPG, WebP or GIF images.`);
  }
  return out;
}
