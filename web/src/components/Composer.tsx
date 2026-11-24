import { useState } from "react";
import type { Note } from "@revision-desk/shared";
import { api } from "../api.ts";
import { useJob } from "../useJob.ts";
import { ProgressPanel } from "./ProgressPanel.tsx";
import { TranscriptInput } from "./TranscriptInput.tsx";
import { SAMPLE_TRANSCRIPT } from "../sample.ts";

export function Composer({ onCreated }: { onCreated: (note: Note) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const { state: job, run, cancel } = useJob();

  async function generate() {
    const done = await run((onEvent, signal) =>
      api.createNotes({ transcript: text, title: title.trim() || undefined, sourceName: sourceName || undefined }, onEvent, signal),
    );
    if (done) onCreated(done.note);
  }

  return (
    <section className="composer">
      <div className="eyebrow">New notes</div>
      <h1>Turn a transcript into revision notes</h1>
      <p className="lede">
        Paste a lecture, class, podcast or meeting transcript, or upload a text file. A team of Claude agents plans the sections, writes
        plain-language explanations with examples, draws diagrams, and adds key terms and self-check questions.
      </p>
      <div className="field">
        <label htmlFor="titleIn">
          Title <span className="msg">(optional, Claude suggests one)</span>
        </label>
        <input id="titleIn" className="input" maxLength={160} value={title} placeholder="e.g. Biology week 7: Photosynthesis" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <span className="field-label">Transcript</span>
        <TranscriptInput
          label="Transcript"
          value={text}
          onChange={setText}
          onFile={setSourceName}
          placeholder="Paste your transcript here, or drop a .txt, .md, .vtt or .srt file onto this box."
          extra={
            <button type="button" className="link" onClick={() => { setText(SAMPLE_TRANSCRIPT); setSourceName("Sample lecture transcript"); }}>
              Use a sample transcript
            </button>
          }
        />
      </div>
      <div className="gen-row">
        <button type="button" className="btn primary big" disabled={job.running || !text.trim()} onClick={generate}>
          Make revision notes
        </button>
        {job.error && <span className="msg err">{job.error}</span>}
      </div>
      <ProgressPanel job={job} onCancel={cancel} />
    </section>
  );
}
