// Focused coverage for the checked filename fallbacks in the download
// pipeline: when the resolved filename is missing at a boundary, the pipeline
// must degrade to a valid name (suggested name, URL, or empty string), never
// hand undefined onward.
import { Download, makeState, SaveHistory, Variable } from "./download-flow.fixture.ts";

const DownloadDisposition = await import("../../src/downloads/download-disposition.ts");

describe("resolveDownloadPlan filename fallback", () => {
  test("degrades to the URL-derived initial filename when disposition resolution clears it", async () => {
    vi.spyOn(DownloadDisposition, "resolveDispositionFilename").mockImplementationOnce(
      async (state) => {
        delete state.info.filename;
      },
    );
    const state = makeState();

    await Download.resolveDownloadPlan(state);

    expect(state.info.filename).toBe("file.png");
  });
});

describe("content preparation history naming fallback", () => {
  test("names the preparation row from the suggested filename when the resolved filename is missing", async () => {
    vi.spyOn(Variable, "applyVariables").mockImplementationOnce(async (path, info) => {
      if (!info) throw new Error("Expected download metadata");
      delete info.filename;
      info.suggestedFilename = "suggested.bin";
      await info.onContentFetchStart?.("fallback-suggested");
      return path as any;
    });
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ finalFullPath: "suggested.bin" }),
      expect.anything(),
    );
  });

  test("names the preparation row from the URL when no filename was resolved or suggested", async () => {
    vi.spyOn(Variable, "applyVariables").mockImplementationOnce(async (path, info) => {
      if (!info) throw new Error("Expected download metadata");
      delete info.filename;
      await info.onContentFetchStart?.("fallback-url");
      return path as any;
    });
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ finalFullPath: "https://example.com/dir/file.png" }),
      expect.anything(),
    );
  });

  test("still records the preparation row when every name source is missing", async () => {
    vi.spyOn(Variable, "applyVariables").mockImplementationOnce(async (path, info) => {
      if (!info) throw new Error("Expected download metadata");
      delete info.filename;
      delete info.url;
      await info.onContentFetchStart?.("fallback-empty");
      return path as any;
    });
    const state = makeState();

    // Removing the URL mid-preparation may fail the rest of the pipeline; the
    // contract under test is only the degraded history-row name.
    await Download.renameAndDownload(state).catch(() => undefined);

    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ finalFullPath: "" }),
      expect.anything(),
    );
  });
});
