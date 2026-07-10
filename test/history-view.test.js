// Pure history-table helpers extracted from options.js (history-view.js).
const HistoryView = (await import("../src/options/history-view.js")).default;

describe("HistoryView flatteners", () => {
  test("filename / folder split a full path", () => {
    expect(HistoryView.filename("a/b/c.png")).toBe("c.png");
    expect(HistoryView.filename("")).toBe("(unnamed)");
    expect(HistoryView.folder("a/b/c.png")).toBe("a/b");
    expect(HistoryView.folder("c.png")).toBe(".");
    expect(HistoryView.folder("")).toBe("");
  });

  test("type maps media->image and lowercases, defaults empty", () => {
    expect(HistoryView.type({ info: { context: "MEDIA" } })).toBe("image");
    expect(HistoryView.type({ info: { context: "LINK" } })).toBe("link");
    expect(HistoryView.type({})).toBe("");
    // legacy entries kept the whole state
    expect(HistoryView.type({ state: { info: { context: "PAGE" } } })).toBe("page");
  });

  test("status defaults legacy entries to complete; labels/classes", () => {
    expect(HistoryView.status({})).toBe("complete");
    expect(HistoryView.statusLabel("complete")).toBe("Saved");
    expect(HistoryView.statusLabel("pending")).toBe("Saving…");
    expect(HistoryView.statusLabel("NETWORK_FAILED")).toBe("network failed");
    expect(HistoryView.statusClass("complete")).toBe("status-ok");
    expect(HistoryView.statusClass("pending")).toBe("status-pending");
    expect(HistoryView.statusClass("SERVER_FORBIDDEN")).toBe("status-fail");
  });

  test("row flattens an entry to its table fields", () => {
    const row = HistoryView.row({
      timestamp: "2024-01-01T00:00:00Z",
      finalFullPath: "cats/kitten.png",
      routed: true,
      info: { context: "MEDIA", sourceUrl: "https://x/k.png" },
      downloadId: 7,
      fileSize: 2048,
    });
    expect(row).toMatchObject({
      status: "complete",
      routed: "routed",
      type: "image",
      file: "kitten.png",
      folder: "cats",
      source: "https://x/k.png",
      downloadId: 7,
      size: 2048,
    });
  });

  test("formatBytes uses SI units", () => {
    expect(HistoryView.formatBytes(null)).toBe("");
    expect(HistoryView.formatBytes(-1)).toBe("");
    expect(HistoryView.formatBytes(512)).toBe("512 B");
    expect(HistoryView.formatBytes(1500)).toBe("1.5 KB");
    expect(HistoryView.formatBytes(2_500_000)).toBe("2.5 MB");
    expect(HistoryView.formatBytes(3_000_000_000)).toBe("3.00 GB");
  });
});

describe("HistoryView.paginate", () => {
  const entries = [
    {
      timestamp: "2024-01-03",
      finalFullPath: "photos/one.png",
      info: { context: "MEDIA" },
      fileSize: 10,
    },
    {
      timestamp: "2024-01-02",
      finalFullPath: "docs/two.txt",
      status: "failed",
      info: { context: "PAGE" },
    },
    {
      timestamp: "2024-01-01",
      finalFullPath: "photos/three.png",
      info: { sourceUrl: "https://ex/3" },
    },
  ];

  test("returns all rows and total for an empty filter", () => {
    const { pageRows, matchCount, total } = HistoryView.paginate(entries, {});
    expect(total).toBe(3);
    expect(matchCount).toBe(3);
    expect(pageRows).toHaveLength(3);
  });

  test("filters on file/folder/type/status/source substrings", () => {
    expect(HistoryView.paginate(entries, { filter: "one" }).matchCount).toBe(1); // file
    expect(HistoryView.paginate(entries, { filter: "photos" }).matchCount).toBe(2); // folder
    expect(HistoryView.paginate(entries, { filter: "failed" }).matchCount).toBe(1); // status
    expect(HistoryView.paginate(entries, { filter: "nope" }).matchCount).toBe(0);
  });

  test("sorts by the given key/direction", () => {
    const asc = HistoryView.paginate(entries, { sort: { key: "file", dir: "asc" } });
    expect(asc.pageRows.map((r) => r.file)).toEqual(["one.png", "three.png", "two.txt"]);
    const desc = HistoryView.paginate(entries, { sort: { key: "file", dir: "desc" } });
    expect(desc.pageRows.map((r) => r.file)).toEqual(["two.txt", "three.png", "one.png"]);
  });

  test("sorting by a numeric column does not throw (size)", () => {
    expect(() =>
      HistoryView.paginate(entries, { sort: { key: "size", dir: "asc" } }),
    ).not.toThrow();
  });

  test("paginates and clamps an out-of-range page", () => {
    const first = HistoryView.paginate(entries, { pageSize: 2, page: 0 });
    expect(first.pageRows).toHaveLength(2);
    expect(first.pageCount).toBe(2);

    const clamped = HistoryView.paginate(entries, { pageSize: 2, page: 99 });
    expect(clamped.page).toBe(1);
    expect(clamped.pageRows).toHaveLength(1);
  });
});
