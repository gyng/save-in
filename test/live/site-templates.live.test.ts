// On-demand live suite. NOT part of `npm test` / CI — it makes real outbound
// requests to third-party CDNs to prove the built-in "Site originals" rule
// templates still rewrite a real, currently-served URL into a real,
// higher-resolution asset. Site CDNs change their URL schemes without notice,
// which the synthetic proof suite (test/routing/core-matcher-regressions) can
// never catch. Run with `npm run test:live`.
//
// Every deterministic rewrite has a baked public sample and an environment
// override for replacing it if the third-party asset eventually disappears.
// Missing coverage is a failure rather than a silent skip.

import { describe, expect, test } from "vitest";
import { RULE_TEMPLATES } from "../../src/options/rule-editor/rule-templates.ts";
import { matchRulesDetailed, parseRulesCollecting } from "../../src/routing/router.ts";

type LiveSample = {
  // A real, currently-served source URL that matches the template's matcher.
  before: string;
  // Assert the rewrite target is no smaller than the source preview. Off for
  // sites where a smaller-byte original is expected (Pixiv's re-encoded
  // master1200 can outweigh a sub-1200px original even though the original is
  // full resolution).
  checkSize?: boolean;
  // Compare decoded JPEG dimensions as well as bytes. This matters for CDNs
  // such as ArtStation, where the same-size 4k rendition may use fewer bytes
  // than `large` because it is encoded differently.
  checkDimensions?: boolean;
};

// Keyed by template.name for the "Site originals" category.
const SAMPLES: Record<string, LiveSample> = {
  "Twitter/X largest image": {
    // Long-lived public media sample whose small and orig renditions remain
    // independently addressable without an X account.
    before:
      process.env.LIVE_TWITTER_URL ??
      "https://pbs.twimg.com/media/DfX6HKNXkAA5lkm?format=jpg&name=small",
  },
  "Reddit image originals": {
    // Current Reddit uploads require the signed preview query to be retained
    // when switching to i.redd.it; dropping it returns 403 for this sample.
    before:
      process.env.LIVE_REDDIT_URL ??
      "https://preview.redd.it/west-virginias-missing-panhandle-v0-l4ywewdjzhzc1.png?width=1080&crop=smart&auto=webp&s=d2bf64a7cbdbba0b0743001db259063f05da30b8",
  },
  "Wikimedia full-size image": {
    // "Example.jpg" is a permanent Wikimedia Commons file.
    before:
      process.env.LIVE_WIKIMEDIA_URL ??
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/250px-Example.jpg",
  },
  "YouTube thumbnail max resolution": {
    // A long-lived public video; maxresdefault exists for it.
    before: process.env.LIVE_YOUTUBE_URL ?? "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  "Bluesky full-size image": {
    // Public sample used in Bluesky API examples. The fullsize endpoint is an
    // official App View rendition and may not be the exact uploaded blob.
    before:
      process.env.LIVE_BLUESKY_URL ??
      "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:xbtmt2zjwlrfegqvch7fboei/bafkreiae4rcokecag5qlpvg6l3otzulqn3hllnazmz2ezyqfl6xzpy5noe@jpeg",
    checkDimensions: true,
  },
  "ArtStation highest available image": {
    // Public portfolio asset: the large rendition is 1920x1080 and the 4k
    // endpoint is 3840x2160. ArtStation may return the same dimensions for
    // uploads that are already below its larger tier.
    before:
      process.env.LIVE_ARTSTATION_URL ??
      "https://cdnb.artstation.com/p/assets/images/images/064/942/263/large/sketchy-pigeon-lorenz-beernaert-bccfinalpsd.jpg",
    checkSize: false,
    checkDimensions: true,
  },
  "Mastodon full-size JPEG image": {
    // Public attachment on mastodon.sdf.org. This exercises the self-hosted
    // /system prefix; object-storage hosts use the same small/original pair.
    before:
      process.env.LIVE_MASTODON_URL ??
      "https://mastodon.sdf.org/system/media_attachments/files/112/491/034/261/391/490/small/ea9b9dc3b3c9a611.jpeg",
    checkDimensions: true,
  },
  "Google original-size image": {
    // A YouTube channel avatar on yt3.googleusercontent.com; =s0 returns the
    // original. Channels rarely change avatars, but a token rotation just
    // needs a fresh URL via the env var.
    before:
      process.env.LIVE_GOOGLEUSERCONTENT_URL ??
      "https://yt3.googleusercontent.com/eIf5fNPcIcj9ig-wZBeq4stFy1lgjWTW1nLT5dYlFkHZprZ03QBiMcbpwNMB6XSBjrSFGtAGQg=s900-c-k-c0x00ffffff-no-rj",
  },
  "Flickr larger image": {
    // A photo on Flickr's own account (id 55392836202); _z -> _b is the 1024px
    // rendition, always available and always JPEG.
    before:
      process.env.LIVE_FLICKR_URL ??
      "https://live.staticflickr.com/65535/55392836202_97bdf7986a_z.jpg",
  },
};

const FETCH_TIMEOUT_MS = 15_000;

type Probe = {
  ok: boolean;
  status: number;
  contentType: string;
  bytes: number;
  width?: number;
  height?: number;
};

const jpegDimensions = (body: ArrayBuffer): { width: number; height: number } | undefined => {
  const bytes = new Uint8Array(body);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(body);
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return undefined;
    if (startOfFrame.has(marker)) {
      return { height: view.getUint16(offset + 4), width: view.getUint16(offset + 6) };
    }
    const length = view.getUint16(offset + 1);
    if (length < 2) return undefined;
    offset += length + 1;
  }
  return undefined;
};

const probe = async (url: string): Promise<Probe> => {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "save-in-live-template-test/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await response.arrayBuffer();
  const dimensions = jpegDimensions(body);
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    bytes: body.byteLength,
    ...dimensions,
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

// This suite probes deterministic fetch: rewrites. The Google Images details
// template selects a publisher URL that is already present in the page and has
// no rewritten endpoint to probe.
const siteOriginals = RULE_TEMPLATES.filter(
  (template) => template.category === "Site originals" && template.proof.fetch !== undefined,
);
describe("Site originals — live CDN rewrites", () => {
  test.each(siteOriginals)(
    "$name rewrites to a live higher-res asset",
    async (template) => {
      const sample = SAMPLES[template.name];
      expect(sample, `missing live sample for ${template.name}`).toBeDefined();
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
      if (beforeProbe?.ok && sample?.checkDimensions) {
        expect(beforeProbe.width, `source ${before} JPEG width`).toBeTypeOf("number");
        expect(beforeProbe.height, `source ${before} JPEG height`).toBeTypeOf("number");
        expect(afterProbe.width, `rewritten ${after} JPEG width`).toBeGreaterThanOrEqual(
          beforeProbe.width ?? Infinity,
        );
        expect(afterProbe.height, `rewritten ${after} JPEG height`).toBeGreaterThanOrEqual(
          beforeProbe.height ?? Infinity,
        );
      }

      // Visible evidence in the run log (this suite's whole point is the
      // real network result, so the log is deliberate).
      // eslint-disable-next-line no-console
      console.log(
        `[live] ${template.name}\n        ${before} (${beforeProbe?.bytes ?? "?"}B, ${beforeProbe?.width ?? "?"}x${beforeProbe?.height ?? "?"})\n     -> ${after} (${afterProbe.bytes}B, ${afterProbe.width ?? "?"}x${afterProbe.height ?? "?"}, ${afterProbe.contentType})`,
      );
    },
    30_000,
  );
});
