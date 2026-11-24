import { formatDate, type NoteSummary } from "@revision-desk/shared";

export function Sidebar({
  notes,
  loading,
  error,
  currentId,
  open,
  onSelect,
  onNew,
  onClose,
}: {
  notes: NoteSummary[];
  loading: boolean;
  error: string;
  currentId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <aside className={`side${open ? " open" : ""}`} aria-label="Your transcripts">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <rect x="2" y="3" width="17" height="21" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M6 9h9M6 13h9M6 17h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <rect x="15" y="2" width="9" height="14" rx="2" fill="var(--marker)" transform="rotate(25 19 9)" />
          </svg>
          Revision Desk
        </div>
        <button type="button" className="btn primary new" onClick={onNew}>
          + New notes from transcript
        </button>
        <div className="label">Your transcripts</div>
        <ul className="shelf">
          {notes.map((n) => (
            <li key={n.id}>
              <button type="button" className="shelf-item" aria-current={n.id === currentId} onClick={() => onSelect(n.id)}>
                <span className="t">{n.title}</span>
                <span className="m">
                  {formatDate(n.createdAt)} · {n.sectionCount} section{n.sectionCount === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {loading && <p className="side-note">Loading your notes…</p>}
        {error && <p className="side-note err">{error}</p>}
        {!loading && !error && notes.length === 0 && <p className="side-note">No transcripts yet. Notes you make appear here.</p>}
      </aside>
      {open && <div className="scrim" onClick={onClose} />}
    </>
  );
}
