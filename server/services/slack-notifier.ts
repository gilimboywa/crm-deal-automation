import { WebClient } from "@slack/web-api";
import type { Deal } from "../../db/schema.js";
import type { MatchResult } from "../lib/types.js";
import { DEAL_STAGE_DISPLAY } from "../lib/constants.js";

let _slack: WebClient | null = null;

function getSlack(): WebClient {
  if (!_slack) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
    _slack = new WebClient(token);
  }
  return _slack;
}

function getChannelId(): string {
  return process.env.SLACK_CHANNEL_ID || "";
}

/**
 * Format a currency amount for display.
 */
function formatAmount(amount: number | null): string {
  if (amount === null) return "TBD";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(0)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

/**
 * Notify Slack channel about a deal that needs review.
 */
export async function notifyDealReview(
  deal: Deal,
  matchResult: MatchResult
): Promise<void> {
  const stageLabel = DEAL_STAGE_DISPLAY[deal.dealStage] || deal.dealStage;
  const matchEmoji =
    matchResult.result === "new"
      ? ":new:"
      : matchResult.result === "update"
        ? ":arrows_counterclockwise:"
        : ":question:";

  try {
    await getSlack().chat.postMessage({
      channel: getChannelId(),
      text: `New deal for review: ${deal.companyName}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `Deal Review: ${deal.companyName}`,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Amount:*\n${formatAmount(deal.amount)}`,
            },
            {
              type: "mrkdwn",
              text: `*Stage:*\n${stageLabel}`,
            },
            {
              type: "mrkdwn",
              text: `*ICP:*\n${deal.icp || "Unclassified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Deal Type:*\n${deal.dealType || "TBD"}`,
            },
            {
              type: "mrkdwn",
              text: `*Source:*\n${deal.primaryDealSource || "Unknown"}`,
            },
            {
              type: "mrkdwn",
              text: `*Owner:*\n${deal.dealOwner || "Unassigned"}`,
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Match Result:* ${matchEmoji} *${matchResult.result.toUpperCase()}* (confidence: ${(matchResult.confidence * 100).toFixed(0)}%)\n${matchResult.reason}`,
          },
        },
        ...(deal.dealDescription
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Description:*\n${deal.dealDescription}`,
                },
              },
            ]
          : []),
        {
          type: "divider",
        },
        {
          type: "actions",
          block_id: `deal_review_${deal.id}`,
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Go Live",
              },
              style: "primary",
              action_id: "go_live",
              value: String(deal.id),
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Review",
              },
              action_id: "review",
              value: String(deal.id),
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Inconclusive",
              },
              style: "danger",
              action_id: "inconclusive",
              value: String(deal.id),
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Failed to send Slack deal review notification:", error);
  }
}

/**
 * Notify Slack channel that a deal has been synced to HubSpot.
 */
export async function notifyDealSynced(deal: Deal): Promise<void> {
  const stageLabel = DEAL_STAGE_DISPLAY[deal.dealStage] || deal.dealStage;

  try {
    await getSlack().chat.postMessage({
      channel: getChannelId(),
      text: `Deal synced to HubSpot: ${deal.companyName}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:white_check_mark: *Deal synced to HubSpot*\n*${deal.companyName}* | ${formatAmount(deal.amount)} | ${stageLabel}`,
          },
        },
        ...(deal.hubspotDealId
          ? [
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `HubSpot Deal ID: ${deal.hubspotDealId}`,
                  },
                ],
              },
            ]
          : []),
      ],
    });
  } catch (error) {
    console.error("Failed to send Slack sync notification:", error);
  }
}
