// Focused plan coverage extracted from the pipeline suite.
import type { SaveInOptions } from "../../src/config/option-schema.ts";
import { DOWNLOAD_TYPES } from "../../src/shared/constants.ts";
import {
  Download,
  downloaded,
  getFilenameFromContentDispositionHeader,
  Log,
  makeState,
  OffscreenClient,
  options,
  Path,
  router,
  routingRule,
  SaveHistory,
  setCurrentBrowser,
  Variable,
} from "./download-flow.fixture.ts";

describe("getFilenameFromContentDisposition", () => {
  test("returns null for non-string input", () => {
    expect(Download.getFilenameFromContentDisposition(undefined)).toBe(null);
    expect(Download.getFilenameFromContentDisposition(123)).toBe(null);
    expect(Download.getFilenameFromContentDisposition(null)).toBe(null);
  });

  test("returns the parser result without decoding it again", () => {
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("na%2520me.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "na%2520me.txt",
    );
  });

  test("keeps filenames with a literal % that is not an escape", () => {
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("50%.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "50%.txt",
    );
  });

  test("preserves percent escapes returned by the parser", () => {
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("%2550%25.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "%2550%25.txt",
    );
  });

  test("returns null when the library returns a falsy value", () => {
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue(null as any);
    expect(Download.getFilenameFromContentDisposition("attachment")).toBe(null);

    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("");
    expect(Download.getFilenameFromContentDisposition("attachment")).toBe(null);
  });
});

describe("getRoutingMatches", () => {
  test("returns null when there are no filename patterns", () => {
    delete (options as Partial<SaveInOptions>).filenamePatterns;
    expect(Download.getRoutingMatches({ info: {}, scratch: {} })).toBe(null);

    options.filenamePatterns = [];
    expect(Download.getRoutingMatches({ info: {}, scratch: {} })).toBe(null);

    expect(router.matchRules).not.toHaveBeenCalled();
  });

  test("skips routing when the caller disables it", () => {
    options.filenamePatterns = [routingRule()];

    expect(Download.getRoutingMatches({ info: { routingDisabled: true }, scratch: {} })).toBeNull();
    expect(router.matchRules).not.toHaveBeenCalled();
  });

  test("delegates to matchRules with the rename-only predicate", () => {
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("the/route");
    const state = { info: { url: "x" }, scratch: {} };

    expect(Download.getRoutingMatches(state)).toBe("the/route");
    // Callers of this seam rename downloads that already started, so rules
    // that rewrite the URL must be skipped rather than match-consuming.
    expect(router.matchRules).toHaveBeenCalledWith(
      options.filenamePatterns,
      state.info,
      router.isRenameOnlyEligibleRule,
    );
  });
});

describe("getRoutingMatch", () => {
  test("returns null without patterns or when routing is disabled", () => {
    options.filenamePatterns = [];
    expect(Download.getRoutingMatch({ info: {} })).toBe(null);

    options.filenamePatterns = [routingRule()];
    expect(Download.getRoutingMatch({ info: { routingDisabled: true } })).toBeNull();
    expect(router.matchRulesDetailed).not.toHaveBeenCalled();
  });

  test("delegates to matchRulesDetailed with every rule eligible", () => {
    options.filenamePatterns = [routingRule()];
    const match = {
      rule: options.filenamePatterns[0]!,
      destination: "the/route",
      fetch: "https://mirror.example/orig.png",
      rename: null,
    };
    vi.mocked(router.matchRulesDetailed).mockReturnValue(match);
    const state = { info: { url: "x" } };

    expect(Download.getRoutingMatch(state)).toBe(match);
    expect(router.matchRulesDetailed).toHaveBeenCalledWith(options.filenamePatterns, state.info);
  });
});

describe("fetch rewrite", () => {
  const fetchMatch = (destination: string, fetch: string) => {
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRulesDetailed).mockReturnValue({
      rule: options.filenamePatterns[0]!,
      destination,
      fetch,
      rename: null,
    });
  };

  test("rewrites the URL, recomputes URL-derived names, and persists both templates", async () => {
    fetchMatch("routed/:naivefilename:", "https://mirror.example/orig.png");
    const state = makeState({ info: { url: "https://cdn.example/small.png" } });

    const plan = await Download.resolveDownloadPlan(state);

    expect(state.info.url).toBe("https://mirror.example/orig.png");
    expect(state.info.naiveFilename).toBe("orig.png");
    expect(state.info.initialFilename).toBe("orig.png");
    expect(state.scratch.routeTemplateRaw).toBe("routed/:naivefilename:");
    expect(state.scratch.fetchTemplateRaw).toBe("https://mirror.example/orig.png");
    // The route expands against the rewritten URL, not the original one.
    expect(plan?.finalFullPath).toBe("downloads/routed/orig.png");
    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://mirror.example/orig.png" }),
      expect.anything(),
    );
  });

  test("invalidates metadata resolved against the original URL", async () => {
    fetchMatch("routed", "https://mirror.example/orig.png");
    const state = makeState({
      scratch: { mimeExtension: "png" },
      info: {
        url: "https://cdn.example/small.png",
        mime: "image/png",
        sha256: "stale-hash",
        resolvedHead: { contentType: "image/png", finalUrl: "https://cdn.example/small.png" },
      },
    });

    await Download.resolveDownloadPlan(state);

    expect(state.info.mime).toBeUndefined();
    expect(state.info.sha256).toBeUndefined();
    // Firefox re-resolves the head against the rewritten URL, so the original
    // URL's resolution must be gone rather than reused.
    expect(state.info.resolvedHead?.finalUrl).not.toBe("https://cdn.example/small.png");
    expect(state.info.mimeExtension).toBeUndefined();
    expect(state.scratch.mimeExtension).toBeUndefined();
  });

  test("falls back to the rewritten URL as the name when it has no path filename", async () => {
    fetchMatch("routed/:naivefilename:", "https://mirror.example/");
    const state = makeState({ info: { url: "https://cdn.example/small.png" } });

    await Download.resolveDownloadPlan(state);

    // A rewrite to a bare host must not leave the download nameless: the URL
    // itself is the last-resort initial filename, matching the original-URL path.
    expect(state.info.naiveFilename).toBe("");
    expect(state.info.initialFilename).toBe("https://mirror.example/");
  });

  test("does not invalidate resolved metadata when the rewrite expands to the same URL", async () => {
    fetchMatch("routed", "https://cdn.example/small.png");
    const state = makeState({
      info: {
        url: "https://cdn.example/small.png",
        sha256: "still-valid-hash",
        resolvedHead: { contentType: "image/png", finalUrl: "https://cdn.example/small.png" },
      },
    });

    const plan = await Download.resolveDownloadPlan(state);

    // The artifacts derived from the URL are only stale when the URL actually
    // changed; a self-targeting fetch: must not throw away the hash or head.
    expect(state.info.url).toBe("https://cdn.example/small.png");
    expect(state.info.sha256).toBe("still-valid-hash");
    expect(state.info.resolvedHead?.finalUrl).toBe("https://cdn.example/small.png");
    // The templates still persist so Chrome's late filename resolution
    // re-expands this rule instead of re-matching.
    expect(state.scratch.routeTemplateRaw).toBe("routed");
    expect(state.scratch.fetchTemplateRaw).toBe("https://cdn.example/small.png");
    expect(plan?.finalFullPath).toBe("downloads/routed");
  });

  test("keeps the original URL when the expanded address is not HTTP(S)", async () => {
    fetchMatch("routed", "https://:$1:/x");
    const state = makeState();

    const plan = await Download.resolveDownloadPlan(state);

    expect(state.info.url).toBe("https://example.com/dir/file.png");
    // Both templates persist even when the rewrite is dropped: Chrome's late
    // filename resolution skips fetch rules, so it must re-expand this rule's
    // destination instead of re-matching and losing the route.
    expect(state.scratch.routeTemplateRaw).toBe("routed");
    expect(state.scratch.fetchTemplateRaw).toBe("https://:$1:/x");
    // The rule still routes; only the rewrite is dropped.
    expect(plan?.finalFullPath).toBe("downloads/routed");
    // The skip is logged with the expanded address so a stray character is
    // diagnosable, not just the unexpanded template.
    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "fetch rewrite skipped: expanded address is not usable HTTP(S)",
      expect.objectContaining({ template: "https://:$1:/x", expanded: "https://:$1:/x" }),
    );
  });

  test("rejects an expansion carrying characters the URL parser would strip", async () => {
    // new URL("https://\t/orig.png") strips the tab and parses with host
    // "orig.png" — the rewrite must fail closed, not retarget the download.
    fetchMatch("routed", "https://\t/orig.png");
    const state = makeState();

    await Download.resolveDownloadPlan(state);

    expect(state.info.url).toBe("https://example.com/dir/file.png");
    expect(state.info.naiveFilename).not.toBe("orig.png");
  });

  test("rejects an expansion whose authority collapsed into a path segment", async () => {
    // "https:///orig.png" WHATWG-parses with host "orig.png" — the rewrite
    // must fail closed instead of silently retargeting to a bogus host.
    fetchMatch("routed", "https:///orig.png");
    const state = makeState();

    await Download.resolveDownloadPlan(state);

    expect(state.info.url).toBe("https://example.com/dir/file.png");
    expect(state.info.naiveFilename).not.toBe("orig.png");
  });

  test("moves Chrome's pending state to the rewritten URL", async () => {
    setCurrentBrowser("CHROME");
    fetchMatch("routed", "https://mirror.example/orig.png");
    const state = makeState({ info: { url: "https://cdn.example/small.png" } });

    await Download.resolveDownloadPlan(state);

    expect(Download.downloadRuntime.pendingStates.has("https://cdn.example/small.png")).toBe(false);
    expect(Download.downloadRuntime.pendingStates.get("https://mirror.example/orig.png")).toEqual([
      state,
    ]);
    // The persisted templates ride the deferred-route machinery so a late
    // filename resolution re-expands this rule instead of re-matching.
    expect(state.scratch.deferredRouteRequirement).toBe(true);
  });

  test("honors a pre-matched automatic fetch template without re-matching", async () => {
    options.filenamePatterns = [routingRule()];
    const state = makeState({
      scratch: {
        routeTemplateRaw: "auto/:naivefilename:",
        fetchTemplateRaw: "https://mirror.example/orig.png",
      },
      info: { url: "https://cdn.example/small.png" },
    });

    const plan = await Download.resolveDownloadPlan(state);

    expect(router.matchRulesDetailed).not.toHaveBeenCalled();
    expect(state.info.url).toBe("https://mirror.example/orig.png");
    expect(plan?.finalFullPath).toBe("downloads/auto/orig.png");
  });
});

describe("rename transform in the plan", () => {
  const renameMatch = (
    destination: string,
    rename: { find: string; flags: string; replacement: string } | null,
    fetch: string | null = null,
  ) => {
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRulesDetailed).mockReturnValue({
      rule: options.filenamePatterns[0]!,
      destination,
      fetch,
      rename,
    });
  };

  test("expands the replacement and renames the plan's final filename component", async () => {
    renameMatch("routed/:filename:", {
      find: "file",
      flags: "",
      replacement: "doc-:sourcedomain:",
    });
    const state = makeState({ info: { url: "https://example.com/dir/file.png" } });

    const plan = await Download.resolveDownloadPlan(state);

    // The capture-substituted template persists for Chrome's late filename
    // resolution; the expanded transform is what finalizeFullPath applied.
    expect(state.scratch.renameTemplate).toEqual({
      find: "file",
      flags: "",
      replacement: "doc-:sourcedomain:",
    });
    expect(state.scratch.renameResolved).toEqual({
      find: "file",
      flags: "",
      replacement: "doc-example.com",
    });
    expect(plan?.finalFullPath).toBe("downloads/routed/doc-example.com.png");
  });

  test("clears stale rename scratch when the winning rule has none", async () => {
    renameMatch("routed", null);
    const state = makeState({
      scratch: {
        renameTemplate: { find: "a", flags: "", replacement: "b" },
        renameResolved: { find: "a", flags: "", replacement: "b" },
      },
    });

    const plan = await Download.resolveDownloadPlan(state);

    expect(state.scratch.renameTemplate).toBeUndefined();
    expect(state.scratch.renameResolved).toBeUndefined();
    expect(plan?.finalFullPath).toBe("downloads/routed");
  });

  test("a rename that strips the extension still gets the MIME-derived one appended", async () => {
    renameMatch("routed/:filename:", { find: "\\.png$", flags: "", replacement: "" });
    options.appendMimeExtension = true;
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("image/png");
    const state = makeState({ info: { url: "https://example.com/dir/file.png" } });

    const plan = await Download.resolveDownloadPlan(state);

    // The tentative extension check sees the renamed component, so the MIME
    // append decision reflects the rename's output rather than the raw route.
    expect(state.scratch.mimeExtension).toBe("png");
    expect(plan?.finalFullPath).toBe("downloads/routed/file.png");
  });

  test("a folder-only route renames the download's own name before the MIME check", async () => {
    renameMatch("routed/", { find: "\\.png$", flags: "", replacement: "" });
    options.appendMimeExtension = true;
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("image/png");
    const state = makeState({ info: { url: "https://example.com/dir/file.png" } });

    const plan = await Download.resolveDownloadPlan(state);

    expect(state.scratch.mimeExtension).toBe("png");
    expect(plan?.finalFullPath).toBe("downloads/routed/file.png");
  });

  test("with fetch:, renames the fetched resource's final name", async () => {
    renameMatch(
      "routed/:naivefilename:",
      // :sourcedomain: must expand against the REWRITTEN URL, proving the
      // rename resolves after the fetch rewrite retargets the download.
      { find: "orig", flags: "", replacement: ":sourcedomain:" },
      "https://mirror.example/orig.png",
    );
    const state = makeState({ info: { url: "https://cdn.example/small.png" } });

    const plan = await Download.resolveDownloadPlan(state);

    expect(state.info.url).toBe("https://mirror.example/orig.png");
    expect(state.scratch.renameResolved?.replacement).toBe("mirror.example");
    expect(plan?.finalFullPath).toBe("downloads/routed/mirror.example.png");
  });
});

describe("finalizeFullPath", () => {
  test("strips a leading ./ and uses the sanitized filename when there is no route", () => {
    vi.mocked(Path.sanitizeFilename).mockReturnValue("sanitized.txt");
    const state = {
      path: { finalize: () => "./some/dir" },
      info: { filename: "raw.txt" },
    };

    expect(Download.finalizeFullPath(state)).toBe("some/dir/sanitized.txt");
    expect(Path.sanitizeFilename).toHaveBeenCalledWith("raw.txt", 240, true, true);
  });

  test("strips a leading / and prefers the route's finalized filename", () => {
    const state = {
      path: { finalize: () => "/abs/dir" },
      route: { finalize: () => "route-file.txt" },
      info: { filename: "raw.txt" },
    };

    expect(Download.finalizeFullPath(state)).toBe("abs/dir/route-file.txt");
  });

  test("keeps a folder route when no resolved filename is available", () => {
    const state = makeState({
      path: new Path.Path("downloads"),
      route: new Path.Path("images/"),
      routeIsFolder: true,
      info: { filename: undefined },
    });

    expect(Download.finalizeFullPath(state)).toBe("downloads/images");
  });
});

describe("renameAndDownload: MIME extension append (§8.1)", () => {
  test("resolves MIME metadata before evaluating a MIME matcher", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = false;
    options.filenamePatterns = [routingRule("mime")];
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("application/pdf");
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.mime === "application/pdf" ? "documents/:filename:" : null,
    );

    const state = makeState({ info: { url: "https://cdn.example.com/report.bin" } });
    await Download.renameAndDownload(state);

    expect(Variable.resolveMime).toHaveBeenCalledWith(state.info);
    expect(router.matchRules).toHaveBeenCalledWith(
      options.filenamePatterns,
      expect.objectContaining({ mime: "application/pdf" }),
    );
    expect(state.route).toBeDefined();
  });

  test("appends the Content-Type extension to an extensionless filename", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("image/jpeg");
    vi.spyOn(Variable, "mimeToExtension").mockImplementation((mime: any) =>
      mime === "image/jpeg" ? "jpg" : "",
    );

    const state = makeState({ info: { url: "https://cdn.example.com/img/12345" } });
    await Download.renameAndDownload(state);

    expect(Variable.resolveMime).toHaveBeenCalledWith(state.info);
    expect(Download.finalizeFullPath(state)).toMatch(/12345\.jpg$/);
  });

  test("makes a MIME-derived extension available before exclusive routing", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    options.routeSkipUnmatched = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("application/pdf");
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("pdf");
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.mimeExtension === "pdf" ? "documents/:filename:" : null,
    );

    const state = makeState({ info: { url: "https://cdn.example.com/download/12345" } });
    await expect(Download.renameAndDownload(state)).resolves.toEqual({
      status: "started",
      downloadId: 101,
    });

    expect(router.matchRules).toHaveBeenCalledWith(
      options.filenamePatterns,
      expect.objectContaining({ mimeExtension: "pdf" }),
    );
    expect(state.route).toBeDefined();
  });

  test("defers the MIME fallback while Chrome still has an existing extension", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("application/pdf");
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("pdf");

    const state = makeState({ info: { url: "https://cdn.example.com/file.pdf" } });
    await Download.renameAndDownload(state);

    expect(Variable.resolveMime).not.toHaveBeenCalled();
    expect(state.info.mimeExtension).toBeUndefined();
  });

  test("skips the HEAD and leaves a filename that already has an extension", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("image/jpeg");
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("jpg");

    const state = makeState({ info: { url: "https://cdn.example.com/img/photo.png" } });
    await Download.renameAndDownload(state);

    expect(Variable.resolveMime).not.toHaveBeenCalled();
    expect(Download.finalizeFullPath(state)).toMatch(/photo\.png$/);
  });

  test("leaves an extensionless name unchanged when MIME has no known extension", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("application/x-unknown");
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("");

    const state = makeState({ info: { url: "https://cdn.example.com/download/12345" } });
    await Download.renameAndDownload(state);

    expect(state.info.mimeExtension).toBeUndefined();
    expect(Download.finalizeFullPath(state)).toMatch(/12345$/);
  });

  test("skips MIME extension lookup for an existing long extension", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("application/manifest+json");
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("json");

    const state = makeState({ info: { url: "https://cdn.example.com/app.webmanifest" } });
    await Download.renameAndDownload(state);

    expect(Variable.resolveMime).not.toHaveBeenCalled();
    expect(Download.finalizeFullPath(state)).toMatch(/app\.webmanifest$/);
  });
});

describe("renameAndDownload: folder-only route (§8.1)", () => {
  test("uses an automatic rule destination without consulting ordinary routing rules", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("ordinary-route/");
    const state = makeState({
      scratch: { routeTemplateRaw: "automatic/:pagedomain:/" },
      info: {
        context: DOWNLOAD_TYPES.AUTO,
        pageUrl: "https://gallery.example/album/",
      },
    });

    await Download.renameAndDownload(state);

    expect(router.matchRules).not.toHaveBeenCalled();
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.routeIsFolder).toBe(true);
    expect(Download.finalizeFullPath(state)).toBe("automatic/gallery.example/file.png");
  });

  test("a trailing-slash into: routes into the folder and keeps the real filename", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("pdfs/");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.routeIsFolder).toBe(true);
    expect(Download.finalizeFullPath(state)).toBe("downloads/pdfs/file.png");
  });

  test("a route without a trailing slash sets the whole name (unchanged)", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("renamed.png");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.routeIsFolder).toBe(false);
    expect(Download.finalizeFullPath(state)).toBe("downloads/renamed.png");
  });
});

describe("renameAndDownload: initial filename resolution", () => {
  test("rejects a state without a download URL", async () => {
    await expect(
      Download.renameAndDownload(makeState({ info: { url: undefined } })),
    ).rejects.toThrow("Download URL is required");
  });

  test("tolerates a Path with no raw template", async () => {
    const state = makeState({ path: new Path.Path(null) });

    await Download.resolveDownloadPlan(state);

    expect(state.scratch.pathTemplateRaw).toBeUndefined();
  });

  test("prefers info.suggestedFilename over the URL-derived filename", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { suggestedFilename: "suggested.txt" } });

    await Download.renameAndDownload(state);

    expect(state.info.naiveFilename).toBe("file.png");
    expect(state.info.initialFilename).toBe("suggested.txt");
    expect(state.info.filename).toBe("suggested.txt");
  });

  test("falls back to the full URL when the URL has no filename component", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { url: "https://example.com/" } });

    await Download.renameAndDownload(state);

    expect(state.info.naiveFilename).toBe("");
    expect(state.info.initialFilename).toBe("https://example.com/");
  });
});

describe("renameAndDownload: needRouteMatch", () => {
  test("returns early without downloading when no route matched", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ needRouteMatch: true });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(downloaded).not.toHaveBeenCalled();
    expect(SaveHistory.addHistoryEntry).not.toHaveBeenCalled();
    expect(Download.downloadRuntime.pendingStates.get(state.info.url) || []).not.toContain(state);
  });

  test("revokes content acquired during planning when route-exclusive skips", async () => {
    setCurrentBrowser("CHROME");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(OffscreenClient, "release").mockResolvedValue(undefined);
    const state = makeState({
      needRouteMatch: true,
      info: {
        contentPromise: Promise.resolve({
          sha256: "hash",
          downloadUrl: "blob:unused-content",
          ownedObjectUrl: "blob:unused-content",
          offscreenRequestId: "unused-request",
        }),
      },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:unused-content");
    expect(OffscreenClient.release).toHaveBeenCalledWith("unused-request");
    expect(state.info.contentPromise).toBeUndefined();
  });

  test("tolerates missing object-URL cleanup support when a route is skipped", async () => {
    setCurrentBrowser("CHROME");
    const revokeObjectURL = URL.revokeObjectURL;
    (URL as any).revokeObjectURL = undefined;
    const state = makeState({
      needRouteMatch: true,
      info: {
        contentPromise: Promise.resolve({
          downloadUrl: "blob:unused-without-cleanup-api",
          ownedObjectUrl: "blob:unused-without-cleanup-api",
        }),
      },
    });

    try {
      await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });
    } finally {
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  test("revokes a generated URL when exclusive routing finds no match", async () => {
    setCurrentBrowser("CHROME");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:exclusive-route-miss");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const url = Download.makeObjectUrl("content");
    const state = makeState({ needRouteMatch: true, info: { url } });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(Download.downloadRuntime.generatedObjectUrls.has(url)).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test("cleans pending state and generated URLs when planning throws", async () => {
    setCurrentBrowser("CHROME");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:abandoned-plan");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const url = Download.makeObjectUrl("content");
    const state = makeState({ info: { url } });
    vi.spyOn(Variable, "applyVariables").mockRejectedValueOnce(new Error("bad variable"));

    await expect(Download.renameAndDownload(state)).rejects.toThrow("bad variable");

    expect(Download.downloadRuntime.pendingStates.get(url) || []).not.toContain(state);
    expect(Download.downloadRuntime.generatedObjectUrls.has(url)).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test("revokes content acquired during planning when planning throws", async () => {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const state = makeState({
      info: {
        contentPromise: Promise.resolve({
          sha256: "hash",
          downloadUrl: "blob:abandoned-content",
          ownedObjectUrl: "blob:abandoned-content",
        }),
      },
    });
    vi.spyOn(Variable, "applyVariables").mockRejectedValueOnce(new Error("bad variable"));

    await expect(Download.renameAndDownload(state)).rejects.toThrow("bad variable");

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:abandoned-content");
    expect(state.info.contentPromise).toBeUndefined();
  });

  test("proceeds when needRouteMatch is true and a route matched", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/route.txt");

    const state = makeState({ needRouteMatch: true });
    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("proceeds when needRouteMatch is false even without a route", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ needRouteMatch: false });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: route matching", () => {
  test("builds state.route from matchRules and uses it in the final path", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/route.txt");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(router.matchRules).toHaveBeenCalledWith(options.filenamePatterns, state.info);
    expect(state.route).toBeDefined();
    expect(String(state.route.finalize())).toBe("matched/route.txt");
    expect(Download.finalizeFullPath(state)).toContain("matched/route.txt");
  });

  test("anchors a click-to-save route at Downloads instead of the previous menu path", async () => {
    setCurrentBrowser("FIREFOX");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("Plants/Trees/:filename:");
    const state = makeState({
      path: new Path.Path("Plants/Trees/Baobabs"),
      info: {
        context: DOWNLOAD_TYPES.CLICK,
        url: "https://example.com/tree.png",
        suggestedFilename: "tree.png",
      },
    });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "Plants/Trees/tree.png" }),
    );
  });
});

describe("renameAndDownload: prompt combinations", () => {
  const expectSaveAs = async (state: any, expected: boolean) => {
    await Download.renameAndDownload(state);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ saveAs: expected }),
    );
  };

  test("options.prompt forces saveAs", async () => {
    setCurrentBrowser("CHROME");
    options.prompt = true;
    await expectSaveAs(makeState(), true);
  });

  test("a destination can force Save As independently", async () => {
    setCurrentBrowser("CHROME");
    await expectSaveAs(makeState({ info: { forcePrompt: true } }), true);
  });

  test("internal companion downloads suppress every prompt source", async () => {
    setCurrentBrowser("CHROME");
    options.prompt = true;
    await expectSaveAs(makeState({ info: { forcePrompt: true, suppressPrompt: true } }), false);
  });

  test("promptIfNoExtension prompts when the final filename has no extension", async () => {
    setCurrentBrowser("CHROME");
    options.promptIfNoExtension = true;
    const state = makeState({ info: { url: "https://example.com/dir/noext" } });
    await expectSaveAs(state, true);
  });

  test("promptOnShift prompts when the Shift modifier was held", async () => {
    setCurrentBrowser("CHROME");
    options.promptOnShift = true;
    const state = makeState({ info: { modifiers: ["Shift"] } });
    await expectSaveAs(state, true);
  });

  test("routeFailurePrompt prompts when no rule matched", async () => {
    setCurrentBrowser("CHROME");
    options.routeFailurePrompt = true;
    await expectSaveAs(makeState(), true);
  });

  test("saveAs is falsy when no prompt condition is met", async () => {
    setCurrentBrowser("CHROME");
    await expectSaveAs(makeState(), false);
  });
});
