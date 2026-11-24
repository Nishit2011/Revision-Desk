import puppeteer, { type Browser } from "puppeteer";
import { DIAGRAM_LABEL, esc, formatDate, LIGHT_PALETTE, paragraphs, renderDiagramSvg, rich, type Note } from "@revision-desk/shared";

const paras = (s: string) => paragraphs(s).map((p) => `<p>${rich(p)}</p>`).join("");

/** A print-ready HTML document for the notes. */
export function notesToPrintHtml(note: Note): string {
  const sections = note.sections
    .map(
      (s, i) => `
    <section class="sec">
      <div class="sec-n">SECTION ${i + 1} OF ${note.sections.length}</div>
      <h2>${esc(s.heading)}</h2>
      <div class="explain">${paras(s.explanation)}</div>
      ${
        s.diagram
          ? `<figure>${renderDiagramSvg(s.diagram, LIGHT_PALETTE)}<figcaption><b>${DIAGRAM_LABEL[s.diagram.type]}</b> ${esc(s.diagram.title)}</figcaption></figure>`
          : ""
      }
      <div class="grid">
        ${s.keyPoints.length ? `<div class="card"><h3>Key points</h3><ul>${s.keyPoints.map((p) => `<li>${rich(p)}</li>`).join("")}</ul></div>` : ""}
        ${s.example ? `<div class="card ex"><h3>Example</h3>${paras(s.example)}</div>` : ""}
      </div>
      ${s.remember ? `<p class="remember"><span>REMEMBER</span>${rich(s.remember)}</p>` : ""}
    </section>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(note.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap">
<style>
  body{font-family:"Atkinson Hyperlegible","Segoe UI",system-ui,sans-serif;color:#18202C;font-size:11pt;line-height:1.55;margin:0}
  h1,h2,h3{font-family:"Bricolage Grotesque","Segoe UI",system-ui,sans-serif;line-height:1.15;margin:0}
  h1{font-size:26pt;font-weight:800} h2{font-size:16pt;margin:2pt 0 8pt} h3{font-size:11pt;margin-bottom:4pt}
  .meta{font-size:8.5pt;letter-spacing:.08em;text-transform:uppercase;color:#4F5A6B}
  .subtitle{color:#4F5A6B;font-size:13pt;margin:6pt 0 0}
  header{border-bottom:1px solid #D5DBE5;padding-bottom:12pt;margin-bottom:14pt}
  .big{border:1px solid #D5DBE5;border-radius:8pt;padding:10pt 12pt;margin-bottom:16pt;break-inside:avoid}
  .big p{margin:4pt 0 0;font-size:12pt}
  mark{background:#FFE27A;color:#18202C;padding:0 2pt;border-radius:2pt}
  .sec{margin-top:18pt} .sec-n{font-size:8pt;letter-spacing:.06em;color:#2B54D6}
  h2{break-after:avoid} .explain p{margin:0 0 6pt}
  figure{margin:10pt 0;border:1px solid #D5DBE5;border-radius:8pt;padding:8pt;break-inside:avoid}
  figure svg{width:100%;height:auto;display:block}
  figcaption{font-size:9pt;color:#4F5A6B;margin-top:4pt}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8pt}
  .card{border:1px solid #D5DBE5;border-radius:8pt;padding:8pt 10pt;break-inside:avoid}
  .card.ex{background:#EEF1F6;border-color:#EEF1F6} .card p{margin:0 0 4pt} .card ul{margin:0;padding-left:14pt}
  .remember{font-weight:700;margin:8pt 0 0;break-inside:avoid} .remember span{font-size:8pt;letter-spacing:.08em;color:#2B54D6;margin-right:8pt}
  .end{margin-top:22pt;break-inside:avoid-page}
  dl{display:grid;grid-template-columns:1fr 1fr;gap:6pt;margin:8pt 0 0} dl div{border:1px solid #D5DBE5;border-radius:6pt;padding:6pt 8pt;break-inside:avoid}
  dt{font-weight:700} dd{margin:0;color:#4F5A6B}
  .q{border:1px solid #D5DBE5;border-radius:6pt;padding:6pt 8pt;margin-top:6pt;break-inside:avoid} .q b{display:block} .q span{color:#4F5A6B}
</style></head><body>
  <header>
    <div class="meta">Revision notes · ${esc(formatDate(note.createdAt))} · ${esc(note.sourceName)}</div>
    <h1>${esc(note.title)}</h1>
    ${note.subtitle ? `<p class="subtitle">${esc(note.subtitle)}</p>` : ""}
  </header>
  ${note.bigIdea ? `<div class="big"><div class="meta">The big idea</div><p>${rich(note.bigIdea)}</p></div>` : ""}
  ${sections}
  ${note.glossary.length ? `<div class="end"><h2>Key terms</h2><dl>${note.glossary.map((g) => `<div><dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}</dd></div>`).join("")}</dl></div>` : ""}
  ${note.quiz.length ? `<div class="end"><h2>Check yourself</h2>${note.quiz.map((q) => `<div class="q"><b>${esc(q.q)}</b><span>${esc(q.a)}</span></div>`).join("")}</div>` : ""}
</body></html>`;
}

let browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  browserPromise ??= puppeteer.launch({ headless: true }).catch((err) => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

/** Render the notes to an A4 PDF with selectable text and page numbers. */
export async function renderNotesPdf(note: Note): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Web fonts load from Google Fonts when online; system fonts are used otherwise.
    await page.setContent(notesToPrintHtml(note), { waitUntil: "load", timeout: 20_000 }).catch(() => undefined);
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]));
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:7pt;color:#6E7887;width:100%;padding:0 15mm;display:flex;justify-content:space-between;font-family:system-ui,sans-serif"><span>${esc(
        note.title,
      )}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser() {
  if (browserPromise) (await browserPromise.catch(() => null))?.close();
}
