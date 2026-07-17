import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";

import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
  SCREENSHOTS,
  assertPngDimensions,
  optimizePngLosslessly,
} = require("../../scripts/lib/store-screenshots.js") as {
  SCREENSHOT_HEIGHT: number;
  SCREENSHOT_WIDTH: number;
  SCREENSHOTS: Array<{ filename: string; description: string }>;
  assertPngDimensions: (png: Buffer, filename?: string) => void;
  optimizePngLosslessly: (png: Buffer) => { png: Buffer; savedBytes: number };
};

const pngHeader = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
};

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const inflatedImageData = (png: Buffer): Buffer => {
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return inflateSync(Buffer.concat(chunks));
};

describe("Chrome Web Store screenshot plan", () => {
  test("uses Google's preferred listing dimensions", () => {
    expect({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT }).toEqual({
      width: 1280,
      height: 800,
    });
  });

  test("defines stable listing-ready output names", () => {
    expect(SCREENSHOTS).toEqual([
      {
        filename: "01-downloads-menu.png",
        description: "Configured directories and the live menu preview",
      },
      {
        filename: "02-routing-rules.png",
        description: "Pattern-based routing and renaming rules",
      },
      {
        filename: "03-page-sources.png",
        description: "Page Sources open on a representative media page",
      },
      {
        filename: "04-browser-downloads.png",
        description: "Tracking and routing ordinary browser downloads with a match-pattern filter",
      },
      {
        filename: "05-history.png",
        description: "Searchable download history with routed results",
      },
    ]);
  });

  test("accepts only a PNG with the required dimensions", () => {
    expect(() => assertPngDimensions(pngHeader(1280, 800), "good.png")).not.toThrow();
    expect(() => assertPngDimensions(pngHeader(640, 400), "small.png")).toThrow(
      "small.png is 640x400; expected 1280x800",
    );
    expect(() => assertPngDimensions(Buffer.from("not a png"), "bad.png")).toThrow(
      "bad.png is not a PNG",
    );
  });

  test("losslessly recompresses image data without growing the PNG", () => {
    const originalImageData = inflatedImageData(tinyPng);
    const optimized = optimizePngLosslessly(tinyPng);

    expect(optimized.png.length).toBeLessThanOrEqual(tinyPng.length);
    expect(optimized.savedBytes).toBe(tinyPng.length - optimized.png.length);
    expect(inflatedImageData(optimized.png)).toEqual(originalImageData);
  });
});
