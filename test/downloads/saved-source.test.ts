// How the pipeline consults History for the "skip addresses already saved"
// option. The option × context matrix lives in saved-source-model.test.ts;
// this suite covers the lookup's delegation, privacy, and outcome.
import type { RoutingRule, RuleClause } from "../../src/routing/router.ts";
import { DOWNLOAD_TYPES, RULE_TYPES } from "../../src/shared/constants.ts";
import {
  Download,
  Log,
  makeState,
  Notifier,
  options,
  router,
  routingRule,
  SaveHistory,
  Variable,
} from "./download-flow.fixture.ts";
import {
  isSavedSource,
  isShiftPromptRequest,
  mayRewriteDownloadUrl,
  notifySavedSourceSkipped,
} from "../../src/downloads/saved-source.ts";
import { EXTENSION_NOTIFICATION_STREAMS } from "../../src/downloads/notification.ts";

const SAVED_URL = "https://cdn.example/photo.jpg";

const fetchRule = (): RoutingRule => {
  const clauses = [
    { name: "fetch", value: "https://mirror.example/orig.png", type: RULE_TYPES.FETCH },
    { name: "into", value: "routed", type: RULE_TYPES.DESTINATION },
  ] satisfies RuleClause[];
  return clauses as RoutingRule;
};

const historyHolds = (...urls: string[]) =>
  vi
    .mocked(SaveHistory.hasCompletedHistoryUrl)
    .mockImplementation((url) => Promise.resolve(urls.includes(url)));

beforeEach(() => {
  options.skipSavedSources = "all";
});

describe("isSavedSource", () => {
  test("asks History about the address being downloaded", async () => {
    historyHolds(SAVED_URL);

    await expect(isSavedSource(makeState({ info: { url: SAVED_URL } }))).resolves.toBe(true);
    await expect(
      isSavedSource(makeState({ info: { url: "https://cdn.example/other.jpg" } })),
    ).resolves.toBe(false);
    expect(SaveHistory.hasCompletedHistoryUrl).toHaveBeenCalledWith(SAVED_URL);
  });

  test("never reads History for a save the option does not cover", async () => {
    historyHolds(SAVED_URL);
    options.skipSavedSources = "never";
    await expect(isSavedSource(makeState({ info: { url: SAVED_URL } }))).resolves.toBe(false);

    options.skipSavedSources = "automatic";
    await expect(
      isSavedSource(makeState({ info: { url: SAVED_URL, context: DOWNLOAD_TYPES.MEDIA } })),
    ).resolves.toBe(false);

    expect(SaveHistory.hasCompletedHistoryUrl).not.toHaveBeenCalled();

    await expect(
      isSavedSource(makeState({ info: { url: SAVED_URL, context: DOWNLOAD_TYPES.AUTO } })),
    ).resolves.toBe(true);
  });

  test("an isolated private save neither reads History nor is declined by it", async () => {
    historyHolds(SAVED_URL);
    options.persistPrivateActivity = false;
    const privateState = () =>
      makeState({ info: { url: SAVED_URL, currentTab: { incognito: true } } });

    await expect(isSavedSource(privateState())).resolves.toBe(false);
    expect(SaveHistory.hasCompletedHistoryUrl).not.toHaveBeenCalled();

    // With the opt-in, private saves have History rows of their own.
    options.persistPrivateActivity = true;
    await expect(isSavedSource(privateState())).resolves.toBe(true);
  });

  test.each([
    ["a destination that always opens the dialog", { forcePrompt: true }, false, false],
    ["Shift while promptOnShift is on", { modifiers: ["Shift"] }, true, false],
    ["Shift while promptOnShift is off", { modifiers: ["Shift"] }, false, true],
    ["another modifier", { modifiers: ["Ctrl"] }, true, true],
    [
      "a forced dialog the save suppresses",
      { forcePrompt: true, modifiers: ["Shift"], suppressPrompt: true },
      true,
      true,
    ],
  ])("with %s the save is skipped: %s", async (_label, info, promptOnShift, skipped) => {
    historyHolds(SAVED_URL);
    options.promptOnShift = promptOnShift;

    await expect(isSavedSource(makeState({ info: { url: SAVED_URL, ...info } }))).resolves.toBe(
      skipped,
    );
  });

  test("a History re-route is never declined", async () => {
    historyHolds(SAVED_URL);

    await expect(
      isSavedSource(makeState({ scratch: { repeatsSavedSource: true }, info: { url: SAVED_URL } })),
    ).resolves.toBe(false);
    expect(SaveHistory.hasCompletedHistoryUrl).not.toHaveBeenCalled();
  });

  test("a save that already has a History row goes ahead", async () => {
    historyHolds(SAVED_URL);

    await expect(
      isSavedSource(makeState({ scratch: { historyEntryId: "h-1" }, info: { url: SAVED_URL } })),
    ).resolves.toBe(false);
    // A private save's null id is still a decided row, not an absent one.
    await expect(
      isSavedSource(makeState({ scratch: { historyEntryId: null }, info: { url: SAVED_URL } })),
    ).resolves.toBe(false);
  });

  test("an unreadable History lets the save go ahead and is logged", async () => {
    vi.mocked(SaveHistory.hasCompletedHistoryUrl).mockRejectedValue(new Error("storage offline"));

    await expect(isSavedSource(makeState({ info: { url: SAVED_URL } }))).resolves.toBe(false);
    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "saved-source lookup failed",
      "Error: storage offline",
    );
  });
});

describe("mayRewriteDownloadUrl", () => {
  test("is false without a fetch rule or a pre-matched fetch template", () => {
    Reflect.deleteProperty(options, "filenamePatterns");
    expect(mayRewriteDownloadUrl(makeState())).toBe(false);
    options.filenamePatterns = [routingRule()];
    expect(mayRewriteDownloadUrl(makeState())).toBe(false);
  });

  test("is true while any fetch rule could still match", () => {
    options.filenamePatterns = [routingRule(), fetchRule()];
    expect(mayRewriteDownloadUrl(makeState())).toBe(true);
    expect(mayRewriteDownloadUrl(makeState({ info: { routingDisabled: true } }))).toBe(false);
  });

  test("is true for a pre-matched automatic fetch template even with routing disabled", () => {
    expect(
      mayRewriteDownloadUrl(
        makeState({
          scratch: { fetchTemplateRaw: "https://mirror.example/x" },
          info: { routingDisabled: true },
        }),
      ),
    ).toBe(true);
  });
});

describe("isShiftPromptRequest", () => {
  test("needs both the option and the held key", () => {
    options.promptOnShift = true;
    expect(isShiftPromptRequest(makeState({ info: { modifiers: ["Ctrl", "Shift"] } }))).toBe(true);
    expect(isShiftPromptRequest(makeState({ info: { modifiers: [] } }))).toBe(false);
    expect(isShiftPromptRequest(makeState())).toBe(false);
    options.promptOnShift = false;
    expect(isShiftPromptRequest(makeState({ info: { modifiers: ["Shift"] } }))).toBe(false);
  });
});

describe("notifySavedSourceSkipped", () => {
  test("names the address once for a manual save", () => {
    options.notifyOnFailure = true;

    notifySavedSourceSkipped(makeState({ info: { url: SAVED_URL } }));

    expect(Notifier.createExtensionNotification).toHaveBeenCalledExactlyOnceWith(
      "notificationSavedSourceSkippedTitle",
      "notificationSavedSourceSkippedMessage",
      false,
      EXTENSION_NOTIFICATION_STREAMS.SAVED_SOURCE_SKIP,
      { privateContext: false },
    );
  });

  test("passes the address as the message's placeholder", () => {
    options.notifyOnFailure = true;
    const getMessage = vi.fn((key: string) => key);
    Reflect.set(global.browser.i18n, "getMessage", getMessage);

    notifySavedSourceSkipped(makeState({ info: { url: SAVED_URL } }));

    expect(getMessage).toHaveBeenCalledWith("notificationSavedSourceSkippedMessage", [SAVED_URL]);
  });

  test("does not name a private save's address", () => {
    options.notifyOnFailure = true;
    const getMessage = vi.fn((key: string) => key);
    Reflect.set(global.browser.i18n, "getMessage", getMessage);

    notifySavedSourceSkipped(
      makeState({ info: { url: SAVED_URL, currentTab: { incognito: true } } }),
    );

    expect(Notifier.createExtensionNotification).toHaveBeenCalledExactlyOnceWith(
      "notificationSavedSourceSkippedTitle",
      "notificationPrivateSavedSourceSkippedMessage",
      false,
      EXTENSION_NOTIFICATION_STREAMS.SAVED_SOURCE_SKIP,
      { privateContext: true },
    );
    expect(getMessage.mock.calls.flat(2)).not.toContain(SAVED_URL);
  });

  test("stays silent for an automatic save and when failure notices are off", () => {
    options.notifyOnFailure = true;
    notifySavedSourceSkipped(makeState({ info: { url: SAVED_URL, context: DOWNLOAD_TYPES.AUTO } }));
    options.notifyOnFailure = false;
    notifySavedSourceSkipped(makeState({ info: { url: SAVED_URL } }));

    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });
});

describe("the plan declines a saved source", () => {
  test("before any metadata request when no fetch rule can retarget the address", async () => {
    historyHolds(SAVED_URL);
    options.filenamePatterns = [routingRule("mime")];
    const resolveMime = vi.spyOn(Variable, "resolveMime");
    const state = makeState({ info: { url: SAVED_URL } });

    await expect(Download.resolveDownloadPlan(state)).resolves.toBeNull();

    expect(state.scratch.savedSourceSkipped).toBe(true);
    expect(resolveMime).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(router.matchRulesDetailed).not.toHaveBeenCalled();
    expect(SaveHistory.addHistoryEntry).not.toHaveBeenCalled();
    expect(Download.downloadRuntime.pendingStates.get(SAVED_URL) || []).not.toContain(state);
  });

  test("against the rewritten address when a fetch rule retargets the save", async () => {
    const rewritten = "https://mirror.example/orig.png";
    historyHolds(rewritten);
    options.filenamePatterns = [fetchRule()];
    vi.mocked(router.matchRulesDetailed).mockReturnValue({
      outcome: "route",
      rule: options.filenamePatterns[0]!,
      destination: "routed/:naivefilename:",
      fetch: rewritten,
      rename: null,
      tabAction: null,
    });
    const state = makeState({ info: { url: "https://cdn.example/small.png" } });

    await expect(Download.resolveDownloadPlan(state)).resolves.toBeNull();

    expect(SaveHistory.hasCompletedHistoryUrl).toHaveBeenCalledExactlyOnceWith(rewritten);
    expect(state.scratch.savedSourceSkipped).toBe(true);
    expect(SaveHistory.addHistoryEntry).not.toHaveBeenCalled();
  });

  test("not on the original address a fetch rule replaces", async () => {
    const original = "https://cdn.example/small.png";
    historyHolds(original);
    options.filenamePatterns = [fetchRule()];
    vi.mocked(router.matchRulesDetailed).mockReturnValue({
      outcome: "route",
      rule: options.filenamePatterns[0]!,
      destination: "routed/:naivefilename:",
      fetch: "https://mirror.example/orig.png",
      rename: null,
      tabAction: null,
    });
    const state = makeState({ info: { url: original } });

    const plan = await Download.resolveDownloadPlan(state);

    expect(plan).not.toBeNull();
    expect(state.scratch.savedSourceSkipped).toBeUndefined();
  });

  test("clears a stale skip marker when the same state is planned again", async () => {
    const state = makeState({ scratch: { savedSourceSkipped: true }, info: { url: SAVED_URL } });

    await expect(Download.resolveDownloadPlan(state)).resolves.not.toBeNull();

    expect(state.scratch.savedSourceSkipped).toBeUndefined();
  });
});

describe("renameAndDownload with a saved source", () => {
  test("downloads nothing, adds no History row, and tells the user once", async () => {
    historyHolds(SAVED_URL);
    options.notifyOnFailure = true;
    const state = makeState({ info: { url: SAVED_URL, context: DOWNLOAD_TYPES.MEDIA } });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(SaveHistory.addHistoryEntry).not.toHaveBeenCalled();
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(Notifier.createExtensionNotification).toHaveBeenCalledExactlyOnceWith(
      "notificationSavedSourceSkippedTitle",
      "notificationSavedSourceSkippedMessage",
      false,
      EXTENSION_NOTIFICATION_STREAMS.SAVED_SOURCE_SKIP,
      { privateContext: false },
    );
  });

  test("an automatic save is dropped without a notice or a route-miss status", async () => {
    historyHolds(SAVED_URL);
    options.notifyOnFailure = true;
    options.routeSkipUnmatched = true;
    const state = makeState({ info: { url: SAVED_URL, context: DOWNLOAD_TYPES.AUTO } });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(SaveHistory.addHistoryEntry).not.toHaveBeenCalled();
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("saves as before while the option is off", async () => {
    historyHolds(SAVED_URL);
    options.skipSavedSources = "never";

    await expect(
      Download.renameAndDownload(makeState({ info: { url: SAVED_URL } })),
    ).resolves.toEqual({ status: "started", downloadId: 101 });
    expect(SaveHistory.hasCompletedHistoryUrl).not.toHaveBeenCalled();
  });
});
