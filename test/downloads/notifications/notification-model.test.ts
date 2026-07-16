import {
  buildSuccessNotificationTitle,
  downloadFailureReason,
  formatNotificationFileSize,
  getDownloadFailure,
  isRetryableDownloadFailure,
} from "../../../src/downloads/notification-model.ts";

describe("notification model", () => {
  test("distinguishes terminal interruptions from resumable Firefox state", () => {
    expect(getDownloadFailure({ state: { current: "interrupted" } }, false)).toBe(true);
    expect(
      getDownloadFailure(
        { state: { current: "interrupted" }, canResume: { current: true } },
        false,
      ),
    ).toBe(false);
    expect(getDownloadFailure({ error: { current: "NETWORK_FAILED" } }, true)).toEqual({
      current: "NETWORK_FAILED",
    });
    expect(getDownloadFailure({}, true)).toBe(false);
  });

  test.each([
    [undefined, ""],
    [0, ""],
    [123, "123 B"],
    [1_500, "1.5 KB"],
    [2_500_000, "2.5 MB"],
  ])("formats notification size %s", (size, expected) => {
    expect(formatNotificationFileSize(size)).toBe(expected);
  });

  test.each([
    ["Saved", undefined, undefined, "Saved"],
    ["Saved", undefined, "image/png", "Saved · image/png"],
    ["Saved", 1_500_000, "image/png", "Saved · 1.5 MB · image/png"],
  ])("builds success title metadata", (title, size, mime, expected) => {
    expect(buildSuccessNotificationTitle(title, size, mime)).toBe(expected);
  });

  test("defines retry policy and failure reasons", () => {
    expect(isRetryableDownloadFailure({ current: "SERVER_UNREACHABLE" })).toBe(true);
    expect(isRetryableDownloadFailure({ current: "FILE_FAILED" })).toBe(false);
    expect(isRetryableDownloadFailure({})).toBe(false);
    expect(isRetryableDownloadFailure("SERVER_FAILED")).toBe(false);
    // #166: Firefox reports a BackgroundFileSaver NS_ERROR_FAILURE as CRASH
    // (Mozilla bug 1633191); the fetch retry is the documented workaround.
    expect(isRetryableDownloadFailure({ current: "CRASH" })).toBe(true);
    // Anchored, so it stays an exact match and never a prefix family.
    expect(isRetryableDownloadFailure({ current: "CRASHED_SOMEHOW" })).toBe(false);
    expect(downloadFailureReason({ current: "NETWORK_FAILED" })).toBe("NETWORK_FAILED");
    expect(downloadFailureReason("SERVER_FAILED")).toBe("SERVER_FAILED");
    expect(downloadFailureReason(true)).toBeUndefined();
  });
});
