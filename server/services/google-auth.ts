import { google } from "googleapis";

let _oauth2Client: any = null;

export function getOAuth2Client() {
  if (!_oauth2Client) {
    _oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "http://localhost:3001/api/auth/google/callback"
    );
  }
  return _oauth2Client;
}

/**
 * Generate the URL the user needs to visit to authorize Gmail access.
 */
export function getAuthUrl(): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
  });
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCode(code: string) {
  const { tokens } = await getOAuth2Client().getToken(code);
  getOAuth2Client().setCredentials(tokens);
  return tokens;
}

/**
 * Set stored tokens on the client.
 */
export function setTokens(tokens: any) {
  getOAuth2Client().setCredentials(tokens);
}
