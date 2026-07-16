// Pure history-table helpers extracted from options.ts (history-view.ts).
import {
  formatBytes,
  formatHistoryDisplayTime,
  formatHistoryTime,
  relativeHistoryTime,
  historyFilename,
  historyFolder,
  historyCsv,
  historyTsv,
  HISTORY_COLUMNS,
  localizeHistoryColumns,
  historyRow,
  historyStatus,
  historyType,
  paginateHistory,
  historyDateRange,
  localHistoryDate,
  progressCell,
  statusClass,
  statusLabel,
} from "../../../src/options/history/history-view.ts";

test("missing legacy timestamps render as blank", () => {
  expect(formatHistoryDisplayTime()).toBe("");
  expect(formatHistoryDisplayTime("not-a-date")).toBe("not-a-date");
  expect(formatHistoryTime()).toBe("");
  expect(formatHistoryTime("not-a-date")).toBe("not-a-date");
  expect(relativeHistoryTime()).toBe("");
  expect(relativeHistoryTime("not-a-date")).toBe("");
  expect(localHistoryDate()).toBe("");
  expect(localHistoryDate("not-a-date")).toBe("");
});

test("date-only legacy timestamps retain their calendar date in every timezone", () => {
  expect(localHistoryDate("2024-01-02")).toBe("2024-01-02");
  expect(localHistoryDate("2024-02-30")).toBe("");
  expect(localHistoryDate("2000-02-29")).toBe("2000-02-29");
  expect(localHistoryDate("1900-02-29")).toBe("");
  expect(localHistoryDate("2024-13-01")).toBe("");
});

test("history timestamps use ISO text and relative labels", () => {
  const instant = new Date("2024-01-01T00:00:00Z");
  const offsetMinutes = -instant.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  const expectedPrefix = [
    instant.getFullYear(),
    String(instant.getMonth() + 1).padStart(2, "0"),
    String(instant.getDate()).padStart(2, "0"),
  ].join("-");
  const expected = `${expectedPrefix}T${String(instant.getHours()).padStart(2, "0")}:${String(instant.getMinutes()).padStart(2, "0")}:${String(instant.getSeconds()).padStart(2, "0")}.000${offsetSign}${offsetHours}:${offsetRemainder}`;
  expect(formatHistoryTime(instant.toISOString())).toBe(expected);
  expect(formatHistoryDisplayTime(instant.toISOString())).not.toContain("T00:00:00");
  expect(relativeHistoryTime("2024-01-01T11:59:00Z", Date.parse("2024-01-01T12:00:00Z"))).toContain(
    "minute",
  );
  const noon = Date.parse("2024-01-01T12:00:00Z");
  expect(relativeHistoryTime("2024-01-01T11:59:45Z", noon)).toContain("second");
  expect(relativeHistoryTime("2024-01-01T09:00:00Z", noon)).toContain("hour");
  expect(relativeHistoryTime("2023-12-29T00:00:00Z", noon)).toContain("day");
});

test("history timestamps preserve negative timezone offsets", () => {
  const timezone = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(90);
  expect(formatHistoryTime("2024-01-01T00:00:00Z").endsWith("-01:30")).toBe(true);
  timezone.mockRestore();
});

test("CSV export includes all flattened history fields and escapes values", () => {
  const csv = historyCsv([
    {
      timestamp: "2024-01-01",
      finalFullPath: 'docs/a,"b".txt',
      info: { context: "PAGE", sourceUrl: "https://example.test/a" },
      downloadId: 7,
    },
  ]);

  expect(csv).toContain('"Started","File","Folder","Status"');
  expect(csv).toContain('"a,""b"".txt"');
  expect(csv).toContain('"7"');
});

test("TSV export includes every flattened field and strips embedded tabs/newlines", () => {
  const tsv = historyTsv([{ finalFullPath: "docs/a\tb\r\n.txt", variables: { title: "x" } }]);
  expect(tsv.split("\n")[0]).toContain("Variables");
  expect(tsv).not.toContain("a\tb");
  expect(tsv).not.toContain("b\r");
  expect(tsv).toContain("title=x");
});

test("spreadsheet exports neutralize formula-leading history values", () => {
  const entries = [
    { finalFullPath: "downloads/=2+2.csv" },
    { finalFullPath: "downloads/@SUM(1,1).csv" },
    { finalFullPath: "downloads/＝2+2.csv" },
  ];

  const csv = historyCsv(entries);
  const tsv = historyTsv(entries);

  expect(csv).toContain('"\'=2+2.csv"');
  expect(csv).toContain('"\'@SUM(1,1).csv"');
  expect(csv).toContain('"\'＝2+2.csv"');
  expect(tsv).toContain("\t'=2+2.csv\t");
  expect(tsv).toContain("\t'@SUM(1,1).csv\t");
  expect(tsv).toContain("\t'＝2+2.csv\t");
});

test("history columns prioritize user outcomes over implementation metadata", () => {
  expect(HISTORY_COLUMNS.slice(0, 4).map(({ key }) => key)).toEqual([
    "time",
    "file",
    "folder",
    "status",
  ]);
  expect(HISTORY_COLUMNS.find(({ key }) => key === "index")?.defaultVisible).toBe(false);
  expect(HISTORY_COLUMNS.find(({ key }) => key === "source")?.defaultVisible).toBe(true);
  expect(HISTORY_COLUMNS.find(({ key }) => key === "mechanism")?.defaultVisible).toBe(false);
  expect(HISTORY_COLUMNS.map(({ key }) => key)).toContain("fullPath");
  expect(HISTORY_COLUMNS.map(({ key }) => key)).toContain("downloadId");
  expect(HISTORY_COLUMNS.find(({ key }) => key === "menuItem")?.defaultVisible).toBe(false);
  expect(HISTORY_COLUMNS.find(({ key }) => key === "variables")?.defaultVisible).toBe(false);
});

test("history column localization falls back field by field", () => {
  const localized = localizeHistoryColumns((key) =>
    key === "historyColumnFile" ? "Localized file" : "",
  );
  const fallback = localizeHistoryColumns(() => "");
  expect(localized.find(({ key }) => key === "file")?.label).toBe("Localized file");
  expect(localized.find(({ key }) => key === "time")?.label).toBe("Started");
  expect(fallback.find(({ key }) => key === "file")?.label).toBe("File");
  expect(fallback.find(({ key }) => key === "index")?.label).toBe("#");
});

describe("history row flatteners", () => {
  test("filename / folder split a full path", () => {
    expect(historyFilename("a/b/c.png")).toBe("c.png");
    expect(historyFilename("a/b/")).toBe("a/b/");
    expect(historyFilename("")).toBe("(unnamed)");
    expect(historyFolder("a/b/c.png")).toBe("a/b");
    expect(historyFolder("c.png")).toBe(".");
    expect(historyFolder("")).toBe("");
  });

  test("type maps media->image and lowercases, defaults empty", () => {
    expect(historyType({ info: { context: "MEDIA" } })).toBe("image");
    expect(historyType({ info: { context: "LINK" } })).toBe("link");
    expect(historyType({ info: { context: "browser" } })).toBe("");
    expect(historyType({})).toBe("");
    // legacy entries kept the whole state
    expect(historyType({ state: { info: { context: "PAGE" } } })).toBe("page");
  });

  test("status defaults legacy entries to complete; labels/classes", () => {
    expect(historyStatus({})).toBe("complete");
    expect(statusLabel("complete")).toBe("Saved");
    expect(statusLabel("pending")).toBe("Saving…");
    expect(statusLabel("failed")).toBe("Failed");
    expect(statusLabel("NETWORK_FAILED")).toBe("Network failed");
    expect(statusLabel("OTHER_THING")).toBe("other thing");
    expect(
      statusLabel("USER_CANCELED", (key) => (key === "historyStatusCanceled" ? "Stopped" : "")),
    ).toBe("Stopped");
    expect(statusClass("complete")).toBe("status-ok");
    expect(statusClass("pending")).toBe("status-pending");
    expect(statusClass("SERVER_FORBIDDEN")).toBe("status-fail");
    expect(statusLabel("undone")).toBe("Undone");
    expect(statusClass("undone")).toBe("status-undone");
  });

  test("undone rows filter as their own status, not as failures", () => {
    const entries = [
      { id: "a", status: "undone", timestamp: "2024-01-01T00:00:00Z" },
      { id: "b", status: "SERVER_FORBIDDEN", timestamp: "2024-01-01T00:00:00Z" },
    ];
    expect(paginateHistory(entries, { statusFilter: "failed" }).matchCount).toBe(1);
    expect(paginateHistory(entries, { statusFilter: "undone" }).matchCount).toBe(1);
  });

  test("row flattens an entry to its table fields", () => {
    const row = historyRow({
      timestamp: "2024-01-01T00:00:00Z",
      finalFullPath: "cats/kitten.png",
      routed: true,
      info: { context: "MEDIA", sourceUrl: "https://x/k.png" },
      downloadId: 7,
      fileSize: 2048,
      mechanism: "fetch-downloads-api",
    });
    expect(row).toMatchObject({
      time: "2024-01-01T00:00:00Z",
      status: "complete",
      routed: "routed",
      type: "image",
      file: "kitten.png",
      folder: "cats",
      source: "Save In",
      url: "https://x/k.png",
      downloadId: 7,
      size: 2048,
      mechanism: "Fetch + downloads API",
    });
  });

  test("prefers initiation time and formats menu and variable details", () => {
    const row = historyRow({
      timestamp: "2024-01-01T00:00:01Z",
      initiatedAt: "2024-01-01T00:00:00Z",
      menu: { id: "save-2", title: "Research", path: "docs/research" },
      variables: { filename: "paper.pdf", pagetitle: "Example", empty: "" },
    });
    expect(row.time).toBe("2024-01-01T00:00:00Z");
    expect(row.menuItem).toBe("Research");
    expect(row.variables).toBe("filename=paper.pdf · pagetitle=Example");
  });

  test("normalizes legacy and browser-owned row fallbacks", () => {
    expect(
      historyRow({
        id: "history-1",
        url: "https://download.test/file",
        observedBrowserDownload: true,
        mechanism: "unknown" as never,
        menu: { path: "fallback/path" },
      }),
    ).toMatchObject({
      historyId: "history-1",
      source: "Browser",
      mechanism: "Browser download",
      url: "https://download.test/file",
      downloadId: null,
      size: null,
      menuItem: "fallback/path",
    });
    expect(
      historyRow({
        id: 2 as never,
        info: { context: "browser", pageUrl: "https://page.test" },
        menu: {},
      }),
    ).toMatchObject({
      historyId: null,
      source: "Browser",
      mechanism: "Browser download",
      url: "https://page.test",
      menuItem: "",
    });
    expect(
      historyRow({ mechanism: "firefox-replacement", menu: { id: "fallback-id" } }),
    ).toMatchObject({
      mechanism: "Firefox replacement",
      menuItem: "fallback-id",
    });
  });

  test("formatBytes uses SI units", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
    expect(formatBytes(3_000_000_000)).toBe("3.00 GB");
  });

  test("progressCell shows a percentage when the total is known", () => {
    expect(progressCell({ bytesReceived: 512_000, totalBytes: 1_000_000 })).toEqual({
      label: "51%",
      title: "512.0 KB / 1.0 MB",
    });
  });

  test("progressCell falls back to the running byte count without a total", () => {
    expect(progressCell({ bytesReceived: 1500, totalBytes: 0 })).toEqual({
      label: "1.5 KB",
      title: "",
    });
  });

  test("progressCell tolerates a missing item", () => {
    expect(progressCell(undefined)).toEqual({ label: "0 B", title: "" });
  });
});

describe("paginateHistory", () => {
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
    const { pageRows, matchCount, total } = paginateHistory(entries, {});
    expect(total).toBe(3);
    expect(matchCount).toBe(3);
    expect(pageRows).toHaveLength(3);
  });

  test("filters on file/folder/type/status/source substrings", () => {
    expect(paginateHistory(entries, { filter: "one" }).matchCount).toBe(1); // file
    expect(paginateHistory(entries, { filter: "photos" }).matchCount).toBe(2); // folder
    expect(paginateHistory(entries, { filter: "failed" }).matchCount).toBe(1); // status
    expect(paginateHistory(entries, { filter: "nope" }).matchCount).toBe(0);
  });

  test("facets filter by download source, status group, and type", () => {
    const browserEntry = {
      timestamp: "2024-01-04",
      finalFullPath: "browser.zip",
      status: "NETWORK_FAILED",
      info: { context: "browser" },
      observedBrowserDownload: true,
    };
    const faceted = [...entries, browserEntry];
    expect(paginateHistory(faceted, { sourceFilter: "browser" }).matchCount).toBe(1);
    expect(paginateHistory(faceted, { sourceFilter: "save-in" }).matchCount).toBe(3);
    expect(paginateHistory(faceted, { statusFilter: "failed" }).matchCount).toBe(2);
    expect(paginateHistory(faceted, { statusFilter: "pending" }).matchCount).toBe(0);
    expect(paginateHistory(faceted, { typeFilter: "image" }).matchCount).toBe(1);
  });

  test("filters inclusively by ISO calendar date", () => {
    expect(
      paginateHistory(entries, { dateFrom: "2024-01-02", dateTo: "2024-01-03" }).matchCount,
    ).toBe(2);
  });

  test("filters by the user's local calendar day instead of the UTC date", () => {
    const timestamp = "2024-01-02T00:30:00.000Z";
    const expected = localHistoryDate(timestamp);
    expect(
      paginateHistory([{ timestamp, finalFullPath: "edge.png" }], {
        dateFrom: expected,
        dateTo: expected,
      }).matchCount,
    ).toBe(1);
  });

  test("builds inclusive local ranges for the common date presets", () => {
    const now = new Date(2024, 6, 12, 15, 30).getTime();
    expect(historyDateRange("today", now)).toEqual({ from: "2024-07-12", to: "2024-07-12" });
    expect(historyDateRange("7-days", now)).toEqual({ from: "2024-07-06", to: "2024-07-12" });
    expect(historyDateRange("30-days", now)).toEqual({ from: "2024-06-13", to: "2024-07-12" });
    expect(historyDateRange("any", now)).toEqual({ from: "", to: "" });
  });

  test("sorts by the given key/direction", () => {
    const asc = paginateHistory(entries, { sort: { key: "file", dir: "asc" } });
    expect(asc.pageRows.map((r) => r.file)).toEqual(["one.png", "three.png", "two.txt"]);
    const desc = paginateHistory(entries, { sort: { key: "file", dir: "desc" } });
    expect(desc.pageRows.map((r) => r.file)).toEqual(["two.txt", "three.png", "one.png"]);
  });

  test("sorting by a numeric column does not throw (size)", () => {
    expect(() => paginateHistory(entries, { sort: { key: "size", dir: "asc" } })).not.toThrow();
  });

  test("paginates and clamps an out-of-range page", () => {
    const first = paginateHistory(entries, { pageSize: 2, page: 0 });
    expect(first.pageRows).toHaveLength(2);
    expect(first.pageCount).toBe(2);

    const clamped = paginateHistory(entries, { pageSize: 2, page: 99 });
    expect(clamped.page).toBe(1);
    expect(clamped.pageRows).toHaveLength(1);
  });
});
