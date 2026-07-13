import { RULE_TEMPLATES } from "../src/options/rule-templates.ts";
import { applyConfigSerialized } from "../src/background/config-apply.ts";
import { Path } from "../src/routing/path.ts";
import {
  getCaptureMatches,
  matchRules,
  parseRulesCollecting,
  traceRules,
} from "../src/routing/router.ts";
import { applyVariables } from "../src/routing/variable.ts";
import { SPECIAL_DIRS } from "../src/shared/constants.ts";

const templateNamed = (name: string) => {
  const template = RULE_TEMPLATES.find((candidate) => candidate.name === name);
  if (!template) throw new Error(`Missing template: ${name}`);
  return template;
};

const rulesFor = (name: string) => {
  const parsed = parseRulesCollecting(templateNamed(name).rule);
  expect(parsed.errors).toEqual([]);
  return parsed.rules;
};

describe("built-in matcher templates", () => {
  const genericTemplates = [
    "Date-stamp every download",
    "Daily inbox",
    "Downloads by month",
    "Weekly inbox",
    "Sequential archive",
    "Page-title prefix",
  ];
  const saveContexts = {
    link: {
      context: "LINK",
      linkUrl: "https://files.example/report.pdf",
      url: "https://files.example/report.pdf",
      filename: "report.pdf",
    },
    page: {
      context: "PAGE",
      pageUrl: "https://page.example/report",
      url: "https://page.example/report",
      filename: "report.html",
    },
    selection: {
      context: "SELECTION",
      url: "data:text/plain,selected",
      filename: "selection.txt",
    },
  } as const;

  test.each(RULE_TEMPLATES)("$name has a self-contained proof", async (template) => {
    expect(template.rule).not.toMatch(/^capture:/m);
    const parsed = parseRulesCollecting(template.rule);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rules).toHaveLength(1);
    const intoLine = template.rule.split("\n").find((line) => line.startsWith("into:"));
    expect(intoLine).toMatch(/:(filename|\$\d+):$/);
    const knownVariables = new Set<string>(Object.values(SPECIAL_DIRS));
    for (const token of intoLine?.match(/:[a-z$][a-z0-9$]*:/gi) ?? []) {
      expect(/^:\$\d+:$/.test(token) || knownVariables.has(token)).toBe(true);
    }
    const rules = parsed.rules;
    const destination = matchRules(rules, template.proof.info);

    expect(destination).toBe(template.proof.destination);
    expect((await applyVariables(new Path(destination), template.proof.info)).finalize()).toBe(
      template.example.replace(/^Example: /, ""),
    );
  });

  test.each(genericTemplates)("%s applies across non-media save contexts", (name) => {
    const rules = rulesFor(name);
    for (const info of Object.values(saveContexts)) {
      expect(
        matchRules(rules, {
          ...info,
          currentTab: { title: "An Interesting Page" },
          now: new Date(2026, 6, 12, 12),
          counter: 42,
        }),
      ).not.toBeNull();
    }
  });

  test.each(RULE_TEMPLATES.filter((template) => template.rule.includes("actualfileext")))(
    "$name handles an extension before a query string",
    (template) => {
      const sourceUrl = template.proof.info.sourceUrl;
      expect(sourceUrl).toBeTypeOf("string");
      const rules = parseRulesCollecting(template.rule).rules;

      expect(
        matchRules(rules, {
          url: `${sourceUrl}?token=abc`,
          sourceUrl: `${sourceUrl}?token=abc`,
          filename: template.proof.info.filename || "report.pdf",
        }),
      ).toBe(template.proof.destination);
    },
  );

  test.each(RULE_TEMPLATES.filter((template) => template.rule.includes("actualfileext")))(
    "$name classifies an opaque URL from the resolved filename",
    (template) => {
      const filename = template.proof.info.filename;
      expect(filename).toBeTypeOf("string");
      const rules = parseRulesCollecting(template.rule).rules;

      expect(
        matchRules(rules, {
          url: "https://files.example/download?id=42",
          sourceUrl: "https://files.example/download?id=42",
          filename,
        }),
      ).toBe(template.proof.destination);
    },
  );

  test.each([
    [
      "Images into per-site folders",
      { ...templateNamed("Images into per-site folders").proof.info, mediaType: "video" },
    ],
    [
      "Videos into per-site folders",
      { ...templateNamed("Videos into per-site folders").proof.info, mediaType: "audio" },
    ],
    [
      "Audio into per-site folders",
      { ...templateNamed("Audio into per-site folders").proof.info, mediaType: "image" },
    ],
    [
      "Screenshots by month",
      { ...templateNamed("Screenshots by month").proof.info, filename: "holiday.png" },
    ],
    [
      "Browser downloads inbox",
      { ...templateNamed("Browser downloads inbox").proof.info, context: "link" },
    ],
    [
      "Link downloads inbox",
      { ...templateNamed("Link downloads inbox").proof.info, context: "page" },
    ],
    [
      "Selected text inbox",
      { ...templateNamed("Selected text inbox").proof.info, context: "link" },
    ],
    ["Tab saves inbox", { ...templateNamed("Tab saves inbox").proof.info, context: "page" }],
  ])("%s rejects an input outside its advertised media or save context", (name, info) => {
    expect(matchRules(rulesFor(name), info)).toBeNull();
  });

  test.each([
    ["PDFs into a documents folder", "report.pdfx"],
    ["Archives into one folder", "backup.gzip"],
    ["Documents into one folder", "notes.pdfx"],
    ["E-books and comics", "book.pdfx"],
    ["Apps and installers", "setup.exeold"],
    ["Fonts into one folder", "font.xwoff"],
  ])("%s rejects the lookalike extension in %s", (name, filename) => {
    expect(
      matchRules(rulesFor(name), {
        url: `https://files.example/${filename}`,
        sourceUrl: `https://files.example/${filename}`,
        filename,
      }),
    ).toBeNull();
  });

  test("the single-site template matches only the chosen host and its subdomains", () => {
    const rules = rulesFor("One site, one folder");
    const matches = (hostname: string) =>
      matchRules(rules, {
        pageUrl: `https://${hostname}/report`,
        filename: "report.pdf",
        currentTab: { title: "Report" },
      });

    expect(matches("example.com")).not.toBeNull();
    expect(matches("www.example.com")).not.toBeNull();
    expect(matches("notexample.com")).toBeNull();
    expect(matches("example.com.evil.test")).toBeNull();
  });

  test("the PDF template matches mixed-case extensions", () => {
    const rules = rulesFor("PDFs into a documents folder");

    expect(
      matchRules(rules, {
        url: "https://files.example/REPORT.PDF",
        sourceUrl: "https://files.example/REPORT.PDF",
        filename: "REPORT.PDF",
      }),
    ).toBe("documents/:filename:");
  });

  test("the PDF template matches a MIME-derived resolved extension", () => {
    expect(
      matchRules(rulesFor("PDFs into a documents folder"), {
        url: "https://files.example/download/42",
        filename: "download",
        mimeExtension: "pdf",
      }),
    ).toBe("documents/:filename:");
  });

  test("the MIME PDF template handles opaque URLs without matching other content", () => {
    const rules = rulesFor("PDFs by content type");
    const info = {
      url: "https://files.example/download/42",
      filename: "report",
    };

    expect(matchRules(rules, { ...info, mime: "application/pdf" })).toBe("documents/:filename:");
    expect(matchRules(rules, { ...info, mime: "image/png" })).toBeNull();
  });

  test("the source root-domain template combines CDN subdomains", () => {
    const rules = rulesFor("One folder per source root domain");

    expect(
      matchRules(rules, {
        sourceUrl: "https://media.cdn.example.co.uk/report.pdf",
        filename: "report.pdf",
      }),
    ).toBe("sites/:sourcerootdomain:/:filename:");
    expect(matchRules(rules, { filename: "report.pdf" })).toBeNull();
  });

  test("the referrer-section template matches only that URL section", () => {
    const rules = rulesFor("Downloads from a site section");
    const info = { filename: "report.pdf" };

    expect(
      matchRules(rules, {
        ...info,
        referrerUrl: "https://example.com/projects/quarterly/report",
      }),
    ).toBe("projects/:filename:");
    expect(
      matchRules(rules, { ...info, pageUrl: "https://example.com/projects/quarterly/report" }),
    ).toBe("projects/:filename:");
    expect(
      matchRules(rules, { ...info, referrerUrl: "https://example.com/profile/projects/report" }),
    ).toBeNull();
  });

  test("actual extension matching can use a resolved preview filename", () => {
    expect(
      matchRules(rulesFor("PDFs into a documents folder"), {
        filename: "download",
        resolvedFilename: "report.pdf",
      }),
    ).toBe("documents/:filename:");
  });
});

describe("matcher authoring and validation", () => {
  test("config apply rejects malformed routing grammar before persistence", async () => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) };
    const reset = vi.fn(async () => {});

    const result = await applyConfigSerialized(
      { queue: Promise.resolve() },
      storage,
      { filenamePatterns: "not a matcher clause" },
      undefined,
      reset,
    );

    expect(result).toEqual({
      applied: {},
      rejected: [{ name: "filenamePatterns", reason: "invalid value" }],
    });
    expect(storage.set).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  test("config apply preserves valid rules that only have ordering warnings", async () => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) };
    const reset = vi.fn(async () => {});
    const filenamePatterns =
      "filename: .*\ninto: dated/:filename:\n\ncontext: browser\ninto: browser/:filename:";

    const result = await applyConfigSerialized(
      { queue: Promise.resolve() },
      storage,
      { filenamePatterns },
      undefined,
      reset,
    );

    expect(result).toEqual({ applied: { filenamePatterns }, rejected: [] });
    expect(storage.set).toHaveBeenCalledWith({ filenamePatterns });
    expect(reset).toHaveBeenCalledOnce();
  });

  test("config apply rejects an unresolved capture variable", async () => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) };
    const reset = vi.fn(async () => {});
    const filenamePatterns = "sourceurl: example\\.test\ninto: files/:$1:";

    const parsed = parseRulesCollecting(filenamePatterns);
    expect(parsed.rules).toHaveLength(1);
    const captureError = parsed.errors.find((error) => error.error === "files/:$1:");
    expect(captureError).toBeDefined();
    expect(captureError).not.toHaveProperty("warning");

    await expect(
      applyConfigSerialized(
        { queue: Promise.resolve() },
        storage,
        { filenamePatterns },
        undefined,
        reset,
      ),
    ).resolves.toEqual({
      applied: {},
      rejected: [{ name: "filenamePatterns", reason: "invalid value" }],
    });
    expect(storage.set).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  test("warns when a catch-all filename rule shadows a different matcher", () => {
    const parsed = parseRulesCollecting(
      "filename: .*\ninto: dated/:filename:\n\ncontext: browser\ninto: browser/:filename:",
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ warning: true, error: "rule 2" }),
    );
    expect(matchRules(parsed.rules, { filename: "report.pdf", context: "browser" })).toBe(
      "dated/:filename:",
    );
  });

  test("warns when a flagged catch-all filename rule shadows a different matcher", () => {
    const parsed = parseRulesCollecting(
      "filename/i: .*\ninto: dated/:filename:\n\ncontext: browser\ninto: browser/:filename:",
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ warning: true, error: "rule 2" }),
    );
  });

  test("numbers capture groups continuously across multiple target matchers", () => {
    const parsed = parseRulesCollecting(
      [
        "pageurl: users/(alice)",
        "sourceurl: files/(report)",
        "capturegroups: pageurl,sourceurl",
        "into: :$1:-:$2:",
      ].join("\n"),
    );
    const info = {
      pageUrl: "https://site.example/users/alice",
      sourceUrl: "https://cdn.example/files/report",
    };

    expect(parsed.errors).toEqual([]);
    expect(getCaptureMatches(parsed.rules[0]!, info)).toEqual(["users/alice", "alice", "report"]);
    expect(matchRules(parsed.rules, info)).toBe("alice-report");
  });

  test("keeps the complete legacy capture index layout for stored multi-target rules", () => {
    const parsed = parseRulesCollecting(
      [
        "pageurl: users/(alice)",
        "sourceurl: files/(reports)/(q2)",
        "capture: pageurl,sourceurl",
        "into: :$1:-:$3:",
      ].join("\n"),
    );

    expect(parsed.errors).toEqual([]);
    expect(
      matchRules(parsed.rules, {
        pageUrl: "https://site.example/users/alice",
        sourceUrl: "https://cdn.example/files/reports/q2",
      }),
    ).toBe("alice-reports");
  });

  test("expands zero-padded capture indexes consistently with validation", () => {
    const parsed = parseRulesCollecting(
      "sourceurl: files/(report)\ncapturegroups: sourceurl\ninto: :$01:",
    );

    expect(parsed.errors).toEqual([]);
    expect(matchRules(parsed.rules, { sourceUrl: "https://cdn.example/files/report" })).toBe(
      "report",
    );
  });

  test("canonicalizes matcher names for capture and shadow analysis", () => {
    const captured = parseRulesCollecting(
      "SourceURL: files/(report)\ncapturegroups: sourceurl\ninto: :$1:",
    );
    expect(captured.errors).toEqual([]);
    expect(matchRules(captured.rules, { sourceUrl: "https://cdn.example/files/report" })).toBe(
      "report",
    );

    const shadowed = parseRulesCollecting(
      "SourceURL: .*\ninto: first\n\nsourceurl: cat\ninto: second",
    );
    expect(shadowed.errors).toContainEqual(
      expect.objectContaining({ warning: true, error: "rule 2" }),
    );
  });

  test("rejects an ambiguous continuous capture target", () => {
    const parsed = parseRulesCollecting(
      [
        "sourceurl: files/(reports)",
        "sourceurl: /(q2)$",
        "capturegroups: sourceurl",
        "into: :$1:",
      ].join("\n"),
    );

    expect(parsed.rules).toEqual([]);
    expect(parsed.errors).toEqual([expect.objectContaining({ error: "capturegroups: sourceurl" })]);
  });

  test("warns while preserving the first-target behavior of an ambiguous legacy capture", () => {
    const parsed = parseRulesCollecting(
      ["sourceurl: files/(reports)", "sourceurl: /(q2)$", "capture: sourceurl", "into: :$1:"].join(
        "\n",
      ),
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ error: "capture: sourceurl", warning: true }),
    );
    expect(matchRules(parsed.rules, { sourceUrl: "https://cdn.example/files/reports/q2" })).toBe(
      "reports",
    );
  });

  test("URL-derived matchers prefer the selected download URL over an embedded source", () => {
    const info = {
      sourceUrl: "https://cdn.example/thumbnail.jpg",
      url: "https://files.example/report.pdf",
      filename: "report.pdf",
    };

    expect(
      matchRules(parseRulesCollecting("urlfileext: ^pdf$\ninto: pdf/:filename:").rules, info),
    ).toBe("pdf/:filename:");
    expect(
      matchRules(
        parseRulesCollecting("naivefilename: ^report\\.pdf$\ninto: pdf/:filename:").rules,
        info,
      ),
    ).toBe("pdf/:filename:");
  });

  test("trace expansion preserves production source URL semantics", async () => {
    const info = { pageUrl: "https://page.example/report", filename: "report.html" };
    const rules = parseRulesCollecting("pageurl: .*\ninto: :sourceurl:").rules;
    const trace = await traceRules(rules, info);
    const runtimePath = await applyVariables(new Path(":sourceurl:"), info);

    expect(trace.expandedDestination).toBe(runtimePath.toString() || null);
    expect(trace.finalPath).toBe(runtimePath.finalize());
  });

  test("trace selects the same fallback rule when a capture destination is empty", async () => {
    const parsed = parseRulesCollecting(
      [
        "sourceurl: example(?:/(foo))?",
        "capture: sourceurl",
        "into: :$1:",
        "",
        "sourceurl: example",
        "into: fallback/:filename:",
      ].join("\n"),
    );
    const info = { sourceUrl: "https://example", filename: "report.pdf" };

    expect(matchRules(parsed.rules, info)).toBe("fallback/:filename:");
    await expect(traceRules(parsed.rules, info)).resolves.toEqual(
      expect.objectContaining({
        selectedRule: 2,
        destination: "fallback/:filename:",
        finalPath: "fallback/report.pdf",
      }),
    );
  });
});
