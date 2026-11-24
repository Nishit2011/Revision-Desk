import type {
  CreateNoteRequest,
  ExtendNoteRequest,
  Note,
  NoteSummary,
  ProgressEvent,
  UpdateNoteRequest,
} from "@revision-desk/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status}).`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  listNotes: () => fetch("/api/notes").then((r) => json<NoteSummary[]>(r)),
  getNote: (id: string) => fetch(`/api/notes/${id}`).then((r) => json<Note>(r)),
  updateNote: (id: string, patch: UpdateNoteRequest) =>
    fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<Note>(r)),
  deleteNote: (id: string) => fetch(`/api/notes/${id}`, { method: "DELETE" }).then((r) => json<void>(r)),
  pdfUrl: (id: string) => `/api/notes/${id}/pdf`,

  createNotes: (body: CreateNoteRequest, onEvent: (ev: ProgressEvent) => void, signal: AbortSignal) =>
    streamEvents("/api/notes", body, onEvent, signal),
  extendNotes: (id: string, body: ExtendNoteRequest, onEvent: (ev: ProgressEvent) => void, signal: AbortSignal) =>
    streamEvents(`/api/notes/${id}/extend`, body, onEvent, signal),
};

/** POST a request and read the agents' progress as Server-Sent Events. Resolves with the final "done" event. */
async function streamEvents(
  url: string,
  body: unknown,
  onEvent: (ev: ProgressEvent) => void,
  signal: AbortSignal,
): Promise<Extract<ProgressEvent, { type: "done" }>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) await json(res);

  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (!data) continue;
      const ev = JSON.parse(data) as ProgressEvent;
      if (ev.type === "error") throw new Error(ev.message);
      onEvent(ev);
      if (ev.type === "done") return ev;
    }
  }
  throw new Error("The connection closed before the notes were finished. Try again.");
}
