// Minimal downloads-only probe. It deliberately registers no
// downloads.onDeterminingFilename listener, so the browser honours the exact
// filename passed to downloads.download. It answers the Firefox launcher's
// readiness ping (WAKE_WARM -> OK) so scripts/lib/firefox.js accepts it in
// place of the full Save In build.
if (typeof globalThis.browser === "undefined") globalThis.browser = globalThis.chrome;
browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === "WAKE_WARM") return Promise.resolve({ type: "OK" });
  return undefined;
});
