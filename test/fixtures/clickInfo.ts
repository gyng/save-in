import type { RoutingInfo } from "../../src/routing/rule-types.ts";

const firefoxInfo = {
  sourceUrl: "https://pbs.twimg.com/media/EMNH-QAUwAEUmd_.jpg:large",
  filename: "EMNH-QAUwAEUmd_.jpg:large",
} satisfies RoutingInfo;

const chromeInfo = {
  sourceUrl: "https://pbs.twimg.com/media/Di6uEBuVsAEYVBw.jpg:orig",
  filename: "Di6uEBuVsAEYVBw.jpg_orig",
} satisfies RoutingInfo;

export default { chromeInfo, firefoxInfo };
