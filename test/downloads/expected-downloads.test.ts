import { afterEach, expect, test } from "vitest";
import {
  allowUnroutedDownload,
  resetExpectedDownloads,
  settleUnroutedDownload,
  takeUnroutedDownload,
} from "../../src/downloads/expected-downloads";

afterEach(() => resetExpectedDownloads());

test("a prompt whose events both arrive before it resolves leaves no mark behind", () => {
  const unrouted = allowUnroutedDownload("https://example.com/a.jpg");
  expect(takeUnroutedDownload("created", 7, ["https://example.com/a.jpg"])).toBe(true);
  expect(takeUnroutedDownload("filename", 7, ["https://example.com/a.jpg"])).toBe(true);

  settleUnroutedDownload(unrouted, 7);

  expect(takeUnroutedDownload("created", 7, [])).toBe(false);
  expect(takeUnroutedDownload("filename", 7, ["https://example.com/a.jpg"])).toBe(false);
});
