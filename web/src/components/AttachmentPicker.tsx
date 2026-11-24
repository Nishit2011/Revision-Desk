import { useId, useState } from "react";
import { ACCEPTED_UPLOADS, MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "@revision-desk/shared";

const ALLOWED = /\.(pptx|png|jpe?g|webp|gif)$/i;

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Upload slide decks (.pptx) and images to give the agents more context. */
export function AttachmentPicker({
  files,
  onChange,
  hint,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  hint: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState("");

  function add(list: FileList | File[]) {
    const incoming = [...list];
    const problems: string[] = [];
    const ok = incoming.filter((f) => {
      if (/\.ppt$/i.test(f.name)) problems.push(`${f.name}: save old .ppt files as .pptx first`);
      else if (!ALLOWED.test(f.name)) problems.push(`${f.name}: use .pptx, PNG, JPG, WebP or GIF`);
      else if (f.size > MAX_UPLOAD_BYTES) problems.push(`${f.name}: over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
      else return true;
      return false;
    });
    const merged = [...files, ...ok.filter((f) => !files.some((g) => g.name === f.name && g.size === f.size))];
    if (merged.length > MAX_UPLOAD_FILES) problems.push(`only ${MAX_UPLOAD_FILES} files at a time`);
    onChange(merged.slice(0, MAX_UPLOAD_FILES));
    setMsg(problems.length ? `Skipped ${problems.join("; ")}.` : "");
  }

  return (
    <div
      className={`attach${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) add(e.dataTransfer.files); }}
    >
      <div className="attach-head">
        <div>
          <strong>Slides &amp; images</strong> <span className="msg">(optional)</span>
          <p className="msg">{hint}</p>
        </div>
        <label className={`btn${disabled ? " is-disabled" : ""}`} htmlFor={`${id}-files`}>
          Add files
        </label>
        <input id={`${id}-files`} type="file" multiple accept={ACCEPTED_UPLOADS} hidden disabled={disabled} onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
      </div>
      {files.length > 0 && (
        <ul className="attach-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}`}>
              <span className="kind">{/\.pptx$/i.test(f.name) ? "Slides" : "Image"}</span>
              <span className="name">{f.name}</span>
              <span className="size">{size(f.size)}</span>
              <button type="button" className="link" disabled={disabled} onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="msg err">{msg}</p>}
    </div>
  );
}
