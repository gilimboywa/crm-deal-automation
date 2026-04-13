import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import healthRouter from "./routes/health.js";
import dealsRouter from "./routes/deals.js";
import contactsRouter from "./routes/contacts.js";
import hubspotRouter from "./routes/hubspot.js";
import slackRouter from "./routes/slack.js";
import ingestRouter from "./routes/ingest.js";
import sourcesRouter from "./routes/sources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── API Routes ──
app.use("/api", healthRouter);
app.use("/api/deals", dealsRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/hubspot", hubspotRouter);
app.use("/api/slack", slackRouter);
app.use("/api/ingest", ingestRouter);
app.use("/api/sources", sourcesRouter);

// ── Serve static client in production ──
const clientDist = join(__dirname, "../client/dist");
app.use(express.static(clientDist));
app.get("/{*path}", (_req, res) => {
  res.sendFile(join(clientDist, "index.html"));
});

export default app;
