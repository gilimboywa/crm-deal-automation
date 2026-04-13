const FATHOM_BASE_URL = "https://api.fathom.ai/external/v1";

function getApiKey(): string {
  const key = process.env.FATHOM_API_KEY;
  if (!key) throw new Error("FATHOM_API_KEY is not set");
  return key;
}

async function fathomFetch(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${FATHOM_BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "X-Api-Key": getApiKey() },
  });

  if (!res.ok) {
    throw new Error(`Fathom API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export interface FathomMeeting {
  title: string;
  meeting_title: string;
  url: string;
  created_at: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  recording_id: number;
  recording_start_time: string;
  recording_end_time: string;
  transcript: Array<{
    speaker: {
      display_name: string;
      matched_calendar_invitee_email?: string;
    };
    text: string;
    timestamp: string;
  }>;
}

/**
 * Get ALL meetings after a date, paginating through all results.
 */
export async function getMeetingsAfter(afterDate: string): Promise<FathomMeeting[]> {
  const allMeetings: FathomMeeting[] = [];
  let cursor: string | null = null;

  do {
    const params: Record<string, string> = {
      include_transcript: "true",
      created_after: afterDate,
    };
    if (cursor) {
      params.cursor = cursor;
    }

    const data = await fathomFetch("/meetings", params);
    const items = data.items || [];
    allMeetings.push(...items);

    cursor = data.next_cursor || null;
    console.log(`[Fathom] Fetched ${items.length} meetings (total: ${allMeetings.length}, cursor: ${cursor ? 'yes' : 'done'})`);
  } while (cursor);

  return allMeetings;
}
