import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "./config.ts";
import { notesRouter } from "./routes/notes.ts";
import { closePdfBrowser } from "./pdf.ts";
import { assetsRepo } from "./db.ts";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: config.model, effort: config.effort });
});
app.use("/api/notes", notesRouter);

/** Images extracted from uploaded slides and pictures. */
app.get("/api/assets/:id", (req, res) => {
  const asset = assetsRepo.get(req.params.id);
  if (!asset) return void res.status(404).end();
  res.set({ "Content-Type": asset.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  res.end(Buffer.from(asset.data));
});
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// In production, serve the built React app.
if (existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
}

const server = app.listen(config.port, () => {
  console.log(`Revision Desk API on http://localhost:${config.port} (model ${config.model}, effort ${config.effort})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    server.close();
    await closePdfBrowser();
    process.exit(0);
  });
}
