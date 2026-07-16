// Option-aware reachability for automatic rules: which source kinds a rule
// can match versus which kinds the current discovery options can produce.
import {
  inputDiscoveryUnlockOptions,
  matchableSourceKinds,
  producibleSourceKinds,
  readReachabilityOptions,
  ruleReachabilityDiagnostics,
  type ReachabilityOptions,
} from "../../../src/options/core/rule-reachability-model.ts";

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
    expect([...producibleSourceKinds(allOff)].sort()).toEqual(["audio", "image", "video"]);
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
    expect(global && [...global].sort()).toEqual(["image", "video"]);
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

  test(":menupath: in templates is flagged; in matchers it is not", () => {
    expect(
      ruleReachabilityDiagnostics(
        automatic({ name: "fetch", value: "https://cdn.test/:menupath:" }),
        allOff,
      ),
    ).toEqual([{ kind: "menupath-empty", level: "warning" }]);
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
    ).toEqual([{ kind: "menupath-empty", level: "warning" }]);
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
    ).toEqual(["automatic-saves-off", "unreachable-kinds", "menupath-empty"]);
  });
});

describe("inputDiscoveryUnlockOptions", () => {
  test("non-automatic contexts report nothing", () => {
    expect(
      inputDiscoveryUnlockOptions({ context: "link", sourceKind: "stream" }, allOff),
    ).toBeNull();
    expect(inputDiscoveryUnlockOptions({ sourceKind: "stream" }, allOff)).toBeNull();
  });

  test("an automatic stream input names both unlocking options, case-insensitively", () => {
    expect(inputDiscoveryUnlockOptions({ context: "AUTO", sourceKind: "stream" }, allOff)).toEqual([
      "autoDownloadDocuments",
      "autoDownloadManifests",
    ]);
  });

  test("a producible kind or enabled gate reports nothing", () => {
    expect(
      inputDiscoveryUnlockOptions(
        { context: "auto", sourceKind: "document" },
        {
          ...allOff,
          autoDownloadDocuments: true,
        },
      ),
    ).toBeNull();
    expect(
      inputDiscoveryUnlockOptions({ context: "auto", sourceKind: "image" }, allOff),
    ).toBeNull();
  });

  test("an automatic document input names only the documents option", () => {
    expect(
      inputDiscoveryUnlockOptions({ context: "auto", sourceKind: "document" }, allOff),
    ).toEqual(["autoDownloadDocuments"]);
  });

  test("a data: source with the gate off is named, and stacks with kind gaps", () => {
    expect(
      inputDiscoveryUnlockOptions(
        { context: "auto", sourceKind: "image", sourceUrl: "data:image/png;base64,AA==" },
        allOff,
      ),
    ).toEqual(["autoDownloadDataUrls"]);
    expect(
      inputDiscoveryUnlockOptions(
        { context: "auto", sourceKind: "stream", sourceUrl: "data:application/x-mpegurl,#" },
        allOff,
      ),
    ).toEqual(["autoDownloadDocuments", "autoDownloadManifests", "autoDownloadDataUrls"]);
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
