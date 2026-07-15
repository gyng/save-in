// The Referer DNR rule matches exact URLs, but a redirect target only becomes
// known after fetch has already followed it — so a redirected hop can arrive
// unprotected and fail (#193). Callers retry through this bounded loop once the
// active rule also covers the URL the server chose.
export type RefererProtection = {
  // Adds a server-provided redirect target to the active Referer rule.
  // Resolves false (never throws) when the URL is already covered, not
  // HTTP(S), over budget, oversized, or the rule update was rejected.
  extend(url: string): Promise<boolean>;
};

export const MAX_PROTECTED_URL_EXTENSIONS = 3;

export const fetchProtected = async (
  doFetch: () => Promise<Response>,
  protection?: RefererProtection,
): Promise<Response> => {
  let response = await doFetch();
  if (!protection) return response;
  for (let extension = 0; extension < MAX_PROTECTED_URL_EXTENSIONS; extension += 1) {
    if (response.ok || !response.url) return response;
    if (!(await protection.extend(response.url))) return response;
    // The abandoned failure body must not keep its connection alive.
    if (response.body) await response.body.cancel().catch(() => {});
    response = await doFetch();
  }
  return response;
};
