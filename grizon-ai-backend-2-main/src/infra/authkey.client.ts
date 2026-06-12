const AUTHKEY_REQUEST_URL = "https://api.authkey.io/request";

/** GET https://api.authkey.io/request — supports email (`mid`) or SMS (`sid`) templates per Authkey docs. */
export async function authkeyGetRequest(query: Record<string, string>): Promise<Response> {
  const url = new URL(AUTHKEY_REQUEST_URL);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
  });
}
