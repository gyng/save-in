// On-demand live suite. NOT part of `npm test` / CI — it makes real outbound
// requests to third-party CDNs to prove the built-in "Site originals" rule
// templates still rewrite a real, currently-served URL into a real,
// higher-resolution asset. Site CDNs change their URL schemes without notice,
// which the synthetic proof suite (test/routing/core-matcher-regressions) can
// never catch. Run with `npm run test:live`.
//
// Wikimedia and YouTube expose permanent public sample assets, so those cases
// run unattended. Reddit's API is bot-blocked and Twitter/X media needs an
// account, so their sample URLs rot and cannot be baked in; feed a fresh one
// via the listed env var, otherwise the case skips (a missing sample is not a
// template regression).

import { describe, expect, test } from "vitest";
import { RULE_TEMPLATES } from "../../src/options/rule-editor/rule-templates.ts";
import { matchRulesDetailed, parseRulesCollecting } from "../../src/routing/router.ts";

type LiveSample = {
  // A real, currently-served source URL that matches the template's matcher.
  before: string | undefined;
  // Env var that overrides `before` with a fresh URL when the baked one rots
  // or none can be baked in.
  env: string;
  // Assert the rewrite target is no smaller than the source preview. Off for
  // sites where a smaller-byte original is expected (Pixiv's re-encoded
  // master1200 can outweigh a sub-1200px original even though the original is
  // full resolution).
  checkSize?: boolean;
};

// Pixiv serves i.pximg.net only when the request carries a pixiv.net Referer;
// otherwise every URL is 403 regardless of whether it exists. This mirrors
// Save In's default Referer filter (*://i.pximg.net/*, option-defaults.ts) and
// the feature the CDN forces (#66). Nothing else here is referer-gated.
const refererFor = (url: string): Record<string, string> => {
  try {
    return new URL(url).hostname.endsWith("pximg.net") ? { Referer: "https://www.pixiv.net/" } : {};
  } catch {
    return {};
  }
};

// Keyed by template.name for the "Site originals" category.
const SAMPLES: Record<string, LiveSample> = {
  "Twitter/X image originals": {
    // pbs.twimg.com serves media without auth, but the media id is per-post and
    // cannot be baked in. Supply one from any image tweet's "copy image
    // address", ending in ?format=<ext>&name=<size>.
    before: process.env.LIVE_TWITTER_URL,
    env: "LIVE_TWITTER_URL",
  },
  "Reddit image originals": {
    // i.redd.it is a public CDN, but the id is per-post. Supply a fresh
    // preview.redd.it/<id>.<ext>?... URL from any image post.
    before: process.env.LIVE_REDDIT_URL,
    env: "LIVE_REDDIT_URL",
  },
  "Wikimedia full-size image": {
    // "Example.jpg" is a permanent Wikimedia Commons file.
    before:
      process.env.LIVE_WIKIMEDIA_URL ??
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/250px-Example.jpg",
    env: "LIVE_WIKIMEDIA_URL",
  },
  "YouTube thumbnail max resolution": {
    // A long-lived public video; maxresdefault exists for it.
    before: process.env.LIVE_YOUTUBE_URL ?? "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    env: "LIVE_YOUTUBE_URL",
  },
  "Pixiv original-quality image": {
    // Illust 74391008_p0 — the exact image from issue #66's screencast, a
    // permanent Pixiv work (Pixiv keeps originals indefinitely). Both the
    // master preview and the rewritten original need the pixiv.net Referer
    // (see refererFor). Size check off: the sub-1200px original is smaller in
    // bytes than the re-encoded master1200 even though it is full resolution.
    before:
      process.env.LIVE_PIXIV_URL ??
      "https://i.pximg.net/img-master/img/2019/04/26/22/08/07/74391008_p0_master1200.jpg",
    env: "LIVE_PIXIV_URL",
    checkSize: false,
  },
  "Google original-size image": {
    // A YouTube channel avatar on yt3.googleusercontent.com; =s0 returns the
    // original. Channels rarely change avatars, but a token rotation just
    // needs a fresh URL via the env var.
    before:
      process.env.LIVE_GOOGLEUSERCONTENT_URL ??
      "https://yt3.googleusercontent.com/eIf5fNPcIcj9ig-wZBeq4stFy1lgjWTW1nLT5dYlFkHZprZ03QBiMcbpwNMB6XSBjrSFGtAGQg=s900-c-k-c0x00ffffff-no-rj",
    env: "LIVE_GOOGLEUSERCONTENT_URL",
  },
  "Flickr larger image": {
    // A photo on Flickr's own account (id 55392836202); _z -> _b is the 1024px
    // rendition, always available and always JPEG.
    before:
      process.env.LIVE_FLICKR_URL ??
      "https://live.staticflickr.com/65535/55392836202_97bdf7986a_z.jpg",
    env: "LIVE_FLICKR_URL",
  },
  "Tumblr high-resolution image": {
    // Tumblr serves only pre-generated renditions; this image exposes exactly
    // s2048x3072, so the rewrite is idempotent here and the case verifies the
    // target resolves live. Size check off (no smaller rendition to compare).
    before:
      process.env.LIVE_TUMBLR_URL ??
      "https://64.media.tumblr.com/16d61a423f0ea35748d8de1c8db30bee/26bb002b0950f666-8e/s2048x3072/2177496b02726f8a3da8975056fc1be0b62ec694.png",
    env: "LIVE_TUMBLR_URL",
    checkSize: false,
  },
};

const FETCH_TIMEOUT_MS = 15_000;

type Probe = { ok: boolean; status: number; contentType: string; bytes: number };

const probe = async (url: string): Promise<Probe> => {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "save-in-live-template-test/1.0", ...refererFor(url) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await response.arrayBuffer();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    bytes: body.byteLength,
  };
};

const rewriteUrl = (templateName: string, before: string): string => {
  const template = RULE_TEMPLATES.find((candidate) => candidate.name === templateName);
  if (!template) throw new Error(`Missing template: ${templateName}`);
  const parsed = parseRulesCollecting(template.rule);
  expect(parsed.errors).toEqual([]);
  const detail = matchRulesDetailed(parsed.rules, { sourceUrl: before, url: before });
  if (!detail || typeof detail.fetch !== "string") {
    throw new Error(`Template "${templateName}" did not produce a fetch rewrite for ${before}`);
  }
  return detail.fetch;
};

const siteOriginals = RULE_TEMPLATES.filter((template) => template.category === "Site originals");
const withSample = siteOriginals.filter((template) => Boolean(SAMPLES[template.name]?.before));
const withoutSample = siteOriginals
  .filter((template) => !SAMPLES[template.name]?.before)
  .map((template) => ({ name: template.name, env: SAMPLES[template.name]?.env ?? "?" }));

describe("Site originals — live CDN rewrites", () => {
  test.each(withSample)(
    "$name rewrites to a live higher-res asset",
    async (template) => {
      const sample = SAMPLES[template.name];
      // Presence guaranteed by the `withSample` partition above.
      const before = sample?.before ?? "";

      const after = rewriteUrl(template.name, before);
      const afterProbe = await probe(after);

      // The rewrite target must be live and an image.
      expect(afterProbe.ok, `rewritten URL ${after} returned HTTP ${afterProbe.status}`).toBe(true);
      expect(afterProbe.contentType, `rewritten URL ${after} content-type`).toMatch(/^image\//);
      expect(afterProbe.bytes).toBeGreaterThan(0);

      // Best-effort: when the "before" asset is also reachable, the rewrite
      // should not return something smaller (originals are >= the preview).
      let beforeProbe: Probe | undefined;
      try {
        beforeProbe = await probe(before);
      } catch {
        beforeProbe = undefined;
      }
      if (beforeProbe?.ok && sample?.checkSize !== false) {
        expect(
          afterProbe.bytes,
          `rewritten (${afterProbe.bytes}B) should be >= source (${beforeProbe.bytes}B)`,
        ).toBeGreaterThanOrEqual(beforeProbe.bytes);
      }

      // Visible evidence in the run log (this suite's whole point is the
      // real network result, so the log is deliberate).
      // eslint-disable-next-line no-console
      console.log(
        `[live] ${template.name}\n        ${before} (${beforeProbe?.bytes ?? "?"}B)\n     -> ${after} (${afterProbe.bytes}B, ${afterProbe.contentType})`,
      );
    },
    30_000,
  );

  // No bakeable sample (auth-walled / bot-blocked here) and none supplied via
  // env: report as skipped with the env var to set, never as a failure.
  test.skip.each(withoutSample)("$name — set env $env with a live source URL", () => {});
});
