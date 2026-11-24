import type { JobState } from "../useJob.ts";

const STATUS_LABEL = { planned: "Planned", writing: "Writing", done: "Done" } as const;

export function ProgressPanel({ job, onCancel }: { job: JobState; onCancel: () => void }) {
  if (!job.running) return null;
  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="progress-head">
        <strong>{job.title || "Working on your notes…"}</strong>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="bar">
        <i />
      </div>
      <div className="msg">{job.stage}</div>
      {job.sections.length > 0 && (
        <ul className="progress-list">
          {job.sections.map((s, i) => (
            <li key={i} data-status={s.status}>
              <span className="pill">{STATUS_LABEL[s.status]}</span>
              {s.heading}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
