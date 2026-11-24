import { useEffect, useState } from "react";
import type { ExtendMode, Note } from "@revision-desk/shared";
import { api } from "../api.ts";
import { useJob } from "../useJob.ts";
import { ProgressPanel } from "./ProgressPanel.tsx";
import { TranscriptInput } from "./TranscriptInput.tsx";

const GO_LABEL: Record<ExtendMode, string> = {
  new: "Add as new sections",
  continue: "Add to this section",
  rebuild: "Rebuild all notes",
};

/**
 * Add more transcript content to existing notes:
 * as new sections, as a continuation of one section, or (only when chosen) a full rebuild.
 */
export function AddPanel({
  note,
  onClose,
  onUpdated,
}: {
  note: Note;
  onClose: () => void;
  onUpdated: (note: Note, focusSectionId?: string, summary?: string) => void;
}) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<ExtendMode>("new");
  const [sectionId, setSectionId] = useState(note.sections.at(-1)?.id ?? "");
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState("");
  const [fullTx, setFullTx] = useState(note.transcript);
  const [txMsg, setTxMsg] = useState("");
  const { state: job, run, cancel } = useJob();

  useEffect(() => setFullTx(note.transcript), [note.transcript]);
  useEffect(() => setArmed(false), [mode]);

  async function go() {
    setMsg("");
    if (mode !== "rebuild" && content.trim().length < 40) return setMsg("Paste or upload the extra transcript content first.");
    if (mode === "rebuild" && !armed) {
      setArmed(true);
      return setMsg("This replaces every section, key term and question.");
    }
    const base = mode === "new" ? note.sections.length : 0;
    const done = await run(
      (onEvent, signal) => api.extendNotes(note.id, { mode, content, sectionId: mode === "continue" ? sectionId : undefined }, onEvent, signal),
      base,
    );
    setArmed(false);
    if (done) {
      setContent("");
      onUpdated(done.note, done.focusSectionId, done.summary);
    }
  }

  async function saveTranscript() {
    try {
      const saved = await api.updateNote(note.id, { transcript: fullTx });
      onUpdated(saved);
      setTxMsg('Transcript saved. Choose "Rebuild all notes" to update the notes from it.');
    } catch (err) {
      setTxMsg((err as Error).message);
    }
  }

  return (
    <section className="addpanel" id="addPanel" aria-label="Add to this transcript">
      <div>
        <h2 className="end-h tight">Add to this transcript</h2>
        <p className="msg">
          Paste or upload the extra part of the transcript. Only the new part is turned into notes. Everything already here stays as it is.
        </p>
      </div>

      <TranscriptInput label="Additional transcript content" value={content} onChange={setContent} minHeight={160} placeholder="Paste the additional transcript content here…" />

      <fieldset className="modes" disabled={job.running}>
        <legend className="label">How should it be added?</legend>
        <label className="mode">
          <input type="radio" name="addMode" checked={mode === "new"} onChange={() => setMode("new")} />
          <span>
            <strong>As new section(s)</strong>
            <small>New sections go after the existing ones, each with its own subheading.</small>
          </span>
        </label>
        <label className="mode">
          <input type="radio" name="addMode" checked={mode === "continue"} onChange={() => setMode("continue")} />
          <span>
            <strong>Continue an existing section</strong>
            <small>The new material is added to the end of the section you pick. What's already there is kept.</small>
          </span>
        </label>
        <select className="input sec-select" aria-label="Section to continue" value={sectionId} disabled={mode !== "continue"} onChange={(e) => setSectionId(e.target.value)}>
          {note.sections.map((s, i) => (
            <option key={s.id} value={s.id}>
              {i + 1}. {s.heading}
            </option>
          ))}
        </select>
        <label className="mode">
          <input type="radio" name="addMode" checked={mode === "rebuild"} onChange={() => setMode("rebuild")} />
          <span>
            <strong>Rebuild all notes</strong>
            <small>Regenerates every section from the full transcript with the new part added. This replaces the current notes.</small>
          </span>
        </label>
      </fieldset>

      <div className="gen-row">
        <button type="button" className={`btn primary${armed ? " danger-fill" : ""}`} disabled={job.running} onClick={go}>
          {armed ? "Click again to replace all notes" : GO_LABEL[mode]}
        </button>
        <button type="button" className="btn" onClick={onClose} disabled={job.running}>
          Close
        </button>
        {(job.error || msg) && <span className={`msg${job.error ? " err" : ""}`}>{job.error || msg}</span>}
      </div>

      <ProgressPanel job={job} onCancel={cancel} />

      <details className="txview">
        <summary>View or edit the full transcript</summary>
        <textarea className="input" aria-label="Full transcript" value={fullTx} onChange={(e) => setFullTx(e.target.value)} />
        <div className="gen-row">
          <button type="button" className="btn" onClick={saveTranscript} disabled={fullTx === note.transcript}>
            Save transcript
          </button>
          <span className="msg">{txMsg || 'Saving changes the stored transcript only. Choose "Rebuild all notes" to update the notes from it.'}</span>
        </div>
      </details>
    </section>
  );
}
