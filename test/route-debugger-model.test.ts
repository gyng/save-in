import {
  mapRouteTraceToSource,
  parseRouteDebuggerTrace,
  routeDebuggerInfo,
  summarizeRouteSource,
  type RouteDebuggerTrace,
} from "../src/options/route-debugger-model.ts";

const trace: RouteDebuggerTrace = {
  selectedRule: 2,
  destination: "pdf/:filename:",
  expandedDestination: "pdf/report.pdf",
  sanitizedDestination: "pdf/report.pdf",
  finalPath: "pdf/report.pdf",
  rules: [
    {
      index: 1,
      matched: false,
      destination: "images/",
      clauses: [{ name: "fileext", pattern: "png", matched: false }],
    },
    {
      index: 2,
      matched: true,
      destination: "pdf/:filename:",
      clauses: [
        { name: "fileext", pattern: "pdf", matched: true },
        { name: "pagedomain", pattern: "example\\.com", matched: true },
      ],
    },
  ],
};

test("accepts a complete route trace received from the background", () => {
  expect(parseRouteDebuggerTrace(trace)).toEqual(trace);
});

test.each([
  null,
  { ...trace, selectedRule: "2" },
  { ...trace, destination: 4 },
  { ...trace, expandedDestination: 4 },
  { ...trace, sanitizedDestination: 4 },
  { ...trace, finalPath: 4 },
  { ...trace, rules: {} },
  { ...trace, rules: [{ ...trace.rules[0], index: "1" }] },
  { ...trace, rules: [{ ...trace.rules[0], matched: "yes" }] },
  { ...trace, rules: [{ ...trace.rules[0], destination: null }] },
  { ...trace, rules: [{ ...trace.rules[0], clauses: {} }] },
  {
    ...trace,
    rules: [{ ...trace.rules[0], clauses: [{ name: 4, pattern: "png", matched: true }] }],
  },
  {
    ...trace,
    rules: [{ ...trace.rules[0], clauses: [{ name: "fileext", pattern: 4, matched: true }] }],
  },
  {
    ...trace,
    rules: [{ ...trace.rules[0], clauses: [{ name: "fileext", pattern: "png", matched: 1 }] }],
  },
])("rejects malformed route trace fields", (value) => {
  expect(parseRouteDebuggerTrace(value)).toBeNull();
});

test("maps production trace rows back to grammar source locations", () => {
  const source = [
    "fileext: png",
    "into: images/",
    "",
    "fileext: pdf",
    "pagedomain: example\\.com",
    "into: pdf/:filename:",
  ].join("\n");

  const mapped = mapRouteTraceToSource(source, trace);

  expect(mapped.rules[0]?.source).toMatchObject({ line: 1, start: 0 });
  expect(mapped.rules[0]?.clauses[0]?.source).toMatchObject({ line: 1, start: 0 });
  expect(mapped.rules[1]?.source).toMatchObject({ line: 4 });
  expect(mapped.rules[1]?.clauses.map((clause) => clause.source?.line)).toEqual([4, 5]);
  expect(source.slice(mapped.rules[1]?.source?.start, mapped.rules[1]?.source?.end)).toContain(
    "into: pdf/:filename:",
  );
});

test("normalizes debugger fields into the routing engine input aliases", () => {
  expect(
    routeDebuggerInfo({
      filename: "report.pdf",
      sourceUrl: "https://cdn.example/report.pdf",
      pageUrl: "https://example/reports",
      mime: "application/pdf",
      context: "link",
      pageTitle: "Reports",
      referrerUrl: "https://example/home",
      frameUrl: "https://example/embed",
      linkText: "Quarterly report",
      selectionText: "Q2",
      mediaType: "image",
    }),
  ).toEqual({
    filename: "report.pdf",
    initialFilename: "report.pdf",
    resolvedFilename: "report.pdf",
    sourceUrl: "https://cdn.example/report.pdf",
    url: "https://cdn.example/report.pdf",
    pageUrl: "https://example/reports",
    mime: "application/pdf",
    context: "link",
    currentTab: { title: "Reports" },
    referrerUrl: "https://example/home",
    frameUrl: "https://example/embed",
    linkText: "Quarterly report",
    selectionText: "Q2",
    mediaType: "image",
  });
});

test("omits blank debugger fields", () => {
  expect(
    routeDebuggerInfo({ filename: "", sourceUrl: "", pageUrl: "", mime: "", context: "" }),
  ).toEqual({});
});

test("summarizes the grammar structure for the IDE status bar", () => {
  expect(
    summarizeRouteSource(
      "fileext: pdf\npageurl: example\\.com\ninto: docs/\n\nmediatype: image\ninto: images/",
    ),
  ).toEqual({ lines: 6, rules: 2, matchers: 3 });
  expect(summarizeRouteSource("")).toEqual({ lines: 0, rules: 0, matchers: 0 });
});
