// Option-aware reachability for automatic rules: which source kinds a rule
// can match versus which kinds the current discovery options can produce.
import {
  AUTOMATIC_EMPTY_VARIABLES,
  inputDiscoveryDiagnostics,
  matchableSourceKinds,
  producibleSourceKinds,
  readReachabilityOptions,
  REACHABILITY_OPTION_IDS,
  RULE_REACHABILITY_OPTION_IDS,
  ruleReachabilityDiagnostics,
  type ReachabilityOptions,
} from "../../../src/options/core/rule-reachability-model.ts";
import { PAGE_SOURCE_KINDS } from "../../../src/shared/page-source.ts";

const allOff: ReachabilityOptions = {
  autoDownloadEnabled: true,
  autoDownloadLinks: false,
  autoDownloadDocuments: false,
  autoDownloadBackgrounds: false,
  autoDownloadManifests: false,
  autoDownloadDataUrls: false,
};

const automatic = (...extra: Array<{ name: string; value: string | RegExp; flags?: string }>) => [
  { name: "context", value: "^auto$" },
  { name: "pageurl", value: "^https://example\\.test/" },
  ...extra,
  { name: "into", value: "automatic/" },
];

describe("producibleSourceKinds", () => {
  test("embedded media kinds are always producible", () => {
    expect([...producibleSourceKinds(allOff)].toSorted()).toEqual(["audio", "image", "video"]);
  });

  test("documents unlock document and stream; manifests unlock stream", () => {
    expect(producibleSourceKinds({ ...allOff, autoDownloadDocuments: true }).has("document")).toBe(
      true,
    );
    expect(producibleSourceKinds({ ...allOff, autoDownloadDocuments: true }).has("stream")).toBe(
      true,
    );
    expect(producibleSourceKinds({ ...allOff, autoDownloadManifests: true }).has("stream")).toBe(
      true,
    );
    expect(producibleSourceKinds({ ...allOff, autoDownloadManifests: true }).has("document")).toBe(
      false,
    );
  });

  test("link and data gates never add kinds", () => {
    const kinds = producibleSourceKinds({
      ...allOff,
      autoDownloadLinks: true,
      autoDownloadBackgrounds: true,
      autoDownloadDataUrls: true,
    });
    expect(kinds.has("link")).toBe(false);
    expect(kinds.size).toBe(3);
  });

  test("the documents channel admits every kind except plain links", () => {
    // The unreachable-kinds diagnostic assumes any non-link kind has at least
    // one unlocking option; this pins that invariant against admission-table
    // drift (producibility is derived by probing isAdmittedAutomaticSource).
    const producible = producibleSourceKinds({ ...allOff, autoDownloadDocuments: true });
    for (const kind of PAGE_SOURCE_KINDS) {
      expect(producible.has(kind)).toBe(kind !== "link");
    }
  });
});

describe("matchableSourceKinds", () => {
  test("no kind matcher means all kinds", () => {
    expect(matchableSourceKinds(automatic({ name: "sourceurl", value: "cdn" }))).toBeNull();
  });

  test("multiple kind clauses intersect", () => {
    const kinds = matchableSourceKinds(
      automatic(
        { name: "sourcekind", value: "^(stream|document)$" },
        { name: "mediatype", value: "stream" },
      ),
    );
    expect(kinds && [...kinds]).toEqual(["stream"]);
  });

  test("flags apply and a global flag stays stateless across kinds", () => {
    const upper = matchableSourceKinds(
      automatic({ name: "sourcekind", value: "^STREAM$", flags: "i" }),
    );
    expect(upper && [...upper]).toEqual(["stream"]);
    const global = matchableSourceKinds(
      automatic({ name: "sourcekind", value: "image|video", flags: "g" }),
    );
    expect(global && [...global].toSorted()).toEqual(["image", "video"]);
  });

  test("a RegExp clause value and an uncompilable pattern", () => {
    const regexValue = matchableSourceKinds(automatic({ name: "sourcekind", value: /^audio$/ }));
    expect(regexValue && [...regexValue]).toEqual(["audio"]);
    // The validator already reports the broken pattern; it must not constrain.
    expect(matchableSourceKinds(automatic({ name: "sourcekind", value: "(" }))).toBeNull();
  });
});

describe("ruleReachabilityDiagnostics", () => {
  test("non-automatic rules report nothing even with unreachable kinds", () => {
    const clauses = [
      { name: "sourcekind", value: "^stream$" },
      { name: "into", value: "streams/" },
    ];
    expect(ruleReachabilityDiagnostics(clauses, allOff)).toEqual([]);
  });

  test.each([
    ["auto|click", undefined, "an alternation"],
    ["AUTO|CLICK", "i", "a case-insensitive alternation (contexts match lowercased)"],
    [".*", undefined, "a match-everything pattern"],
    ["auto|selection", undefined, "a selection alternation"],
  ])("a mixed context (%s /%s/ — %s) suppresses every diagnostic", (...testCase) => {
    const [context, flags] = testCase;
    // The copy claims the rule cannot run; a rule that still fires on
    // interactive saves must stay silent even with the master switch off,
    // unreachable kinds, and an always-empty variable.
    const clauses = [
      { name: "context", value: context, ...(flags ? { flags } : {}) },
      { name: "pageurl", value: "." },
      { name: "sourcekind", value: "^stream$" },
      { name: "into", value: ":menupath:/streams/" },
    ];
    expect(ruleReachabilityDiagnostics(clauses, { ...allOff, autoDownloadEnabled: false })).toEqual(
      [],
    );
  });

  test("mixed-context suppression survives a Turkish host locale", async () => {
    // The router lowercases contexts locale-insensitively; probing with
    // toLocaleLowerCase would turn CLICK into "clıck" under tr/az and
    // reintroduce the mixed-context false hints for those users.
    const original = String.prototype.toLocaleLowerCase;
    const localeLowerCase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(function (this: string) {
        return original.call(this).replace(/i/g, "ı");
      });
    try {
      vi.resetModules();
      const model = await import("../../../src/options/core/rule-reachability-model.ts");
      const clauses = [
        { name: "context", value: "auto|click" },
        { name: "pageurl", value: "." },
        { name: "sourcekind", value: "^stream$" },
        { name: "into", value: "streams/" },
      ];
      expect(model.ruleReachabilityDiagnostics(clauses, allOff)).toEqual([]);
    } finally {
      localeLowerCase.mockRestore();
      vi.resetModules();
    }
  });

  test("a mixed auto|browser context suppresses every diagnostic", () => {
    // Adopted ordinary browser downloads keep routing through such a rule, so
    // idle/dead hints would be false. The earlier refutation of this case
    // held only for the kind warnings, not the master-switch note — do not
    // "fix" this back to DOWNLOAD_TYPES-only probing.
    const clauses = [
      { name: "context", value: "auto|browser" },
      { name: "pageurl", value: "." },
      { name: "sourcekind", value: "^document$" },
      { name: "into", value: "docs/:menupath:" },
    ];
    expect(ruleReachabilityDiagnostics(clauses, { ...allOff, autoDownloadEnabled: false })).toEqual(
      [],
    );
  });

  test("a never-savable rule withholds the master-switch note", () => {
    // Advice to flip the master switch is pointless when the adjacent
    // warning already says the rule can never save; unlockable kinds keep
    // the note (info first).
    const offMaster = { ...allOff, autoDownloadEnabled: false };
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "sourcekind", value: "^link$" }), offMaster),
    ).toEqual([{ kind: "link-only", level: "warning" }]);
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "sourcekind", value: "^nothing$" }), offMaster),
    ).toEqual([{ kind: "no-kinds", level: "warning" }]);
    expect(
      ruleReachabilityDiagnostics(
        automatic({ name: "sourcekind", value: "^document$" }),
        offMaster,
      ),
    ).toEqual([
      { kind: "automatic-saves-off", level: "info" },
      {
        kind: "unreachable-kinds",
        level: "warning",
        unlockOptions: ["autoDownloadDocuments"],
      },
    ]);
  });

  test("contexts match lowercased, so an uppercase alternative stays exclusive", () => {
    // The router tests the user pattern against lowercase context values;
    // without the i flag, CLICK can never fire and the rule is auto-only.
    const clauses = [
      { name: "context", value: "auto|CLICK" },
      { name: "pageurl", value: "." },
      { name: "sourcekind", value: "^document$" },
      { name: "into", value: "docs/" },
    ];
    expect(ruleReachabilityDiagnostics(clauses, allOff)).toEqual([
      { kind: "unreachable-kinds", level: "warning", unlockOptions: ["autoDownloadDocuments"] },
    ]);
  });

  test("an exclusively automatic context with several clauses still reports", () => {
    // Two context clauses intersect: `auto|click` alone would fire on click,
    // but the second clause excludes every interactive context.
    const clauses = [
      { name: "context", value: "auto|click" },
      { name: "context", value: "^auto$" },
      { name: "pageurl", value: "." },
      { name: "sourcekind", value: "^stream$" },
      { name: "into", value: "streams/" },
    ];
    expect(ruleReachabilityDiagnostics(clauses, allOff)).toEqual([
      {
        kind: "unreachable-kinds",
        level: "warning",
        unlockOptions: ["autoDownloadDocuments", "autoDownloadManifests"],
      },
    ]);
  });

  test("an uncompilable context clause does not defeat the exclusive-auto gate", () => {
    // The validator owns the broken pattern; the probe treats it as
    // constraining nothing, so the intact ^auto$ clause still decides.
    // The broken clause sits first so the probe actually evaluates it before
    // the intact one short-circuits each interactive context.
    const clauses = [
      { name: "context", value: "(" },
      { name: "context", value: "^auto$" },
      { name: "pageurl", value: "." },
      { name: "sourcekind", value: "^stream$" },
      { name: "into", value: "streams/" },
    ];
    expect(ruleReachabilityDiagnostics(clauses, allOff)).toEqual([
      {
        kind: "unreachable-kinds",
        level: "warning",
        unlockOptions: ["autoDownloadDocuments", "autoDownloadManifests"],
      },
    ]);
    // Alone, an uncompilable clause constrains nothing and suppresses.
    expect(
      ruleReachabilityDiagnostics(
        [
          { name: "context", value: "auto(" },
          { name: "pageurl", value: "." },
          { name: "sourcekind", value: "^stream$" },
          { name: "into", value: "streams/" },
        ],
        allOff,
      ),
    ).toEqual([]);
  });

  test("a reachable automatic rule reports nothing", () => {
    expect(ruleReachabilityDiagnostics(automatic(), allOff)).toEqual([]);
    // image stays producible, so one reachable alternative silences the hint.
    expect(
      ruleReachabilityDiagnostics(
        automatic({ name: "sourcekind", value: "^(image|stream)$" }),
        allOff,
      ),
    ).toEqual([]);
  });

  test("the master switch off is information, not a warning", () => {
    expect(
      ruleReachabilityDiagnostics(automatic(), { ...allOff, autoDownloadEnabled: false }),
    ).toEqual([{ kind: "automatic-saves-off", level: "info" }]);
  });

  test("stream-only names both unlocking options; document-only names one", () => {
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "sourcekind", value: "^stream$" }), allOff),
    ).toEqual([
      {
        kind: "unreachable-kinds",
        level: "warning",
        unlockOptions: ["autoDownloadDocuments", "autoDownloadManifests"],
      },
    ]);
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "sourcekind", value: "^document$" }), allOff),
    ).toEqual([
      { kind: "unreachable-kinds", level: "warning", unlockOptions: ["autoDownloadDocuments"] },
    ]);
  });

  test("channels that are already on are never advised", () => {
    // Links and backgrounds are on but cannot supply streams; the advice
    // skips enabled options and still names both stream unlockers.
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "sourcekind", value: "^stream$" }), {
        ...allOff,
        autoDownloadLinks: true,
        autoDownloadBackgrounds: true,
      }),
    ).toEqual([
      {
        kind: "unreachable-kinds",
        level: "warning",
        unlockOptions: ["autoDownloadDocuments", "autoDownloadManifests"],
      },
    ]);
  });

  test("a RegExp-valued template clause is not scanned for variables", () => {
    // Template clauses are strings in parsed rules; the defensive type guard
    // must not treat a RegExp value's source as an expanding template.
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "into", value: /:menupath:/ }), allOff),
    ).toEqual([]);
  });

  test("an unlocked channel clears the warning", () => {
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "sourcekind", value: "^stream$" }), {
        ...allOff,
        autoDownloadManifests: true,
      }),
    ).toEqual([]);
  });

  test("mixed unreachable kinds pick every unlocking option once", () => {
    expect(
      ruleReachabilityDiagnostics(
        automatic({ name: "sourcekind", value: "^(stream|document)$" }),
        allOff,
      ),
    ).toEqual([
      {
        kind: "unreachable-kinds",
        level: "warning",
        unlockOptions: ["autoDownloadDocuments", "autoDownloadManifests"],
      },
    ]);
    // A link alternative alone does not make the rule link-only.
    expect(
      ruleReachabilityDiagnostics(
        automatic({ name: "sourcekind", value: "^(link|stream)$" }),
        allOff,
      ),
    ).toEqual([
      {
        kind: "unreachable-kinds",
        level: "warning",
        unlockOptions: ["autoDownloadDocuments", "autoDownloadManifests"],
      },
    ]);
  });

  test("link-only and impossible kinds get their own diagnostics", () => {
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "sourcekind", value: "^link$" }), allOff),
    ).toEqual([{ kind: "link-only", level: "warning" }]);
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "sourcekind", value: "^pdf$" }), allOff),
    ).toEqual([{ kind: "no-kinds", level: "warning" }]);
  });

  test("always-empty variables in templates are flagged; in matchers they are not", () => {
    expect(
      ruleReachabilityDiagnostics(
        automatic({ name: "fetch", value: "https://cdn.test/:menupath:" }),
        allOff,
      ),
    ).toEqual([{ kind: "empty-variable", level: "warning", variable: ":menupath:" }]);
    expect(
      ruleReachabilityDiagnostics(
        [
          { name: "context", value: "^auto$" },
          { name: "pageurl", value: "." },
          { name: "sourceurl", value: ":menupath:" },
          { name: "into", value: "safe/" },
        ],
        allOff,
      ),
    ).toEqual([]);
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "rename", value: "x -> :menupath:" }), allOff),
    ).toEqual([{ kind: "empty-variable", level: "warning", variable: ":menupath:" }]);
  });

  test("a rename find pattern is a raw regex, not a template", () => {
    // ':menupath:' on the find side is literal text to strip from filenames;
    // variables expand only in the replacement.
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "rename", value: ":menupath: -> x" }), allOff),
    ).toEqual([]);
    // A rename with no separator has no replacement side to analyze.
    expect(
      ruleReachabilityDiagnostics(automatic({ name: "rename", value: ":menupath:" }), allOff),
    ).toEqual([]);
  });

  test("link text and selection text are equally absent from automatic saves", () => {
    expect(AUTOMATIC_EMPTY_VARIABLES).toEqual([":menupath:", ":linktext:", ":selectiontext:"]);
    expect(
      ruleReachabilityDiagnostics(
        automatic({ name: "into", value: ":linktext:/:selectiontext:/" }),
        allOff,
      ),
    ).toEqual([
      { kind: "empty-variable", level: "warning", variable: ":linktext:" },
      { kind: "empty-variable", level: "warning", variable: ":selectiontext:" },
    ]);
  });

  test("diagnostics stack in a stable order", () => {
    expect(
      ruleReachabilityDiagnostics(
        automatic(
          { name: "sourcekind", value: "^stream$" },
          { name: "into", value: ":menupath:/streams/" },
        ),
        { ...allOff, autoDownloadEnabled: false },
      ).map((diagnostic) => diagnostic.kind),
    ).toEqual(["automatic-saves-off", "unreachable-kinds", "empty-variable"]);
  });
});

describe("inputDiscoveryDiagnostics", () => {
  const none = {
    automaticSavesOff: false,
    neverAdopted: false,
    requiresDataGate: false,
  };

  test("non-automatic contexts report nothing", () => {
    expect(inputDiscoveryDiagnostics({ context: "link", sourceKind: "stream" }, allOff)).toBeNull();
    expect(inputDiscoveryDiagnostics({ sourceKind: "stream" }, allOff)).toBeNull();
  });

  test("an automatic stream input names both channel alternatives, case-insensitively", () => {
    expect(inputDiscoveryDiagnostics({ context: "AUTO", sourceKind: "stream" }, allOff)).toEqual({
      ...none,
      channelOptions: ["autoDownloadDocuments", "autoDownloadManifests"],
    });
  });

  test("channel alternatives never exceed the two-option sentence frames", () => {
    // The debugger renders at most two alternatives; more would be dropped
    // silently, so pin the derived list's ceiling.
    for (const kind of PAGE_SOURCE_KINDS) {
      const discovery = inputDiscoveryDiagnostics({ context: "auto", sourceKind: kind }, allOff);
      expect(discovery?.channelOptions.length ?? 0).toBeLessThanOrEqual(2);
    }
  });

  test("a producible kind or enabled gate reports nothing", () => {
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "document" },
        { ...allOff, autoDownloadDocuments: true },
      ),
    ).toBeNull();
    expect(inputDiscoveryDiagnostics({ context: "auto", sourceKind: "image" }, allOff)).toBeNull();
  });

  test("data: detection matches the scan's case-insensitive gate", () => {
    // The scanner uses the shared isDataUrl (/^data:/i); startsWith("data:")
    // would silently drop the required gate advice for pasted DATA: schemes.
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "image", sourceUrl: "DATA:image/png;base64,AA==" },
        allOff,
      ),
    ).toEqual({ ...none, channelOptions: [], requiresDataGate: true });
  });

  test("an over-cap data: payload gets no advice at all", () => {
    // The scan rejects it regardless of any option, so every sentence —
    // channel, gate, or master switch — would be false advice; the debug log
    // already records the oversize skip.
    const overCap = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024 + 1)}`;
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "image", sourceUrl: overCap },
        allOff,
      ),
    ).toBeNull();
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "stream", sourceUrl: overCap },
        { ...allOff, autoDownloadEnabled: false },
      ),
    ).toBeNull();
  });

  // Same reasoning as the over-cap payload above: the scan only ever adopts
  // http(s) and data:, so no option a note could name makes a blob:, an ftp:,
  // or an unparseable URL fire. Advising "turn automatic saves on" for one is
  // the false advice that rule exists to avoid.
  test.each([
    ["blob:https://example.com/9f2c-ab", "blob:"],
    ["ftp://example.com/a.png", "ftp:"],
    ["not a url at all", "an unparseable URL"],
  ])("a source the scan can never adopt (%s) gets no advice at all", (sourceUrl) => {
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "image", sourceUrl },
        { ...allOff, autoDownloadEnabled: false },
      ),
    ).toBeNull();
    expect(
      inputDiscoveryDiagnostics({ context: "auto", sourceKind: "stream", sourceUrl }, allOff),
    ).toBeNull();
  });

  test("an automatic document input names only the documents option", () => {
    expect(inputDiscoveryDiagnostics({ context: "auto", sourceKind: "document" }, allOff)).toEqual({
      ...none,
      channelOptions: ["autoDownloadDocuments"],
    });
  });

  test("the data: gate is conjunctive and stacks with kind gaps", () => {
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "image", sourceUrl: "data:image/png;base64,AA==" },
        allOff,
      ),
    ).toEqual({ ...none, channelOptions: [], requiresDataGate: true });
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "stream", sourceUrl: "data:application/x-mpegurl,#" },
        allOff,
      ),
    ).toEqual({
      ...none,
      channelOptions: ["autoDownloadDocuments", "autoDownloadManifests"],
      requiresDataGate: true,
    });
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "image", sourceUrl: "data:image/png;base64,AA==" },
        { ...allOff, autoDownloadDataUrls: true },
      ),
    ).toBeNull();
  });

  test("a plain link input is never adopted and gets no channel or data advice", () => {
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "link", sourceUrl: "data:text/plain,x" },
        allOff,
      ),
    ).toEqual({ ...none, neverAdopted: true, channelOptions: [] });
  });

  test("the master switch off is reported for parity with the rule cards", () => {
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "image" },
        { ...allOff, autoDownloadEnabled: false },
      ),
    ).toEqual({ ...none, automaticSavesOff: true, channelOptions: [] });
    // An unknown kind string carries no kind note but the master note stays.
    expect(
      inputDiscoveryDiagnostics(
        { context: "auto", sourceKind: "" },
        { ...allOff, autoDownloadEnabled: false },
      ),
    ).toEqual({ ...none, automaticSavesOff: true, channelOptions: [] });
  });
});

describe("readReachabilityOptions", () => {
  test("maps every option id through the injected reader", () => {
    const options = readReachabilityOptions((id) => id === "autoDownloadManifests");
    expect(options).toEqual({
      autoDownloadEnabled: false,
      autoDownloadLinks: false,
      autoDownloadDocuments: false,
      autoDownloadBackgrounds: false,
      autoDownloadManifests: true,
      autoDownloadDataUrls: false,
    });
  });
});

describe("subscription id lists", () => {
  test("rule cards exclude only the data gate", () => {
    // The gate cannot affect a rule-card diagnostic; everything else must
    // stay subscribed or the hints go stale.
    expect(RULE_REACHABILITY_OPTION_IDS).toEqual(
      REACHABILITY_OPTION_IDS.filter((id) => id !== "autoDownloadDataUrls"),
    );
    expect(RULE_REACHABILITY_OPTION_IDS).toHaveLength(REACHABILITY_OPTION_IDS.length - 1);
  });
});
