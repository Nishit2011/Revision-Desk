import { useEffect, useRef, useState } from "react";
import { formatDate, type Note, type Section } from "@revision-desk/shared";
import { api } from "../api.ts";
import { AddPanel } from "./AddPanel.tsx";
import { DiagramView } from "./DiagramView.tsx";
import { Paragraphs, Rich } from "./Rich.tsx";

function scrollToId(id: string) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function SectionView({ section, index, total }: { section: Section; index: number; total: number }) {
  return (
    <section className="sec" id={`sec-${section.id}`}>
      <div>
        <div className="sec-n">
          SECTION {index + 1} OF {total}
          {section.addedAt ? <span className="chip">Added {formatDate(section.addedAt)}</span> : section.updatedAt ? <span className="chip">Extended {formatDate(section.updatedAt)}</span> : null}
        </div>
        <h2>{section.heading}</h2>
        <div className="explain">
          <Paragraphs text={section.explanation} />
        </div>
      </div>
      {section.diagram && <DiagramView diagram={section.diagram} />}
      <div className="grid2">
        {section.keyPoints.length > 0 && (
          <div className="card">
            <h3>Key points</h3>
            <ul>
              {section.keyPoints.map((p, i) => (
                <Rich key={i} as="li" text={p} />
              ))}
            </ul>
          </div>
        )}
        {section.example && (
          <div className="card example">
            <h3>Example</h3>
            <div className="explain">
              <Paragraphs text={section.example} />
            </div>
          </div>
        )}
      </div>
      {section.remember && (
        <p className="remember">
          <span className="label">Remember</span>
          <Rich text={section.remember} />
        </p>
      )}
    </section>
  );
}

export function NoteView({
  note,
  onChanged,
  onDeleted,
  toast,
}: {
  note: Note;
  onChanged: (note: Note) => void;
  onDeleted: (id: string) => void;
  toast: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const timer = useRef<number>(undefined);

  useEffect(() => {
    setAdding(false);
    setRenaming(false);
    setDeleteArmed(false);
  }, [note.id]);

  useEffect(() => {
    if (pendingFocus) {
      scrollToId(`sec-${pendingFocus}`);
      setPendingFocus(null);
    }
  }, [pendingFocus, note]);

  async function saveTitle() {
    setRenaming(false);
    const t = titleDraft.trim();
    if (!t || t === note.title) return;
    try {
      onChanged(await api.updateNote(note.id, { title: t }));
      toast("Renamed.");
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDeleteArmed(false), 4000);
      return;
    }
    try {
      await api.deleteNote(note.id);
      onDeleted(note.id);
      toast("Notes deleted.");
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <article className="note">
      <header className="note-head">
        <div className="eyebrow">
          Revision notes · {formatDate(note.createdAt)} · {note.sourceName}
        </div>
        {renaming ? (
          <input
            className="input rename-in"
            aria-label="Title"
            autoFocus
            maxLength={160}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <h1>{note.title}</h1>
        )}
        {note.subtitle && <p className="subtitle">{note.subtitle}</p>}
        <div className="actions">
          <a className="btn primary" href={api.pdfUrl(note.id)} download>
            Export PDF
          </a>
          <button type="button" className="btn" aria-expanded={adding} aria-controls="addPanel" onClick={() => setAdding((a) => !a)}>
            + Add to transcript
          </button>
          <button type="button" className="btn" onClick={() => { setTitleDraft(note.title); setRenaming(true); }}>
            Rename
          </button>
          <button type="button" className="btn danger" onClick={remove}>
            {deleteArmed ? "Click again to delete" : "Delete"}
          </button>
        </div>
      </header>

      {adding && (
        <AddPanel
          note={note}
          onClose={() => setAdding(false)}
          onUpdated={(n, focus, summary) => {
            onChanged(n);
            if (summary) {
              setAdding(false);
              toast(summary);
            }
            if (focus) setPendingFocus(focus);
          }}
        />
      )}

      {note.bigIdea && (
        <section className="bigidea">
          <div className="label">The big idea</div>
          <Rich as="p" text={note.bigIdea} />
        </section>
      )}

      <nav className="toc" aria-label="Sections">
        <div className="label">In these notes</div>
        <ol>
          {note.sections.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => scrollToId(`sec-${s.id}`)}>
                {s.heading}
              </button>
            </li>
          ))}
          {note.glossary.length > 0 && (
            <li>
              <button type="button" onClick={() => scrollToId("sec-gloss")}>Key terms</button>
            </li>
          )}
          {note.quiz.length > 0 && (
            <li>
              <button type="button" onClick={() => scrollToId("sec-quiz")}>Check yourself</button>
            </li>
          )}
        </ol>
      </nav>

      {note.sections.map((s, i) => (
        <SectionView key={s.id} section={s} index={i} total={note.sections.length} />
      ))}

      {note.glossary.length > 0 && (
        <section id="sec-gloss">
          <h2 className="end-h">Key terms</h2>
          <dl className="gloss">
            {note.glossary.map((g, i) => (
              <div key={i}>
                <dt>{g.term}</dt>
                <dd>{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {note.quiz.length > 0 && (
        <section id="sec-quiz">
          <h2 className="end-h">Check yourself</h2>
          <div className="quiz">
            {note.quiz.map((q, i) => (
              <details key={i}>
                <summary>{q.q}</summary>
                <p>{q.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
