import { useEffect, useState } from "react";
import type { ExtendMode, Note } from "@revision-desk/shared";
import { api } from "../api.ts";
import { useJob } from "../useJob.ts";
import { AttachmentPicker } from "./AttachmentPicker.tsx";
import { ProgressPanel } from "./ProgressPanel.tsx";
import { TranscriptInput } from "./TranscriptInput.tsx";

const GO_LABEL: Record<ExtendMode, string> = {
  auto: "Add to notes",
  new: "Add as new sections",
  continue: "Add to this section",
  rebuild: "Regenerate everything",
};

const MODES: { mode: ExtendMode; title: string; body: string }[] = [
  {
    mode: "auto",
    title: "Place it where it fits (recommended)",
    body: "The agents read the new text, slides and images and add each to the section it belongs in. Anything no section covers becomes a new section. Nothing else is rewritten.",
  },
  {
    mode: "new",
    title: "As new section(s)",
    body: "Everything added becomes new sections after the existing ones. Slides and images are placed among those new sections.",
  },
  {
    mode: "continue",
    title: "Continue one section",
    body: "Everything added goes to the end of the section you pick. What's already there is kept.",
  },
  {
    mode: "rebuild",
    title: "Regenerate everything from scratch",
    body: "Rebuilds every section, diagram, key term and question from the full transcript and all slides and images, including anything added here. This replaces the current notes.",
  },
];

/**
 * Add more transcript text, slides or images to existing notes without regenerating them,
 * or regenerate everything from scratch when chosen.
 */
export function AddPanel({
  note,
  onClose,
  onUpdated,
}: {
  note: Note;
  onClose: () => void;
  onUpdated: (note: Note, focusSectionId?: string, summary?: string, warnings?: string[]) => void;
}) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<ExtendMode>("auto");
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
    if (mode !== "rebuild" && content.trim().length < 40 && !files.length) {
      return setMsg("Paste the extra transcript text or add slides or images first.");
    }
    if (mode === "rebuild" && !armed) {
      setArmed(true);
      return setMsg("This replaces every section, diagram, key term and question.");
    }
    const base = mode === "new" ? note.sections.length : 0;
    const done = await run(
      (onEvent, signal) =>
        api.extendNotes(note.id, { mode, content, sectionId: mode === "continue" ? sectionId : undefined }, files, onEvent, signal),
      base,
    );
    setArmed(false);
    if (done) {
      setContent("");
      setFiles([]);
      onUpdated(done.note, done.focusSectionId, done.summary, done.warnings);
    }
  }

  async function saveTranscript() {
    try {
      const saved = await api.updateNote(note.id, { transcript: fullTx });
      onUpdated(saved);
      setTxMsg('Transcript saved. Choose "Regenerate everything from scratch" to update the notes from it.');
    } catch (err) {
      setTxMsg((err as Error).message);
    }
  }

  return (
    <section className="addpanel" id="addPanel" aria-label="Add to this transcript">
      <div>
        <h2 className="end-h tight">Add to this transcript</h2>
        <p className="msg">
          Paste more of the transcript, upload slides or images, or both. Only the new material is turned into notes unless you choose to
          regenerate everything.
        </p>
      </div>

      <TranscriptInput label="Additional transcript content" value={content} onChange={setContent} minHeight={140} placeholder="Paste the additional transcript content here (optional if you add slides or images)…" />

      <AttachmentPicker
        files={files}
        onChange={setFiles}
        disabled={job.running}
        hint="Slides (.pptx) or images to add. Each slide and picture is read and placed in the section it belongs to."
      />

      <fieldset className="modes" disabled={job.running}>
        <legend className="label">How should it be added?</legend>
        {MODES.map((m) => (
          <div key={m.mode} className="mode-wrap">
            <label className="mode">
              <input type="radio" name="addMode" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
              <span>
                <strong>{m.title}</strong>
                <small>{m.body}</small>
              </span>
            </label>
            {m.mode === "continue" && (
              <select className="input sec-select" aria-label="Section to continue" value={sectionId} disabled={mode !== "continue"} onChange={(e) => setSectionId(e.target.value)}>
                {note.sections.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {i + 1}. {s.heading}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
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
          <span className="msg">{txMsg || 'Saving changes the stored transcript only. Choose "Regenerate everything from scratch" to update the notes from it.'}</span>
        </div>
      </details>
    </section>
  );
}
