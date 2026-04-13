import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";

const router = Router();

// ── GET / — List all contacts ──
router.get("/", async (_req, res) => {
  try {
    const contacts = await db
      .select()
      .from(schema.contacts)
      .orderBy(schema.contacts.createdAt);

    res.json({ contacts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── POST / — Create a new contact ──
router.post("/", async (req, res) => {
  try {
    const [contact] = await db
      .insert(schema.contacts)
      .values({
        ...req.body,
        createdAt: new Date().toISOString(),
      })
      .returning();

    res.status(201).json({ contact });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── PUT /:id — Update a contact ──
router.put("/:id", async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    if (isNaN(contactId)) {
      res.status(400).json({ error: "Invalid contact ID" });
      return;
    }

    const [updated] = await db
      .update(schema.contacts)
      .set(req.body)
      .where(eq(schema.contacts.id, contactId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    res.json({ contact: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
