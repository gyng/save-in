// @ts-check
// Automatic script-media saves must stay with the page visit that requested
// the media, although the collector's buffer belongs to the tab. Two browser-
// owned lifecycles break the naive "reset on navigation" boundary:
// - the previous document keeps running, and requesting, between the next
//   navigation's request (which resets the buffer) and that page's commit;
// - a back/forward-cache restore sends no navigation request, so the buffer
//   still holds the page the user went back from, and the restored page's own
//   stream evidence went with the reset its departure made.
// The server below orders every step by the requests it receives, so the
// scenario needs no timers.
import { expect } from "vitest";

/**
 * @typedef {import("node:http").IncomingMessage} Request
 * @typedef {import("node:http").ServerResponse} Response
 */

const PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n";

// Page A parks a request the server answers only once page B's navigation
// request arrives; A then requests its playlist while B's response is held, so
// that request is made by A after the navigation began. B's response is
// released only once A's request has been seen. Firefox cancels the parked
// request when the navigation starts, possibly before B's request reaches the
// server, so A parks again until it does.
const PAGE_A = `<!doctype html><title>Visit A</title><script>
const park = () => fetch("/visit-a-hold").then(() => fetch("/visit-a-live.m3u8"), park);
park();
</script>`;
// Loads a URL through a media element the page scan cannot see, as a natively
// played stream loads its segments; resolves once the element has given up,
// which is after its request was made.
const LOAD_DETACHED_MEDIA = `const loadDetachedMedia = (src) => new Promise((resolve) => {
  const video = document.createElement("video");
  window.__media = [...(window.__media ?? []), video];
  video.preload = "auto";
  video.addEventListener("error", () => resolve(true), { once: true });
  video.src = src;
});`;
// Page B records whether it came back from the back/forward cache. Its media
// element names no media type, so the collector reads the page as playing a
// stream (a natively played HLS playlist without an extension looks the same).
// The server refuses it, so the element does not ask again on a restore.
const PAGE_B = `<!doctype html><title>Visit B</title><script>
${LOAD_DETACHED_MEDIA}
window.__streamRequested = loadDetachedMedia("/visit-b-stream");
window.__restored = sessionStorage.getItem("visit-b-left")
  ? Promise.resolve(false)
  : new Promise((resolve) => addEventListener("pageshow", (event) => {
      if (event.persisted) resolve(true);
    }));
addEventListener("pagehide", () => sessionStorage.setItem("visit-b-left", "1"));
fetch("/visit-b-own.m3u8");
</script>`;
// Page C's whole file is an image, not a playlist, so page C leaves no stream
// evidence in the buffer the restored page B finds.
const PAGE_C = `<!doctype html><title>Visit C</title><script>
fetch("/visit-c-own.jpg");
</script>`;

export const createScriptMediaVisitRoutes = () => {
  /** @type {Response | null} */
  let heldA = null;
  /** @type {Response | null} */
  let heldB = null;
  let aRequested = false;
  let bRequested = false;
  /** @type {() => void} */
  let markHoldArrived = () => {};
  const holdArrived = new Promise((resolve) => {
    markHoldArrived = () => resolve(undefined);
  });
  /** @type {() => void} */
  let markCRequested = () => {};
  // The browser hands a request to webRequest listeners before sending it, and
  // the collector reads a tab's buffer only behind that tab's queued events.
  const cRequested = new Promise((resolve) => {
    markCRequested = () => resolve(undefined);
  });
  /** @param {Response} res @param {string} body */
  const html = (res, body) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
  };
  /** @param {Response} res */
  const playlist = (res) => {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
    res.end(PLAYLIST);
  };
  /** @param {Request} req @param {Response} res @returns {boolean} */
  const handle = (req, res) => {
    const url = req.url ?? "";
    if (url === "/visit-a") html(res, PAGE_A);
    else if (url === "/visit-a-hold") {
      if (bRequested) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("go");
      } else heldA = res;
      markHoldArrived();
    } else if (url === "/visit-b") {
      bRequested = true;
      if (aRequested) {
        html(res, PAGE_B);
      } else {
        heldB = res;
        heldA?.writeHead(200, { "Content-Type": "text/plain" });
        heldA?.end("go");
        heldA = null;
      }
    } else if (url === "/visit-a-live.m3u8") {
      aRequested = true;
      playlist(res);
      if (heldB) html(heldB, PAGE_B);
      heldB = null;
    } else if (url === "/visit-b-stream") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("gone");
    } else if (url === "/visit-b-seg_00042.mp4") {
      // Not decodable, so the element errors once the response is in.
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end("segment");
    } else if (url === "/visit-c") html(res, PAGE_C);
    else if (url === "/visit-c-own.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end("image");
      markCRequested();
    } else if (url.startsWith("/visit-") && url.endsWith(".m3u8")) playlist(res);
    else return false;
    return true;
  };
  return { handle, holdArrived, cRequested };
};

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   routes: ReturnType<typeof createScriptMediaVisitRoutes>,
 *   tabId: number,
 *   origin: string,
 *   folder: string,
 *   evalPage: (path: string, expression: string) => Promise<unknown>,
 *   restoredStreamSegment?: boolean,
 * }} context
 */
export const runScriptMediaVisitScenario = async ({
  control,
  routes,
  tabId,
  origin,
  folder,
  evalPage,
  restoredStreamSegment = false,
}) => {
  const filenames = async (minimumComplete = 1) =>
    (
      await control.downloads.wait({
        filenameRegex: folder,
        minimumComplete,
        timeoutMs: 10000,
      })
    )
      .map((row) => row.filename.split(/[\\/]/).at(-1))
      .toSorted();
  const host = origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
  await control.options.set({
    // Page B's rule also matches the other pages' media, so only the visit
    // boundary keeps them out, and it matches the restored page's segment, so
    // only the remembered stream evidence keeps that out.
    filenamePatterns: `context: ^auto$
pageurl: /visit-b$
sourcekind: ^(stream|image|video)$
sourceurl: /visit-
into: ${folder}/:filename:`,
  });

  await control.tabs.update(tabId, { url: `${origin}/visit-a` });
  await routes.holdArrived;
  await control.tabs.update(tabId, { url: `${origin}/visit-b` });
  await control.tabs.wait({ id: tabId, urlIncludes: "/visit-b" });
  // Page A's playlist reached the collector after page B's navigation began
  // and before B's own request; had it been adopted, the replay would have
  // queued it first.
  expect(await filenames()).toEqual(["visit-b-own.m3u8"]);

  // Page B's stream evidence must reach the collector before page C's
  // navigation request resets the buffer.
  expect(await evalPage(`${host}/visit-b`, "window.__streamRequested")).toBe(true);
  await evalPage(`${host}/visit-b`, `(location.href = "/visit-c", true)`);
  await control.tabs.wait({ id: tabId, urlIncludes: "/visit-c" });
  await routes.cRequested;
  await evalPage(`${host}/visit-c`, `(history.back(), true)`);
  await control.tabs.wait({ id: tabId, urlIncludes: "/visit-b" });
  expect(await evalPage(`${host}/visit-b`, "window.__restored")).toBe(true);

  // The restored page B finds page C's image in the buffer. Opening Page
  // Sources pushes the buffer to it, and an automatic option change remounts
  // discovery, which asks for a replay. (The remount also matters on Firefox,
  // which never answers a message B had in flight when it entered the cache.)
  await control.tabs.sendMessage(tabId, { type: "SET_SOURCE_PANEL", body: { open: false } });
  await control.tabs.sendMessage(tabId, { type: "SET_SOURCE_PANEL", body: { open: true } });
  await control.background.applyConfig({ autoDownloadMaxPerPage: 6 });
  // B's own request after the restore is saved. It reaches the page through
  // the collector's debounced push, behind the panel replay and the remount's
  // replay, so a wrongly adopted image from page C would be among the rows.
  // Where the browser attributes requests to documents (Chrome), the restored
  // page first loads a segment of the stream it showed before it was cached.
  // Its media element errors only once the request was made, so a wrongly
  // adopted segment would be queued ahead of the playlist.
  await evalPage(
    `${host}/visit-b`,
    `${restoredStreamSegment ? 'loadDetachedMedia("/visit-b-seg_00042.mp4")' : "Promise.resolve()"}
      .then(() => fetch("/visit-b-after.m3u8")).then(() => true)`,
  );
  expect(await filenames(2)).toEqual(["visit-b-after.m3u8", "visit-b-own.m3u8"]);
};
