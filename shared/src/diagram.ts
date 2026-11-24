import type { Diagram } from "./schema.ts";
import { esc } from "./text.ts";

/** Colours used to draw a diagram. The web app reads these from CSS tokens; the PDF uses LIGHT_PALETTE. */
export interface DiagramPalette {
  surface: string;
  fg: string;
  muted: string;
  line: string;
  accent: string;
  onAccent: string;
}

export const LIGHT_PALETTE: DiagramPalette = {
  surface: "#FFFFFF",
  fg: "#18202C",
  muted: "#4F5A6B",
  line: "#C9D1DE",
  accent: "#2B54D6",
  onAccent: "#FFFFFF",
};

const FONT = 'font-family="Atkinson Hyperlegible, Segoe UI, system-ui, sans-serif"';
const W = 680;

function wrap(text: string, max: number, limit = 6): string[] {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      out.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) out.push(cur);
  if (out.length > limit) {
    out.length = limit;
    out[limit - 1] = out[limit - 1].replace(/.{0,2}$/, "…");
  }
  return out;
}

const tspans = (lines: string[], x: number, y: number, lh: number) =>
  lines.map((l, i) => `<tspan x="${x.toFixed(1)}" y="${(y + i * lh).toFixed(1)}">${esc(l)}</tspan>`).join("");

let uid = 0;

/** Render a diagram spec to a self-contained SVG string. All text is escaped. */
export function renderDiagramSvg(d: Diagram | null | undefined, C: DiagramPalette = LIGHT_PALETTE): string {
  if (!d) return "";
  const id = `ah${++uid}`;
  const defs = `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.accent}"/></marker></defs>`;
  let body = "";
  let H = 200;

  if (d.type === "flow") {
    const steps = d.steps.slice(0, 7);
    const n = Math.max(steps.length, 1);
    if (n <= 4) {
      const pad = 10, gap = 40, bw = (W - 2 * pad - (n - 1) * gap) / n;
      const lc = Math.max(10, Math.floor(bw / 9)), nc = Math.max(12, Math.floor(bw / 7.4));
      const L = steps.map((s) => ({ l: wrap(s.label, lc, 3), n: wrap(s.note, nc, 5) }));
      const bh = Math.max(...L.map((o) => 54 + o.l.length * 19 + o.n.length * 16));
      H = bh + 20;
      steps.forEach((_, i) => {
        const x = pad + i * (bw + gap), y = 10, cx = x + bw / 2;
        body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="12" fill="${C.surface}" stroke="${C.line}" stroke-width="1.5"/>`;
        body += `<circle cx="${x + 22}" cy="${y + 22}" r="12" fill="${C.accent}"/><text x="${x + 22}" y="${y + 26.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${C.onAccent}" ${FONT}>${i + 1}</text>`;
        body += `<text text-anchor="middle" font-size="16" font-weight="700" fill="${C.fg}" ${FONT}>${tspans(L[i].l, cx, y + 60, 19)}</text>`;
        body += `<text text-anchor="middle" font-size="13.5" fill="${C.muted}" ${FONT}>${tspans(L[i].n, cx, y + 66 + L[i].l.length * 19, 16)}</text>`;
        if (i < n - 1)
          body += `<line x1="${x + bw + 5}" y1="${y + bh / 2}" x2="${x + bw + gap - 6}" y2="${y + bh / 2}" stroke="${C.accent}" stroke-width="2.5" marker-end="url(#${id})"/>`;
      });
    } else {
      const bw = 470, x = (W - bw) / 2, gap = 30;
      let y = 10;
      steps.forEach((s, i) => {
        const l = wrap(s.label, 40, 2), nt = wrap(s.note, 56, 3), bh = 26 + l.length * 19 + nt.length * 16;
        body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="12" fill="${C.surface}" stroke="${C.line}" stroke-width="1.5"/>`;
        body += `<circle cx="${x + 26}" cy="${y + bh / 2}" r="13" fill="${C.accent}"/><text x="${x + 26}" y="${y + bh / 2 + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${C.onAccent}" ${FONT}>${i + 1}</text>`;
        body += `<text font-size="16" font-weight="700" fill="${C.fg}" ${FONT}>${tspans(l, x + 52, y + 28, 19)}</text>`;
        body += `<text font-size="13.5" fill="${C.muted}" ${FONT}>${tspans(nt, x + 52, y + 32 + l.length * 19, 16)}</text>`;
        y += bh;
        if (i < n - 1) {
          body += `<line x1="${W / 2}" y1="${y + 3}" x2="${W / 2}" y2="${y + gap - 5}" stroke="${C.accent}" stroke-width="2.5" marker-end="url(#${id})"/>`;
          y += gap;
        }
      });
      H = y + 10;
    }
  } else if (d.type === "cycle") {
    const steps = d.steps.slice(0, 6);
    const n = Math.max(steps.length, 1);
    const bw = n > 4 ? 150 : 168, lc = Math.floor(bw / 9), nc = Math.floor(bw / 7.2);
    const L = steps.map((s) => ({ l: wrap(s.label, lc, 2), n: wrap(s.note, nc, 3) }));
    const bh = Math.max(...L.map((o) => 26 + o.l.length * 18 + o.n.length * 15));
    const Rx = 230, Ry = 140, cx = W / 2, cy = Ry + bh / 2 + 14;
    H = cy * 2;
    body += `<ellipse cx="${cx}" cy="${cy}" rx="${Rx}" ry="${Ry}" fill="none" stroke="${C.accent}" stroke-width="2.5"/>`;
    for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n;
      const px = cx + Rx * Math.cos(t), py = cy + Ry * Math.sin(t);
      const ang = (Math.atan2(Ry * Math.cos(t), -Rx * Math.sin(t)) * 180) / Math.PI;
      body += `<path d="M-8,-7 L8,0 L-8,7 z" fill="${C.accent}" transform="translate(${px.toFixed(1)},${py.toFixed(1)}) rotate(${ang.toFixed(1)})"/>`;
    }
    steps.forEach((_, i) => {
      const t = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = cx + Rx * Math.cos(t), y = cy + Ry * Math.sin(t);
      body += `<rect x="${(x - bw / 2).toFixed(1)}" y="${(y - bh / 2).toFixed(1)}" width="${bw}" height="${bh}" rx="12" fill="${C.surface}" stroke="${C.line}" stroke-width="1.5"/>`;
      body += `<text text-anchor="middle" font-size="15" font-weight="700" fill="${C.fg}" ${FONT}>${tspans(L[i].l, x, y - bh / 2 + 24, 18)}</text>`;
      body += `<text text-anchor="middle" font-size="13" fill="${C.muted}" ${FONT}>${tspans(L[i].n, x, y - bh / 2 + 28 + L[i].l.length * 18, 15)}</text>`;
    });
    body += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="13" fill="${C.muted}" ${FONT} letter-spacing="1.5">REPEATS</text>`;
  } else if (d.type === "hierarchy") {
    const ch = d.children.slice(0, 4);
    const n = Math.max(ch.length, 1);
    const rl = wrap(d.root, 30, 2), rw = 300, rh = 22 + rl.length * 20, rx = (W - rw) / 2;
    body += `<rect x="${rx}" y="10" width="${rw}" height="${rh}" rx="12" fill="${C.accent}"/>`;
    body += `<text text-anchor="middle" font-size="17" font-weight="700" fill="${C.onAccent}" ${FONT}>${tspans(rl, W / 2, 36, 20)}</text>`;
    const gap = 16, cw = (W - 20 - (n - 1) * gap) / n, top = 10 + rh + 44, bus = 10 + rh + 22;
    const lc = Math.floor(cw / 9), ic = Math.floor(cw / 7.6);
    const C2 = ch.map((c) => ({ l: wrap(c.label, lc, 2), it: c.items.slice(0, 5).map((t) => wrap(t, ic, 3)) }));
    const chH = Math.max(...C2.map((o) => 30 + o.l.length * 18 + o.it.reduce((a, b) => a + b.length * 16 + 6, 0)));
    body += `<line x1="${W / 2}" y1="${10 + rh}" x2="${W / 2}" y2="${bus}" stroke="${C.line}" stroke-width="2"/>`;
    if (n > 1)
      body += `<line x1="${10 + cw / 2}" y1="${bus}" x2="${10 + (n - 1) * (cw + gap) + cw / 2}" y2="${bus}" stroke="${C.line}" stroke-width="2"/>`;
    ch.forEach((_, i) => {
      const x = 10 + i * (cw + gap), mx = x + cw / 2;
      body += `<line x1="${mx}" y1="${bus}" x2="${mx}" y2="${top - 4}" stroke="${C.line}" stroke-width="2" marker-end="url(#${id})"/>`;
      body += `<rect x="${x}" y="${top}" width="${cw}" height="${chH}" rx="12" fill="${C.surface}" stroke="${C.line}" stroke-width="1.5"/>`;
      body += `<text text-anchor="middle" font-size="15" font-weight="700" fill="${C.accent}" ${FONT}>${tspans(C2[i].l, mx, top + 24, 18)}</text>`;
      let y = top + 30 + C2[i].l.length * 18;
      for (const lines of C2[i].it) {
        body += `<circle cx="${x + 16}" cy="${y - 4}" r="3" fill="${C.muted}"/>`;
        body += `<text font-size="13.5" fill="${C.fg}" ${FONT}>${tspans(lines, x + 26, y, 16)}</text>`;
        y += lines.length * 16 + 6;
      }
    });
    H = top + chH + 10;
  } else if (d.type === "compare") {
    const cols = d.columns.slice(0, 3);
    const n = Math.max(cols.length, 1);
    const gap = 16, cw = (W - 20 - (n - 1) * gap) / n, ic = Math.floor(cw / 7.6);
    const C2 = cols.map((c) => c.items.slice(0, 6).map((t) => wrap(t, ic, 3)));
    const rows = Math.max(...C2.map((c) => c.length), 0);
    const rowH: number[] = [];
    for (let r = 0; r < rows; r++) rowH.push(Math.max(...C2.map((c) => (c[r] ? c[r].length * 16 + 16 : 0)), 28));
    const head = 44, h = head + rowH.reduce((a, b) => a + b, 0) + 6;
    cols.forEach((c, i) => {
      const x = 10 + i * (cw + gap);
      const fill = i % 2 ? C.fg : C.accent, txt = i % 2 ? C.surface : C.onAccent;
      body += `<rect x="${x}" y="10" width="${cw}" height="${h}" rx="12" fill="${C.surface}" stroke="${C.line}" stroke-width="1.5"/>`;
      body += `<path d="M${x} 22 a12 12 0 0 1 12 -12 h${cw - 24} a12 12 0 0 1 12 12 v${head - 12} h${-cw} z" fill="${fill}"/>`;
      body += `<text x="${x + cw / 2}" y="38" text-anchor="middle" font-size="16" font-weight="700" fill="${txt}" ${FONT}>${esc(wrap(c.label, Math.floor(cw / 9), 1)[0] ?? "")}</text>`;
      let y = 10 + head;
      for (let r = 0; r < rows; r++) {
        if (C2[i][r]) body += `<text font-size="13.5" fill="${C.fg}" ${FONT}>${tspans(C2[i][r], x + 16, y + 21, 16)}</text>`;
        y += rowH[r];
        if (r < rows - 1) body += `<line x1="${x + 12}" y1="${y}" x2="${x + cw - 12}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`;
      }
    });
    H = h + 20;
  } else {
    return "";
  }

  return `<svg viewBox="0 0 ${W} ${Math.ceil(H)}" role="img" aria-label="${esc(d.title || "Diagram")}" xmlns="http://www.w3.org/2000/svg">${defs}${body}</svg>`;
}
