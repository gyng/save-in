// Undo semantics matrix: identity-checked, refuses untracked or foreign ids,
// and never claims success unless the browser actually erased the entry.
import {
  matchesDownloadIdentity,
  undoBrowserDownload,
  undoDownloadAndMark,
} from "../../src/downloads/undo-download.ts";

const seedSearch = (items: unknown[]) =>
  vi.mocked(global.browser.downloads.search).mockResolvedValue(items as never);

beforeEach(() => {
  vi.mocked(global.browser.downloads.search).mockReset().mockResolvedValue([]);
  vi.mocked(global.browser.downloads.removeFile)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(global.browser.downloads.erase)
    .mockReset()
    .mockImplementation(async (query) => (query.id != null ? [query.id] : []));
});

describe("matchesDownloadIdentity", () => {
  test.each([
    ["no expected identity is vacuously true", {}, { url: "https://a/x" }, true],
    ["url agrees with item.url", { url: "https://a/x" }, { url: "https://a/x" }, true],
    [
      "url agrees with item.finalUrl after a redirect",
      { url: "https://a/x" },
      { url: "https://b/y", finalUrl: "https://a/x" },
      true,
    ],
    [
      "basenames agree across path separators",
      { filename: "gallery/pic.png" },
      { filename: "C:\\dl\\pic.png" },
      true,
    ],
    [
      "any agreeing field is enough",
      { url: "https://a/x", filename: "other.bin" },
      { url: "https://a/x", filename: "/dl/pic.png" },
      true,
    ],
    [
      "all provided fields disagreeing refuses",
      { url: "https://a/x", filename: "pic.png" },
      { url: "https://b/y", finalUrl: "https://b/z", filename: "/dl/report.pdf" },
      false,
    ],
    [
      "expected filename with no item filename refuses",
      { filename: "pic.png" },
      { url: "https://b/y" },
      false,
    ],
    [
      "trailing separators compare as the full path",
      { filename: "gallery/" },
      { filename: "gallery/" },
      true,
    ],
  ])("%s", (_name, expected, item, outcome) => {
    expect(matchesDownloadIdentity(item, expected)).toBe(outcome);
  });
});

describe("undoBrowserDownload", () => {
  test("refuses when the browser no longer tracks the id", async () => {
    seedSearch([]);

    await expect(undoBrowserDownload(3)).resolves.toEqual({ undone: false, fileMissing: false });
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
  });

  test("refuses when search itself fails", async () => {
    vi.mocked(global.browser.downloads.search).mockRejectedValue(new Error("host gone"));

    await expect(undoBrowserDownload(3)).resolves.toEqual({ undone: false, fileMissing: false });
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
  });

  test("refuses a reused id pointing at a different download", async () => {
    seedSearch([{ id: 3, url: "https://elsewhere/report.pdf", filename: "/dl/report.pdf" }]);

    await expect(
      undoBrowserDownload(3, { url: "https://a/photo.jpg", filename: "photo.jpg" }),
    ).resolves.toEqual({ undone: false, fileMissing: false });
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
  });

  test("removes, erases, and reports success for a matching item", async () => {
    seedSearch([{ id: 3, url: "https://a/photo.jpg" }]);

    await expect(undoBrowserDownload(3, { url: "https://a/photo.jpg" })).resolves.toEqual({
      undone: true,
      fileMissing: false,
    });
    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(3);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 3 });
  });

  test("skips removeFile when the browser already knows the file is gone", async () => {
    seedSearch([{ id: 3, url: "https://a/photo.jpg", exists: false }]);

    await expect(undoBrowserDownload(3, { url: "https://a/photo.jpg" })).resolves.toEqual({
      undone: true,
      fileMissing: true,
    });
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 3 });
  });

  test("a rejecting removeFile still erases and reports the missing file", async () => {
    seedSearch([{ id: 3, url: "https://a/photo.jpg" }]);
    vi.mocked(global.browser.downloads.removeFile).mockRejectedValue(new Error("already gone"));

    await expect(undoBrowserDownload(3, { url: "https://a/photo.jpg" })).resolves.toEqual({
      undone: true,
      fileMissing: true,
    });
  });

  test("an empty erase result is failure, not success", async () => {
    seedSearch([{ id: 3, url: "https://a/photo.jpg" }]);
    vi.mocked(global.browser.downloads.erase).mockResolvedValue([]);

    await expect(undoBrowserDownload(3, { url: "https://a/photo.jpg" })).resolves.toEqual({
      undone: false,
      fileMissing: false,
    });
  });

  test("a rejecting erase is failure", async () => {
    seedSearch([{ id: 3, url: "https://a/photo.jpg" }]);
    vi.mocked(global.browser.downloads.erase).mockRejectedValue(new Error("shelf locked"));

    await expect(undoBrowserDownload(3, { url: "https://a/photo.jpg" })).resolves.toEqual({
      undone: false,
      fileMissing: false,
    });
  });
});

describe("undoDownloadAndMark", () => {
  test("marks only after a successful undo", async () => {
    seedSearch([{ id: 3, url: "https://a/photo.jpg" }]);
    const mark = vi.fn(() => Promise.resolve());

    await expect(undoDownloadAndMark(3, { url: "https://a/photo.jpg" }, mark)).resolves.toEqual({
      undone: true,
      fileMissing: false,
    });
    expect(mark).toHaveBeenCalledOnce();
  });

  test("never marks a refused undo", async () => {
    seedSearch([]);
    const mark = vi.fn(() => Promise.resolve());

    await expect(undoDownloadAndMark(3, {}, mark)).resolves.toEqual({
      undone: false,
      fileMissing: false,
    });
    expect(mark).not.toHaveBeenCalled();
  });
});
