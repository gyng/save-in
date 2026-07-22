// The CHECK_ROUTES response payload. It lives in shared/ rather than beside
// previewRoutes in background/route-preview.ts because it crosses the wire: the
// options page reads it, and shared/ owns the contracts both sides agree on.
// RoutePreviewState stays in background/ — it is previewRoutes' own argument
// and never travels.
export type RoutePreview = {
  path: string | null;
  captures: (string | undefined)[] | null;
  outcome?: "route" | "exclude" | null | undefined;
  tabAction?: "close" | null | undefined;
};
