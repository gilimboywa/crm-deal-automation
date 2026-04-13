import { Router } from "express";
import { manualPoll } from "../services/fathom-poller.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Batch skip closed-won/lost and internal transcripts
router.post("/fathom/batch-skip", async (_req, res) => {
  try {
    const { db, schema } = await import("../../db/index.js");
    const { eq } = await import("drizzle-orm");

    const allDeals = db.select().from(schema.deals).all();
    const closedNames = allDeals
      .filter((d: any) => d.dealStage === "closed_won" || d.dealStage === "closed_lost")
      .map((d: any) => d.companyName.toLowerCase().trim())
      .filter((n: string) => n.length > 2);

    const pending = db.select().from(schema.fathomTranscripts)
      .where(eq(schema.fathomTranscripts.status, "pending")).all();

    const skipPatterns = [
      "paid ads", "sales coaching", "team meeting", "implementation weekly",
      "design team", "marketing", "engineering", "product", "standup", "sprint",
      "retro", "all hands", "1:1", "interview", "hiring", "training",
      "weekly touch base", "weekly touchbase", "biweekly check-in",
      "monthly touchpoint", "onboarding touchpoint", "onboarding |",
      "winddown weekly", "ubo requirements", "class action", "finovate",
    ];

    let skippedClosed = 0;
    let skippedInternal = 0;
    const now = new Date().toISOString();

    for (const t of pending as any[]) {
      const titleLower = t.title.toLowerCase();
      const segments = titleLower.split(/[|/&<>]/).concat(titleLower.split(" - "))
        .map((s: string) => s.replace(/eisen/gi, "").trim()).filter((s: string) => s.length > 2);

      // Check closed deals
      const isClosed = closedNames.some((cn: string) => {
        if (titleLower.includes(cn)) return true;
        return segments.some((seg: string) => cn.includes(seg) || seg.includes(cn));
      });

      if (isClosed) {
        db.update(schema.fathomTranscripts)
          .set({ status: "skipped", processedAt: now, errorMessage: "Closed deal" })
          .where(eq(schema.fathomTranscripts.id, t.id)).run();
        skippedClosed++;
        continue;
      }

      // Check internal meetings
      const isInternal = skipPatterns.some(p => titleLower.includes(p));
      const isSingleName = titleLower.split(/[\s/\-|]/).filter(Boolean).length <= 1;
      const hasNoCompany = !titleLower.includes("eisen") && !titleLower.includes("escheatment") && !titleLower.includes("demo") && !titleLower.includes("proposal") && !titleLower.includes("intro");

      if (isInternal || isSingleName || hasNoCompany) {
        db.update(schema.fathomTranscripts)
          .set({ status: "skipped", processedAt: now, errorMessage: "Internal/non-deal" })
          .where(eq(schema.fathomTranscripts.id, t.id)).run();
        skippedInternal++;
      }
    }

    const remaining = db.select().from(schema.fathomTranscripts)
      .where(eq(schema.fathomTranscripts.status, "pending")).all().length;

    res.json({ skippedClosed, skippedInternal, remaining, total: pending.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// Get transcript stats and reset incorrectly skipped ones
router.post("/fathom/reset-skipped", async (_req, res) => {
  try {
    const { db, schema } = await import("../../db/index.js");
    const { eq } = await import("drizzle-orm");

    const allDeals = db.select().from(schema.deals).all();
    const closedNames = allDeals
      .filter((d: any) => d.dealStage === "closed_won" || d.dealStage === "closed_lost")
      .map((d: any) => d.companyName.toLowerCase().trim())
      .filter((n: string) => n.length > 2);

    const internalPatterns = [
      "paid ads", "sales coaching", "team meeting", "implementation weekly",
      "design team", "marketing", "engineering", "product", "standup", "sprint",
      "retro", "all hands", "1:1", "interview", "hiring", "training",
      "weekly touch base", "weekly touchbase", "biweekly check-in",
      "monthly touchpoint", "onboarding touchpoint", "onboarding |",
      "winddown weekly", "ubo requirements", "class action", "finovate",
      "gomarketmodel", "go market model", "fathom demo", "apollo",
    ];

    const skipped = db.select().from(schema.fathomTranscripts)
      .where(eq(schema.fathomTranscripts.status, "skipped")).all();

    let reset = 0;
    let kept = 0;

    for (const t of skipped as any[]) {
      const titleLower = t.title.toLowerCase();

      // Should it stay skipped?
      const isInternal = internalPatterns.some(p => titleLower.includes(p));
      const isSingleWord = titleLower.split(/[\s/\-|]/).filter(Boolean).length <= 1;
      const hasNoCompany = !titleLower.includes("eisen") && !titleLower.includes("escheatment") && !titleLower.includes("demo") && !titleLower.includes("proposal") && !titleLower.includes("intro");
      const segments = titleLower.split(/[|/&<>]/).concat(titleLower.split(" - "))
        .map((s: string) => s.replace(/eisen/gi, "").trim()).filter((s: string) => s.length > 2);
      const isClosed = closedNames.some((cn: string) => {
        if (titleLower.includes(cn)) return true;
        return segments.some((seg: string) => cn.includes(seg) || seg.includes(cn));
      });

      if (isInternal || isSingleWord || hasNoCompany || isClosed) {
        kept++;
      } else {
        // Reset to pending
        db.update(schema.fathomTranscripts)
          .set({ status: "pending", processedAt: null, errorMessage: null })
          .where(eq(schema.fathomTranscripts.id, t.id)).run();
        reset++;
      }
    }

    const pending = db.select().from(schema.fathomTranscripts)
      .where(eq(schema.fathomTranscripts.status, "pending")).all().length;

    res.json({ totalSkipped: skipped.length, reset, keptSkipped: kept, nowPending: pending });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// Get transcript status summary
router.get("/fathom/stats", async (_req, res) => {
  try {
    const { db, schema } = await import("../../db/index.js");
    const all = db.select().from(schema.fathomTranscripts).all() as any[];
    const stats: Record<string, number> = {};
    for (const t of all) {
      stats[t.status] = (stats[t.status] || 0) + 1;
    }
    res.json({ total: all.length, ...stats });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Reset errored transcripts back to pending
router.post("/fathom/reset-errors", async (_req, res) => {
  try {
    const { db, schema } = await import("../../db/index.js");
    const { eq } = await import("drizzle-orm");

    const errored = db.select().from(schema.fathomTranscripts)
      .where(eq(schema.fathomTranscripts.status, "error")).all();

    let reset = 0;
    for (const t of errored as any[]) {
      db.update(schema.fathomTranscripts)
        .set({ status: "pending", processedAt: null, errorMessage: null })
        .where(eq(schema.fathomTranscripts.id, t.id)).run();
      reset++;
    }

    const pending = db.select().from(schema.fathomTranscripts)
      .where(eq(schema.fathomTranscripts.status, "pending")).all().length;

    res.json({ totalErrored: errored.length, reset, nowPending: pending });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post("/fathom/poll", async (_req, res) => {
  try {
    const result = await manualPoll();
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
