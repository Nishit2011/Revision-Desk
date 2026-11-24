import { useEffect, useMemo, useState } from "react";
import { DIAGRAM_LABEL, renderDiagramSvg, type Diagram, type DiagramPalette } from "@revision-desk/shared";

function readPalette(): DiagramPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { surface: v("--surface"), fg: v("--fg"), muted: v("--muted"), line: v("--line"), accent: v("--accent"), onAccent: v("--on-accent") };
}

/** Re-reads the theme colours when the system switches between light and dark. */
function usePalette(): DiagramPalette {
  const [palette, setPalette] = useState(readPalette);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setPalette(readPalette());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return palette;
}

export function DiagramView({ diagram }: { diagram: Diagram }) {
  const palette = usePalette();
  // renderDiagramSvg escapes every piece of text it draws.
  const svg = useMemo(() => renderDiagramSvg(diagram, palette), [diagram, palette]);
  return (
    <figure className="diagram">
      <div className="scroll" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>
        <span className="label">{DIAGRAM_LABEL[diagram.type]}</span>
        <span>{diagram.title}</span>
      </figcaption>
    </figure>
  );
}
