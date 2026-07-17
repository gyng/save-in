import {
  notifyDownloadRefresh,
  subscribeDownloadRefresh,
} from "../../../src/options/core/download-refresh.ts";

test("notifies every subscriber, in subscription order", () => {
  const calls: string[] = [];
  subscribeDownloadRefresh(() => calls.push("a"));
  subscribeDownloadRefresh(() => calls.push("b"));

  notifyDownloadRefresh();

  expect(calls).toEqual(["a", "b"]);
});
