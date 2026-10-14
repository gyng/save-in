// The page visit this content script speaks for when it adopts media the
// webRequest collector observed (see ScriptMediaVisit in
// automation/automatic-routing.ts). The collector's buffer belongs to the tab,
// not to a document: the previous page keeps issuing requests until this one
// commits, and a page restored from the back/forward cache finds the buffer
// holding whatever the page it returned from loaded.
export type PageVisit = {
  // Wall-clock epoch ms at which the current visit began.
  start(): number;
  // Between pagehide and pageshow the page is not the one being viewed, so a
  // push that reaches it belongs to no visit of it.
  hidden(): boolean;
};

type VisitWindow = Pick<Window, "addEventListener" | "performance">;

// The response start, not timeOrigin (the navigation start): the previous page
// is still alive and requesting until this document's response arrives, while
// this document cannot issue a request before then. Measured on Chrome 155 and
// Firefox 158 with a 1.2 s response: the previous page's poll landed 1.2 s
// after this page's timeOrigin and within milliseconds before its response
// start. The collector stamps requests with the browser's wall clock; the
// elapsed time from performance.now() is exact, so "now minus the time since
// the response started" lands on that clock, where timeOrigin is a monotonic
// origin mapped to it once and drifts with clock adjustments.
export const navigationVisitStart = (win: Pick<Window, "performance">): number => {
  const { performance } = win;
  const [navigation] = performance.getEntriesByType("navigation");
  const responseStart: unknown = navigation ? Reflect.get(navigation, "responseStart") : undefined;
  const elapsedSinceVisit =
    performance.now() -
    (typeof responseStart === "number" && Number.isFinite(responseStart) && responseStart > 0
      ? responseStart
      : 0);
  return Date.now() - elapsedSinceVisit;
};

// A back/forward-cache restore sends no navigation request, so the collector
// never resets the tab's buffer for it; the restore itself starts the visit.
export const trackPageVisit = (win: VisitWindow): PageVisit => {
  let start = navigationVisitStart(win);
  let hidden = false;
  win.addEventListener("pagehide", () => {
    hidden = true;
  });
  win.addEventListener("pageshow", (event) => {
    hidden = false;
    if (event.persisted) start = Date.now();
  });
  return { start: () => start, hidden: () => hidden };
};
