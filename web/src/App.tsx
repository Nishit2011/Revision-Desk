import { useCallback, useEffect, useRef, useState } from "react";
import type { Note, NoteSummary } from "@revision-desk/shared";
import { api } from "./api.ts";
import { Composer } from "./components/Composer.tsx";
import { NoteView } from "./components/NoteView.tsx";
import { Sidebar } from "./components/Sidebar.tsx";

const summarize = (n: Note): NoteSummary => ({
  id: n.id,
  title: n.title,
  sectionCount: n.sections.length,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
});

export function App() {
  const [summaries, setSummaries] = useState<NoteSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [view, setView] = useState<"new" | "note">("new");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [noteError, setNoteError] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<number>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), msg.length > 80 ? 8000 : 3200);
  }, []);

  useEffect(() => {
    api
      .listNotes()
      .then((list) => {
        setSummaries(list);
        if (list[0]) {
          setCurrentId(list[0].id);
          setView("note");
        }
      })
      .catch(() => setListError("Couldn't reach the server. Is it running?"))
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    if (view !== "note" || !currentId) return;
    if (note?.id === currentId) return;
    setNoteError("");
    let live = true;
    api
      .getNote(currentId)
      .then((n) => live && setNote(n))
      .catch((err) => live && setNoteError((err as Error).message));
    return () => {
      live = false;
    };
  }, [view, currentId, note?.id]);

  const upsert = (n: Note) => {
    setNote(n);
    setSummaries((list) => {
      const s = summarize(n);
      const rest = list.filter((x) => x.id !== n.id);
      return list.some((x) => x.id === n.id) ? list.map((x) => (x.id === n.id ? s : x)) : [s, ...rest];
    });
  };

  return (
    <div className="app">
      <Sidebar
        notes={summaries}
        loading={listLoading}
        error={listError}
        currentId={view === "note" ? currentId : null}
        open={sideOpen}
        onClose={() => setSideOpen(false)}
        onNew={() => {
          setView("new");
          setSideOpen(false);
          window.scrollTo(0, 0);
        }}
        onSelect={(id) => {
          setCurrentId(id);
          setView("note");
          setSideOpen(false);
          window.scrollTo(0, 0);
        }}
      />
      <main className="main">
        <div className="col">
          <div className="topbar">
            <button type="button" className="btn" onClick={() => setSideOpen(true)}>
              Transcripts
            </button>
            <span className="brand small">Revision Desk</span>
          </div>
          {view === "new" && (
            <Composer
              onCreated={(n, warnings) => {
                upsert(n);
                setCurrentId(n.id);
                setView("note");
                window.scrollTo(0, 0);
                toast(["Revision notes ready.", ...warnings].join(" "));
              }}
            />
          )}
          {view === "note" && noteError && <p className="msg err">{noteError}</p>}
          {view === "note" && !noteError && note && note.id === currentId && (
            <NoteView
              note={note}
              toast={toast}
              onChanged={upsert}
              onDeleted={(id) => {
                const rest = summaries.filter((s) => s.id !== id);
                setSummaries(rest);
                setNote(null);
                if (rest[0]) setCurrentId(rest[0].id);
                else {
                  setCurrentId(null);
                  setView("new");
                }
              }}
            />
          )}
          {view === "note" && !noteError && (!note || note.id !== currentId) && <p className="msg">Loading notes…</p>}
        </div>
      </main>
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
