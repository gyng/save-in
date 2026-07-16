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
};

const FETCH_TIMEOUT_MS = 15_000;

type Probe = { ok: boolean; status: number; contentType: string; bytes: number };

const probe = async (url: string): Promise<Probe> => {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "save-in-live-template-test/1.0" },
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
      if (beforeProbe?.ok) {
        expect(
          afterProbe.bytes,
          `rewritten (${afterProbe.bytes}B) should be >= source (${beforeProbe.bytes}B)`,
        ).toBeGreaterThanOrEqual(beforeProbe.bytes);
      }

      // Visible evidence in the run log.
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
