import { useId, useState, type ReactNode } from "react";
import { wordCount } from "@revision-desk/shared";

const ACCEPT = ".txt,.md,.vtt,.srt,.text,text/plain";
const MAX_BYTES = 3_000_000;

/** A transcript textarea with file upload and drag-and-drop. */
export function TranscriptInput({
  value,
  onChange,
  onFile,
  placeholder,
  minHeight = 300,
  extra,
  label,
}: {
  value: string;
  onChange: (text: string) => void;
  onFile?: (name: string) => void;
  placeholder: string;
  minHeight?: number;
  extra?: ReactNode;
  label: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState("");

  async function load(file: File) {
    if (file.size > MAX_BYTES) return setMsg("That file is over 3 MB. Upload a plain-text transcript under 3 MB.");
    try {
      onChange(await file.text());
      onFile?.(file.name);
      setMsg(`Loaded ${file.name}.`);
    } catch {
      setMsg("Couldn't read that file. Try saving it as plain text (.txt) first.");
    }
  }

  return (
    <div className={`drop${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void load(f); }}>
      <textarea id={`${id}-tx`} aria-label={label} value={value} placeholder={placeholder} style={{ minHeight }} onChange={(e) => onChange(e.target.value)} />
      <div className="drop-bar">
        <label className="btn" htmlFor={`${id}-file`}>Upload file</label>
        <input id={`${id}-file`} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
        <span>.txt, .md, .vtt, .srt</span>
        {extra}
        {msg && <span className="msg">{msg}</span>}
        <span className="count">{wordCount(value).toLocaleString()} words</span>
      </div>
    </div>
  );
}
