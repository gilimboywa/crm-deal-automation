/**
 * sources.ts — API routes for all data source integrations.
 *
 * Provides endpoints to trigger email polling, Gino badge processing,
 * and calendar enrichment. All three are FIRST-CLASS data sources.
 */

import { Router } from "express";
import { processEmails } from "../services/email-poller.js";
import { processGinoBadges } from "../services/gino-client.js";
import { getAuthUrl, exchangeCode, setTokens } from "../services/google-auth.js";
import { getIndexStats, rebuildIndex } from "../services/hubspot-index.js";
import { routeTranscript, routeEmail } from "../services/router.js";

const router = Router();

// Store OAuth tokens in memory (in production, persist these)
const storedTokens: Record<string, any> = {};

// ── Google OAuth flow ──

router.get("/auth/google/url", (_req, res) => {
  const url = getAuthUrl();
  res.json({ url });
});

router.get("/auth/google/callback", async (req, res) => {
  try {
    const { code, account } = req.query;
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }

    const { exchangeCode } = await import("../services/google-auth.js");
    const tokens = await exchangeCode(code);
    const accountName = (account as string) || "default";
    storedTokens[accountName] = tokens;

    res.json({
      success: true,
      account: accountName,
      message: `Google account "${accountName}" authorized successfully`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── Email Processing ──

/**
 * POST /api/sources/emails/process
 *
 * Trigger email processing for a specific account.
 * Body: { account: "gil" | "jerry", afterDate?: "2024-01-01", tokens?: {...} }
 *
 * If tokens are not provided, uses stored tokens from OAuth flow.
 */
router.post("/emails/process", async (req, res) => {
  try {
    const { account, afterDate, tokens: bodyTokens } = req.body;

    if (!account) {
      res.status(400).json({ error: "account is required (e.g., 'gil' or 'jerry')" });
      return;
    }

    const tokens = bodyTokens || storedTokens[account];
    if (!tokens) {
      res.status(401).json({
        error: `No OAuth tokens for account "${account}". Visit /api/sources/auth/google/url to authorize.`,
        authUrl: getAuthUrl(),
      });
      return;
    }

    const since = afterDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    console.log(`[Sources] Processing emails for ${account} since ${since}`);
    const result = await processEmails(tokens, account, since);

    res.json({
      account,
      since,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── Gino Badge Processing ──

/**
 * POST /api/sources/gino/process
 *
 * Trigger Gino badge scan processing.
 * Body: { baseUrl?: "https://gino-app.replit.app" }
 */
router.post("/gino/process", async (req, res) => {
  try {
    const { baseUrl } = req.body;

    if (!baseUrl) {
      res.status(400).json({
        error: "baseUrl is required (e.g., 'https://gino-lead-capture.replit.app')",
      });
      return;
    }

    console.log(`[Sources] Processing Gino badges from ${baseUrl}`);
    const result = await processGinoBadges(baseUrl);

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── Router Testing ──

/**
 * POST /api/sources/route-test
 *
 * Test the deterministic router with any input.
 * Body: { title: "...", sourceType?: "fathom" | "email", senderDomain?: "..." }
 */
router.post("/route-test", async (req, res) => {
  try {
    const { title, sourceType, senderDomain } = req.body;
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const routing = sourceType === "email"
      ? routeEmail(title, senderDomain || null)
      : routeTranscript(title);

    res.json({ routing });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── Index Stats ──

router.get("/index/stats", (_req, res) => {
  const stats = getIndexStats();
  res.json(stats);
});

router.post("/index/rebuild", (_req, res) => {
  const stats = rebuildIndex();
  res.json({ rebuilt: true, ...stats });
});

// ── Status ──

router.get("/status", (_req, res) => {
  const hasGil = !!storedTokens["gil"];
  const hasJerry = !!storedTokens["jerry"];
  const indexStats = getIndexStats();

  res.json({
    dataSources: {
      fathom: { status: "active", description: "Fathom transcript polling" },
      email: {
        status: hasGil || hasJerry ? "ready" : "needs_auth",
        accounts: {
          gil: hasGil ? "authorized" : "needs_auth",
          jerry: hasJerry ? "authorized" : "needs_auth",
        },
        authUrl: !hasGil || !hasJerry ? getAuthUrl() : null,
      },
      gino: { status: "ready", description: "Gino badge scan processing" },
      calendar: {
        status: hasGil || hasJerry ? "ready" : "needs_auth",
        description: "Calendar event enrichment (uses same auth as email)",
      },
    },
    index: indexStats,
  });
});

export default router;
