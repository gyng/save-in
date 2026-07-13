// Focused plan coverage extracted from the pipeline suite.
import type { SaveInOptions } from "../src/config/option-schema.ts";
import {
  Download,
  downloaded,
  getFilenameFromContentDispositionHeader,
  makeState,
  options,
  Path,
  router,
  routingRule,
  SaveHistory,
  setCurrentBrowser,
  Variable,
} from "./download-flow-fixture.ts";

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
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    options.filenamePatterns = [];
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    expect(router.matchRules).not.toHaveBeenCalled();
  });

  test("delegates to matchRules when patterns exist", () => {
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("the/route");
    const state = { info: { url: "x" } };

    expect(Download.getRoutingMatches(state)).toBe("the/route");
    expect(router.matchRules).toHaveBeenCalledWith(options.filenamePatterns, state.info);
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
});

describe("renameAndDownload: MIME extension append (§8.1)", () => {
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
    options.routeExclusive = true;
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

  test("keeps the MIME fallback when Chrome may replace an existing extension", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("application/pdf");
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("pdf");

    const state = makeState({ info: { url: "https://cdn.example.com/file.pdf" } });
    await Download.renameAndDownload(state);

    expect(Variable.resolveMime).toHaveBeenCalledWith(state.info);
    expect(state.info.mimeExtension).toBe("pdf");
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
    expect(SaveHistory.add).not.toHaveBeenCalled();
    expect(Download.pendingStates.get(state.info.url) || []).not.toContain(state);
  });

  test("revokes content acquired during planning when route-exclusive skips", async () => {
    setCurrentBrowser("CHROME");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const state = makeState({
      needRouteMatch: true,
      info: {
        contentPromise: Promise.resolve({
          sha256: "hash",
          downloadUrl: "blob:unused-content",
          ownedObjectUrl: "blob:unused-content",
        }),
      },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:unused-content");
    expect(state.info.contentPromise).toBeUndefined();
  });

  test("cleans pending state and generated URLs when planning throws", async () => {
    setCurrentBrowser("CHROME");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:abandoned-plan");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const url = Download.makeObjectUrl("content");
    const state = makeState({ info: { url } });
    vi.spyOn(Variable, "applyVariables").mockRejectedValueOnce(new Error("bad variable"));

    await expect(Download.renameAndDownload(state)).rejects.toThrow("bad variable");

    expect(Download.pendingStates.get(url) || []).not.toContain(state);
    expect(Download.generatedObjectUrls.has(url)).toBe(false);
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
