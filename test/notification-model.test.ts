import {
  buildSuccessNotificationTitle,
  downloadFailureReason,
  formatNotificationFileSize,
  getDownloadFailure,
  isRetryableDownloadFailure,
} from "../src/downloads/notification-model.ts";

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
  });

  test("builds success metadata and retry policy", () => {
    expect(formatNotificationFileSize(123)).toBe("123 B");
    expect(formatNotificationFileSize(1500)).toBe("1.5 KB");
    expect(buildSuccessNotificationTitle("Saved", 1_500_000, "image/png")).toBe(
      "Saved · 1.5 MB · image/png",
    );
    expect(isRetryableDownloadFailure({ current: "SERVER_UNREACHABLE" })).toBe(true);
    expect(isRetryableDownloadFailure({ current: "FILE_FAILED" })).toBe(false);
    expect(isRetryableDownloadFailure("SERVER_FAILED")).toBe(false);
    expect(downloadFailureReason({ current: "NETWORK_FAILED" })).toBe("NETWORK_FAILED");
    expect(downloadFailureReason("SERVER_FAILED")).toBe("SERVER_FAILED");
    expect(downloadFailureReason(true)).toBeUndefined();
  });
});
