import {
  mapRouteTraceToSource,
  parseRouteDebuggerTrace,
  routeDebuggerInfo,
  summarizeRouteSource,
  type RouteDebuggerTrace,
} from "../../../src/options/route-debugger/route-debugger-model.ts";

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

test("carries fetch rewrite fields and tolerates their absence", () => {
  const withFetch = {
    ...trace,
    selectedFetchTemplate: "https://mirror.example/:pagedomain:/orig.png",
    rewrittenUrl: "https://mirror.example/site.example/orig.png",
  };
  expect(parseRouteDebuggerTrace(withFetch)).toEqual(withFetch);

  const plain = parseRouteDebuggerTrace({
    ...trace,
    selectedFetchTemplate: null,
    rewrittenUrl: null,
  });
  expect(plain).toMatchObject({ selectedFetchTemplate: null, rewrittenUrl: null });

  const legacy = parseRouteDebuggerTrace(trace);
  expect(legacy).not.toBeNull();
  expect(legacy && "selectedFetchTemplate" in legacy).toBe(false);
});

test.each([
  { ...trace, selectedFetchTemplate: 4 },
  { ...trace, rewrittenUrl: 4 },
])("rejects malformed fetch rewrite fields", (value) => {
  expect(parseRouteDebuggerTrace(value)).toBeNull();
});

test("carries rename fields and tolerates their absence", () => {
  const withRename = {
    ...trace,
    selectedRename: { find: "^img_", flags: "gi", replacement: "photo-" },
    renamedFrom: "img_042.jpg",
    renamedTo: "photo-042.jpg",
  };
  expect(parseRouteDebuggerTrace(withRename)).toEqual(withRename);

  const plain = parseRouteDebuggerTrace({
    ...trace,
    selectedRename: null,
    renamedFrom: null,
    renamedTo: null,
  });
  expect(plain).toMatchObject({ selectedRename: null, renamedFrom: null, renamedTo: null });

  // A trace from an older background omits the fields entirely.
  const legacy = parseRouteDebuggerTrace(trace);
  expect(legacy).not.toBeNull();
  expect(legacy && "selectedRename" in legacy).toBe(false);
});

test.each([
  { ...trace, selectedRename: "a -> b" },
  { ...trace, selectedRename: { find: "a", flags: "g" } },
  { ...trace, renamedFrom: 4 },
  { ...trace, renamedTo: 4 },
])("rejects malformed rename fields", (value) => {
  expect(parseRouteDebuggerTrace(value)).toBeNull();
});

test("accepts an optional rule name and rejects malformed names", () => {
  const named = {
    ...trace,
    rules: [{ ...trace.rules[0], name: "Images" }],
  };
  expect(parseRouteDebuggerTrace(named)?.rules[0]?.name).toBe("Images");
  expect(
    parseRouteDebuggerTrace({
      ...named,
      rules: [{ ...named.rules[0], name: 7 }],
    }),
  ).toBeNull();
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
    "// Work PDFs",
    "fileext: pdf",
    "pagedomain: example\\.com",
    "into: pdf/:filename:",
  ].join("\n");

  const mapped = mapRouteTraceToSource(source, trace);

  expect(mapped.rules[0]?.source).toMatchObject({ line: 1, start: 0 });
  expect(mapped.rules[0]?.clauses[0]?.source).toMatchObject({ line: 1, start: 0 });
  expect(mapped.rules[1]?.name).toBe("Work PDFs");
  expect(mapped.rules[1]?.source).toMatchObject({ line: 5 });
  expect(mapped.rules[1]?.clauses.map((clause) => clause.source?.line)).toEqual([5, 6]);
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

// An absent currentTab key makes pagetitle: fall back to the tracked tab —
// which, while the user is in the debugger, is the options page itself. The
// trace must answer about the input it was given, not the tab it is shown in.
// An automatic save derives mediaType from the discovered sourceKind and mime
// from a data: header (automation/automatic-routing.ts's candidateInfo). The
// trace has to derive both the same way, or it reports rules dead that route.
test("an automatic trace derives mediatype and mime the way the save does", () => {
  const kind = routeDebuggerInfo({
    filename: "",
    sourceUrl: "https://cdn.example/report.pdf",
    pageUrl: "https://example.com/reports",
    mime: "",
    context: "AUTO",
    sourceKind: "document",
  });
  expect(kind.mediaType).toBe("document");

  const data = routeDebuggerInfo({
    filename: "",
    sourceUrl: "data:image/png;base64,AA==",
    pageUrl: "https://example.com/gallery",
    mime: "",
    context: "AUTO",
    sourceKind: "image",
  });
  expect(data.mime).toBe("image/png");

  // An explicit field still wins, and a non-automatic context derives nothing.
  const explicit = routeDebuggerInfo({
    filename: "",
    sourceUrl: "https://cdn.example/a.png",
    pageUrl: "https://example.com/",
    mime: "",
    context: "link",
    sourceKind: "document",
  });
  expect(explicit.mediaType).toBeUndefined();
});

test("a blank page title names no tab rather than falling back to the tracked one", () => {
  const info = routeDebuggerInfo({
    filename: "report.pdf",
    sourceUrl: "https://cdn.example/report.pdf",
    pageUrl: "https://example/reports",
    mime: "application/pdf",
    context: "link",
    pageTitle: "",
  });

  expect(Object.hasOwn(info, "currentTab")).toBe(true);
  expect(info.currentTab).toBeNull();
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
    now: new Date("2026-07-15T12:30:00").toISOString(),
    counter: 7,
    sha256: "ba7816bf8f01",
  });
});

// currentTab is the exception: it is named even when blank, because an absent
// key is what makes pagetitle: fall back to the tracked tab.
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
  ).toEqual({ currentTab: null });
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
    ).toEqual({ currentTab: null });
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
