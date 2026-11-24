# Revision Desk

Turn a lecture, class, podcast or meeting transcript into plain-language revision notes: a heading title, a subheading per section, explanations, key points, everyday examples, diagrams, key terms and self-check questions.

## Features

- **Paste or upload** a transcript (`.txt`, `.md`, `.vtt`, `.srt`). Timestamps and caption numbering are stripped automatically.
- **Generated notes**: title and subtitle, "big idea" summary, sections with explanations (key terms highlighted), key points, examples, a one-line "Remember", glossary and quiz.
- **Diagrams** drawn as SVG in four kinds: process (flow), cycle, breakdown (hierarchy) and comparison.
- **Sidebar** listing every transcript you've processed, with rename and delete.
- **Add to transcript** without regenerating everything:
  - as new section(s) after the existing ones,
  - as a continuation of an existing section,
  - or, only when chosen, rebuild all notes from the full transcript.
- **Edit the stored transcript** in place.
- **Export to PDF** (A4, light theme, diagrams and quiz answers included).

## How it runs

`index.html` is a single self-contained page built to run as a [Claude artifact](https://claude.ai). It uses the artifact runtime capabilities:

| Capability | Used for |
| --- | --- |
| `sample` | Asking Claude to write the notes |
| `db` + `user` | Saving notes privately to the viewer's account |
| `downloads` | Saving the exported PDF |

Outside a Claude artifact viewer, the page still opens and shows the built-in example notes, but generating notes and exporting are unavailable, and notes fall back to browser storage.

PDF export loads [html2canvas](https://html2canvas.hertzen.com/) 1.4.1 and [jsPDF](https://github.com/parallax/jsPDF) 2.5.1 from cdnjs on demand.
