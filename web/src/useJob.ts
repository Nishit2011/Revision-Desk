import { useCallback, useRef, useState } from "react";
import type { ProgressEvent } from "@revision-desk/shared";

export interface JobState {
  running: boolean;
  stage: string;
  title: string;
  sections: { heading: string; status: "planned" | "writing" | "done" }[];
  error: string;
}

const idle: JobState = { running: false, stage: "", title: "", sections: [], error: "" };

/** Tracks one agent workflow: its progress events, cancel, and error message. */
export function useJob() {
  const [state, setState] = useState<JobState>(idle);
  const ctrlRef = useRef<AbortController | null>(null);
  const baseRef = useRef(0);

  const onEvent = useCallback((ev: ProgressEvent) => {
    setState((s) => {
      switch (ev.type) {
        case "stage":
          return { ...s, stage: ev.message };
        case "outline":
          return { ...s, title: ev.title, sections: ev.headings.map((heading) => ({ heading, status: "planned" as const })) };
        case "section": {
          const sections = [...s.sections];
          const i = ev.index - baseRef.current;
          if (sections[i]) sections[i] = { heading: ev.heading, status: ev.status };
          return { ...s, sections };
        }
        default:
          return s;
      }
    });
  }, []);

  /** Run a workflow. `sectionBase` is the index of the first new section (non-zero when adding to notes). */
  const run = useCallback(
    async <T,>(fn: (onEvent: (ev: ProgressEvent) => void, signal: AbortSignal) => Promise<T>, sectionBase = 0): Promise<T | null> => {
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      baseRef.current = sectionBase;
      setState({ ...idle, running: true, stage: "Starting the agents…" });
      try {
        const result = await fn(onEvent, ctrl.signal);
        setState(idle);
        return result;
      } catch (err) {
        const cancelled = ctrl.signal.aborted;
        setState({ ...idle, error: cancelled ? "Cancelled. Nothing was changed." : (err as Error).message });
        return null;
      } finally {
        ctrlRef.current = null;
      }
    },
    [onEvent],
  );

  const cancel = useCallback(() => ctrlRef.current?.abort(), []);
  const clearError = useCallback(() => setState((s) => ({ ...s, error: "" })), []);

  return { state, run, cancel, clearError };
}
