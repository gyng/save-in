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
      clauses: [
        {
          name: "fileext",
          pattern: "png",
          matched: false,
          attempts: [
            {
              source: "sourceUrl",
              value: "jpg",
              status: "not-matched",
              matchedText: "jpg",
              captures: [null, "jpg"],
            },
            { source: "filename", value: null, status: "missing" },
          ],
        },
      ],
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
  { ...trace, selectedRule: Number.NaN },
  { ...trace, selectedRule: Number.POSITIVE_INFINITY },
  { ...trace, selectedRule: 1.5 },
  { ...trace, selectedRule: 0 },
  { ...trace, destination: 4 },
  { ...trace, expandedDestination: 4 },
  { ...trace, sanitizedDestination: 4 },
  { ...trace, finalPath: 4 },
  { ...trace, rules: {} },
  { ...trace, rules: [{ ...trace.rules[0], index: "1" }] },
  { ...trace, rules: [{ ...trace.rules[0], index: Number.NaN }] },
  { ...trace, rules: [{ ...trace.rules[0], index: 1.5 }] },
  { ...trace, rules: [{ ...trace.rules[0], index: 0 }] },
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
  {
    ...trace,
    rules: [
      {
        ...trace.rules[0],
        clauses: [
          {
            name: "fileext",
            pattern: "png",
            matched: false,
            attempts: [{ source: "sourceUrl", value: "jpg", status: "unknown" }],
          },
        ],
      },
    ],
  },
])("rejects malformed route trace fields", (value) => {
  expect(parseRouteDebuggerTrace(value)).toBeNull();
});

test.each([
  "not-an-array",
  [null],
  [{ source: 7, value: "jpg", status: "matched" }],
  [{ source: "sourceUrl", value: 7, status: "matched" }],
  [{ source: "sourceUrl", value: "jpg", status: 7 }],
  [{ source: "sourceUrl", value: "jpg", status: "unknown" }],
  [{ source: "sourceUrl", value: "jpg", status: "matched", matchedText: 7 }],
  [{ source: "sourceUrl", value: "jpg", status: "matched", captures: "jpg" }],
  [{ source: "sourceUrl", value: "jpg", status: "matched", captures: [7] }],
])("rejects malformed matcher attempts", (attempts) => {
  expect(
    parseRouteDebuggerTrace({
      ...trace,
      rules: [
        {
          ...trace.rules[0],
          clauses: [{ ...trace.rules[0]!.clauses[0], attempts }],
        },
      ],
    }),
  ).toBeNull();
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

test("maps active trace rows past disabled source rules", () => {
  const source = [
    "filename: jpg",
    "into: images/",
    "disabled: true",
    "",
    "filename: pdf",
    "into: documents/",
  ].join("\n");
  const activeTrace: RouteDebuggerTrace = {
    ...trace,
    selectedRule: 1,
    rules: [{ ...trace.rules[1]!, index: 1 }],
  };

  const mapped = mapRouteTraceToSource(source, activeTrace);

  expect(mapped.rules[0]?.source?.line).toBe(5);
  expect(mapped.rules[0]?.sourceIndex).toBe(1);
  expect(mapped.rules[0]?.clauses[0]?.source?.line).toBe(5);
  expect(summarizeRouteSource(source)).toEqual({ lines: 6, rules: 2, matchers: 2 });
});

test("leaves unmatched trace rows and clauses without source locations", () => {
  const mapped = mapRouteTraceToSource("fileext: png\ninto: images/", {
    ...trace,
    rules: [
      {
        ...trace.rules[0]!,
        clauses: [
          ...trace.rules[0]!.clauses,
          { name: "pagedomain", pattern: "example", matched: false },
        ],
      },
      trace.rules[1]!,
    ],
  });

  expect(mapped.rules[0]?.clauses[1]?.source).toBeUndefined();
  expect(mapped.rules[1]?.source).toBeUndefined();
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
      sourceKind: "document",
      menuIndex: "2",
      comment: "Reports",
      now: "2026-07-15T12:30:00",
      counter: "7",
      sha256: "ba7816bf8f01",
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
    sourceKind: "document",
    menuIndex: "2",
    comment: "Reports",
    now: new Date("2026-07-15T12:30:00"),
    counter: 7,
    sha256: "ba7816bf8f01",
  });
});

test("omits blank debugger fields", () => {
  expect(
    routeDebuggerInfo({
      filename: "",
      sourceUrl: "",
      pageUrl: "",
      mime: "",
      context: "",
      now: "not-a-date",
      counter: "not-a-number",
    }),
  ).toEqual({});
});

test.each(["-1", "1.5", "9007199254740992"])(
  "omits an invalid routing counter value (%s)",
  (counter) => {
    expect(
      routeDebuggerInfo({
        filename: "",
        sourceUrl: "",
        pageUrl: "",
        mime: "",
        context: "",
        counter,
      }),
    ).toEqual({});
  },
);

test("summarizes the grammar structure for the IDE status bar", () => {
  expect(
    summarizeRouteSource(
      "fileext: pdf\npageurl: example\\.com\ninto: docs/\n\nmediatype: image\ninto: images/",
    ),
  ).toEqual({ lines: 6, rules: 2, matchers: 3 });
  expect(summarizeRouteSource("")).toEqual({ lines: 0, rules: 0, matchers: 0 });
});
