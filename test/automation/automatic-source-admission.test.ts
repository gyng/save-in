import {
  isAdmittedAutomaticSource,
  type AutomaticScanGates,
} from "../../src/automation/automatic-routing.ts";
import type { PageSourceChannel } from "../../src/shared/page-source.ts";

const ALL_OFF: AutomaticScanGates = {
  includeLinks: false,
  includeDocuments: false,
  includeBackgrounds: false,
  resourceHints: false,
  includeDataUrls: false,
};
const ALL_ON: AutomaticScanGates = {
  includeLinks: true,
  includeDocuments: true,
  includeBackgrounds: true,
  resourceHints: true,
  includeDataUrls: true,
};

// The exhaustive channel x kind x gate matrix lives in automatic-routing.test.ts.
// This suite pins the admission boundary itself: absence stays the only
// always-admitted shape, and a channel string outside the known vocabulary
// fails closed instead of riding the embedded-media branch.
describe("isAdmittedAutomaticSource channel boundary", () => {
  test("keeps channel absence and every known channel admitted as before", () => {
    expect(isAdmittedAutomaticSource("image", undefined, ALL_OFF)).toBe(true);
    expect(isAdmittedAutomaticSource("video", undefined, ALL_OFF)).toBe(true);
    expect(isAdmittedAutomaticSource("audio", undefined, ALL_OFF)).toBe(true);
    expect(isAdmittedAutomaticSource("image", "anchor", ALL_ON)).toBe(true);
    expect(isAdmittedAutomaticSource("document", "anchor", ALL_ON)).toBe(true);
    expect(isAdmittedAutomaticSource("link", "anchor", ALL_ON)).toBe(false);
    expect(isAdmittedAutomaticSource("image", "background", ALL_ON)).toBe(true);
    expect(isAdmittedAutomaticSource("stream", "resource-hint", ALL_ON)).toBe(true);
  });

  test("fails closed for a channel string this build does not know", () => {
    // The runtime value comes from a message payload, so a newer or tampered
    // content script can send any string; the cast models that boundary.
    const unknown = "portal" as PageSourceChannel;
    expect(isAdmittedAutomaticSource("image", unknown, ALL_ON)).toBe(false);
    expect(isAdmittedAutomaticSource("video", unknown, ALL_ON)).toBe(false);
    expect(isAdmittedAutomaticSource("audio", unknown, ALL_ON)).toBe(false);
    expect(isAdmittedAutomaticSource("stream", unknown, ALL_ON)).toBe(false);
  });
});
