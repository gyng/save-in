// On-demand live suite. NOT part of `npm test` / CI — it makes real outbound
// requests to i.pximg.net to prove the premise the whole Referer feature rests
// on (gyng/save-in#66): pixiv's CDN serves an image only when the request
// carries a pixiv Referer, and refuses it otherwise.
//
// The synthetic proofs cannot catch this. test/downloads/referer-rules.test.ts
// asserts rule shape against a literal i.pximg.net string, and the Chrome e2e
// ("Referer-protected downloads use a scoped DNR offscreen fetch") mimics the
// hotlink rule with a loopback server. Both keep passing if pixiv changes its
// gate — for example by requiring cookies or a different Referer — which is
// exactly how #66 was repeatedly declared fixed while users still saw 403s.
//
// This test pins the real server behavior to the extension's own decision:
// the Referer it asserts is the one getReferer() derives from the shipped
// defaults, not a hand-written string. Run with `npm run test:live`.

import { expect, test } from "vitest";
import { defaultOptions } from "../../src/config/option-defaults.ts";
import { options, replaceOptions } from "../../src/config/options-data.ts";
import { getReferer } from "../../src/downloads/headers.ts";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// Artwork URLs embed an upload date and can be deleted, so resolve a currently
// served sample from the public daily ranking instead of baking one in.
// LIVE_PIXIV_URL/LIVE_PIXIV_PAGE_URL override if the ranking endpoint changes.
const resolveSample = async (): Promise<{ url: string; pageUrl: string }> => {
  const url = process.env.LIVE_PIXIV_URL;
  const pageUrl = process.env.LIVE_PIXIV_PAGE_URL;
  if (url && pageUrl) return { url, pageUrl };

  const response = await fetch("https://www.pixiv.net/ranking.php?mode=daily&format=json", {
    headers: { "User-Agent": UA },
  });
  expect(response.status, "pixiv daily ranking endpoint").toBe(200);
  const body: unknown = await response.json();
  const contents = (body as { contents?: unknown }).contents;
  const first = Array.isArray(contents) ? (contents[0] as unknown) : undefined;
  const entry = first as { url?: unknown; illust_id?: unknown } | undefined;
  if (typeof entry?.url !== "string" || typeof entry.illust_id !== "number") {
    throw new Error(`Unexpected pixiv ranking shape: ${JSON.stringify(first).slice(0, 200)}`);
  }
  return { url: entry.url, pageUrl: `https://www.pixiv.net/artworks/${entry.illust_id}` };
};

test("pixiv still gates i.pximg.net on the Referer the shipped defaults produce", async () => {
  const { url, pageUrl } = await resolveSample();
  expect(url).toMatch(/^https:\/\/i\.pximg\.net\//);

  // Shipped defaults plus the single switch a user must flip. The default
  // setRefererHeaderFilter already covers *://i.pximg.net/*, so no filter edit.
  replaceOptions({ ...defaultOptions(), setRefererHeader: true });
  expect(options.setRefererHeaderFilter).toContain("*://i.pximg.net/*");

  const referer = getReferer({ info: { url, pageUrl } });
  expect(referer, "extension must decide to send a Referer for a pixiv image").toBe(pageUrl);

  const withoutReferer = await fetch(url, { headers: { "User-Agent": UA } });
  const withReferer = await fetch(url, { headers: { "User-Agent": UA, Referer: referer } });
  // Read bodies so the sockets are released even though only status matters.
  await Promise.all([withoutReferer.arrayBuffer(), withReferer.arrayBuffer()]);

  // If this first assertion fails, pixiv no longer hotlink-blocks and the
  // feature is unnecessary. If the second fails, a Referer is no longer
  // sufficient (cookies? IP reputation?) and #66 needs a new approach —
  // do not "fix" it by relaxing this test.
  expect(withoutReferer.status, `${url} should be refused without a Referer`).toBe(403);
  expect(withReferer.status, `${url} should be served with Referer ${referer}`).toBe(200);
  expect(withReferer.headers.get("content-type")).toMatch(/^image\//);
});
