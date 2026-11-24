# Revision Desk

Turn a lecture, class, podcast or meeting transcript into plain-language revision notes. A team of Claude agents plans the sections, writes explanations with examples, draws diagrams, and adds key terms and self-check questions. Notes are saved, listed in a sidebar, can be extended with more transcript later, and export to PDF.

## Features

- **Paste or upload** a transcript (`.txt`, `.md`, `.vtt`, `.srt`). Caption timestamps and cue numbers are stripped.
- **Slides and images for extra context:** upload PowerPoint decks (`.pptx`) and images (PNG, JPG, WebP, GIF), such as whiteboard photos. Slide text, speaker notes and pictures are read by Claude, worked into the right sections, and useful pictures appear in those sections with captions. Notes can also be made from slides and images alone. Logos and template art repeated across slides are left out.
- **Notes for every transcript:** a heading title, subtitle and "big idea", then sections, each with a subheading, an explanation (key terms highlighted), a diagram, key points, an everyday example and a one-line "Remember". The notes end with a glossary and a quiz.
- **Diagrams** in four kinds, drawn as SVG: process (flow), cycle, breakdown (hierarchy) and comparison.
- **Sidebar** of every transcript processed, with rename and delete.
- **Add transcript, slides or images** to existing notes without regenerating everything:
  - **Place it where it fits (default):** the agents put each piece of added text, each slide and each image into the section it belongs in, and create new sections only for material no section covers.
  - **New section(s):** everything added becomes new sections after the existing ones.
  - **Continue a section:** everything added goes to the end of a section you pick.
  - **Regenerate everything from scratch:** rebuilds all notes from the full transcript and every upload, only when you choose it.
- **Edit the stored transcript** directly.
- **Export to PDF:** A4, selectable text, diagrams included, page numbers.
- Live progress while the agents work, with Cancel.

## Architecture

```
revision-desk/
├── shared/   Types and Zod schemas, SVG diagram renderer, transcript cleaning (used by server and web)
├── server/   Express API, SQLite storage, Claude agents, PDF export
│   ├── src/materials.ts  unpacks .pptx decks (slide order, text, notes, pictures) and resizes images
│   └── src/agents/
│       ├── llm.ts                 runAgent(): one structured-output Claude call, prompt caching, error mapping
│       ├── outlineAgent.ts        plans title, big idea and sections (and new sections for added content)
│       ├── sectionWriterAgent.ts  writes one section: explanation, key points, example, takeaway
│       ├── diagramAgent.ts        picks and designs a diagram for a section (or updates one)
│       ├── studyAidsAgent.ts      glossary and quiz
│       ├── continueAgent.ts       extends one existing section with new content
│       ├── materialReaderAgent.ts reads each slide and image (picture, slide text, speaker notes)
│       ├── placementAgent.ts      decides which section each slide, image or added text belongs to
│       └── orchestrator.ts        createNotes() and extendNotes(): the workflows that run the agents
└── web/      React + Vite frontend
```

### How the agents work together

```
transcript ─▶ Outline agent ─▶ ┬─ Section writer ─▶ Diagram agent ─┐
                               ├─ Section writer ─▶ Diagram agent ─┼─▶ Study aids agent ─▶ saved note
                               └─ …  (in parallel)                 ┘
```

- **New notes:** material reader (if slides or images were uploaded) → outline → placement (match slides and images to the planned sections) → section writers and diagram agents in parallel, each given its section's slides and images → study aids.
- **Place it where it fits:** the material reader reads the new slides and images, then the placement agent assigns each one, and the added text, to an existing section or to "new". Each existing section that receives material is extended by the continue agent (its diagram is updated if needed, and the chosen pictures are added). Material marked "new" gets new sections. Nothing else changes.
- **Add as new sections:** the outline agent plans sections for the new content only, given the existing headings; then writers, diagrams and study aids run for those sections alone.
- **Continue a section:** the continue agent writes only what the new content adds. The diagram agent decides whether the section's diagram should change. Study aids adds terms and questions for the new material.
- **Regenerate everything:** the full pipeline runs over the stored transcript, the new content, and every slide and image ever uploaded. Slides already read are not read again.

Each agent is one Claude call with **structured outputs** (Zod schemas), so every response is valid JSON in the expected shape. The transcript sits in a cached system prompt, so the section writers reuse the cache written by the outline agent. Progress streams to the browser as Server-Sent Events. Cancelling aborts the running agents, and nothing is saved.

These "agents" are a code-orchestrated workflow on the Claude Messages API. The app decides the steps, and each agent has one job. That keeps runs predictable and cheap. No hosted agent loop or sandbox is needed.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/notes` | List saved notes (sidebar) |
| `GET` | `/api/notes/:id` | Get one note |
| `POST` | `/api/notes` | Multipart form: `transcript`, `title?`, `sourceName?` and up to 10 `files` (.pptx or images, 50 MB each). Streams progress (SSE). |
| `POST` | `/api/notes/:id/extend` | Multipart form: `mode` (`auto`, `new`, `continue` or `rebuild`), `content`, `sectionId?` and `files`. Streams progress (SSE). |
| `PATCH` | `/api/notes/:id` | Rename or edit the stored transcript: `{ title?, transcript? }` |
| `DELETE` | `/api/notes/:id` | Delete notes |
| `GET` | `/api/notes/:id/pdf` | Download the notes as a PDF, including placed pictures |
| `GET` | `/api/assets/:id` | An image extracted from uploaded slides or pictures |
| `GET` | `/api/health` | Health check, plus the model and effort in use |

## Getting started

Requirements: **Node.js 22.13 or later** (for the built-in `node:sqlite`) and an Anthropic API key.

```bash
npm install
cp .env.example .env      # then set ANTHROPIC_API_KEY
npm run dev               # API on :8787, web app on http://localhost:5173
```

Production:

```bash
npm run build             # builds web/dist
npm start                 # serves the API and the built app on :8787
```

`npm install` also downloads Chrome for Puppeteer, which renders the PDFs. If that download was skipped, run `npx puppeteer browsers install chrome`.

### Configuration (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | API key. You can leave it unset after running `ant auth login`. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model for all agents |
| `CLAUDE_EFFORT` | `medium` | Effort for the writing agents: `low`, `medium`, `high`, `xhigh` or `max`. The study-aids agent always uses `low`. |
| `AGENT_CONCURRENCY` | `4` | How many section writers run at once |
| `MAX_TRANSCRIPT_CHARS` | `600000` | Longer transcripts are rejected with a message asking to split them |
| `PORT` | `8787` | Server port |
| `DATABASE_PATH` | `./data/revision-desk.db` | SQLite file |

Requests use server-side refusal fallbacks (`fallbacks: "default"`). If the model declines a request, the API retries it on a fallback model automatically.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the API (with reload) and the Vite dev server together |
| `npm run build` | Type-check and build the web app |
| `npm start` | Run the API and serve the built app |
| `npm run typecheck` | Type-check `shared`, `server` and `web` |
