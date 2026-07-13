const { resolveVersionMetadata } = require("../scripts/write-version.js");

describe("write-version metadata", () => {
  const existing = { commit: "old1234", date: "2025-01-02" };

  test("refreshes the build date when a current Git commit is available", () => {
    expect(
      resolveVersionMetadata({
        existing,
        gitCommit: "new5678",
        today: "2026-07-13",
      }),
    ).toEqual({ commit: "new5678", date: "2026-07-13" });
  });

  test("preserves release metadata when rebuilding an extracted source archive", () => {
    expect(resolveVersionMetadata({ existing, today: "2026-07-13" })).toEqual(existing);
  });

  test("prefers deterministic release metadata from the environment", () => {
    expect(
      resolveVersionMetadata({
        existing,
        gitCommit: "git9999",
        sourceCommit: "tag1234",
        sourceDate: "2026-07-12",
        today: "2026-07-13",
      }),
    ).toEqual({ commit: "tag1234", date: "2026-07-12" });
  });
});
