/**
 * calendar-enricher.ts — Google Calendar enrichment for deal data.
 *
 * Pulls calendar event details (attendees, description, organizer)
 * and enriches Fathom transcript data with this information.
 *
 * Calendar data adds:
 * - Full attendee list with emails and companies
 * - Meeting description/agenda
 * - Organizer (who set up the meeting)
 * - Recurring meeting patterns (indicates ongoing relationship)
 *
 * This runs ALONGSIDE Fathom, not as a separate source.
 * When a Fathom transcript is being processed, we look up the
 * matching calendar event to pull attendee details.
 */

import { google } from "googleapis";
import { getOAuth2Client, setTokens } from "./google-auth.js";

export interface CalendarAttendee {
  email: string;
  displayName: string | null;
  organizer: boolean;
  responseStatus: string;  // "accepted" | "declined" | "tentative" | "needsAction"
  self: boolean;
}

export interface CalendarEventDetails {
  id: string;
  summary: string;          // event title
  description: string | null;  // meeting agenda/notes
  start: string;
  end: string;
  organizer: { email: string; displayName: string | null };
  attendees: CalendarAttendee[];
  recurringEventId: string | null;  // if part of a recurring series
  hangoutLink: string | null;
  location: string | null;
}

/**
 * Find a calendar event that matches a Fathom meeting.
 * Matches by:
 * 1. Time window (±15 minutes of scheduled start)
 * 2. Title similarity
 */
export async function findMatchingEvent(
  tokens: any,
  meetingTitle: string,
  scheduledStart: string,
  scheduledEnd: string
): Promise<CalendarEventDetails | null> {
  try {
    const client = getOAuth2Client();
    setTokens(tokens);

    const calendar = google.calendar({ version: "v3", auth: client });

    // Search in a ±30 minute window around the scheduled start
    const startDate = new Date(scheduledStart);
    const searchStart = new Date(startDate.getTime() - 30 * 60 * 1000);
    const searchEnd = new Date(startDate.getTime() + 30 * 60 * 1000);

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: searchStart.toISOString(),
      timeMax: searchEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = res.data.items || [];

    // Find best matching event by title
    const titleLower = meetingTitle.toLowerCase();
    let bestMatch: typeof events[0] | null = null;
    let bestScore = 0;

    for (const event of events) {
      const eventTitle = (event.summary || "").toLowerCase();

      // Exact title match
      if (eventTitle === titleLower) {
        bestMatch = event;
        bestScore = 1.0;
        break;
      }

      // Partial match — check if key words overlap
      const titleWords = new Set(titleLower.split(/[\s|/\-&]+/).filter((w) => w.length > 2));
      const eventWords = new Set(eventTitle.split(/[\s|/\-&]+/).filter((w) => w.length > 2));

      let overlap = 0;
      for (const word of titleWords) {
        if (eventWords.has(word)) overlap++;
      }

      const score = titleWords.size > 0 ? overlap / titleWords.size : 0;
      if (score > bestScore) {
        bestMatch = event;
        bestScore = score;
      }
    }

    if (!bestMatch || bestScore < 0.3) {
      console.log(`[Calendar] No matching event for "${meetingTitle}"`);
      return null;
    }

    // Extract details
    const attendees: CalendarAttendee[] = (bestMatch.attendees || []).map((a) => ({
      email: a.email || "",
      displayName: a.displayName || null,
      organizer: a.organizer || false,
      responseStatus: a.responseStatus || "needsAction",
      self: a.self || false,
    }));

    const details: CalendarEventDetails = {
      id: bestMatch.id || "",
      summary: bestMatch.summary || "",
      description: bestMatch.description || null,
      start: bestMatch.start?.dateTime || bestMatch.start?.date || "",
      end: bestMatch.end?.dateTime || bestMatch.end?.date || "",
      organizer: {
        email: bestMatch.organizer?.email || "",
        displayName: bestMatch.organizer?.displayName || null,
      },
      attendees,
      recurringEventId: bestMatch.recurringEventId || null,
      hangoutLink: bestMatch.hangoutLink || null,
      location: bestMatch.location || null,
    };

    console.log(`[Calendar] Found match: "${details.summary}" with ${attendees.length} attendees`);
    return details;
  } catch (error) {
    console.error(`[Calendar] Error looking up event for "${meetingTitle}":`, error);
    return null;
  }
}

/**
 * Extract external (non-Eisen) attendees from a calendar event.
 * These are potential contacts for deal association.
 */
export function getExternalAttendees(event: CalendarEventDetails): CalendarAttendee[] {
  return event.attendees.filter((a) => {
    const domain = a.email.split("@")[1] || "";
    return !domain.includes("eisen") && !domain.includes("witheisen") && !a.self;
  });
}

/**
 * Format calendar data as additional context for Claude processing.
 * This gets appended to the Fathom transcript data.
 */
export function formatCalendarContext(event: CalendarEventDetails): string {
  const lines: string[] = [
    `\n--- Calendar Event Details ---`,
    `Event: ${event.summary}`,
    `Time: ${event.start} to ${event.end}`,
  ];

  if (event.organizer.email) {
    lines.push(`Organizer: ${event.organizer.displayName || event.organizer.email} (${event.organizer.email})`);
  }

  if (event.description) {
    lines.push(`Description/Agenda: ${event.description}`);
  }

  if (event.location) {
    lines.push(`Location: ${event.location}`);
  }

  const external = getExternalAttendees(event);
  if (external.length > 0) {
    lines.push(`\nExternal Attendees:`);
    for (const a of external) {
      const name = a.displayName || "Unknown";
      const status = a.responseStatus;
      lines.push(`  - ${name} (${a.email}) [${status}]`);
    }
  }

  const internal = event.attendees.filter((a) => {
    const domain = a.email.split("@")[1] || "";
    return domain.includes("eisen") || domain.includes("witheisen");
  });
  if (internal.length > 0) {
    lines.push(`\nEisen Team:`);
    for (const a of internal) {
      lines.push(`  - ${a.displayName || a.email}`);
    }
  }

  if (event.recurringEventId) {
    lines.push(`\nThis is a recurring meeting (series ID: ${event.recurringEventId})`);
  }

  return lines.join("\n");
}
