import {
  MESSAGE_TYPES,
  OptionsManagement,
  Menus,
  router,
  backgroundRuntime,
  onMessage,
  onMessageExternal,
  setupGlobals,
} from "./messaging-fixture.ts";

beforeEach(() => setupGlobals());

describe("config API", () => {
  test("GET_SCHEMA returns option name/type/default/description", () => {
    const sendResponse = vi.fn();
    onMessageExternal({ type: MESSAGE_TYPES.GET_SCHEMA }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.SCHEMA,
      body: {
        version: 1,
        options: [
          { name: "prompt", type: "BOOL", default: false, description: "Always open Save As" },
          { name: "paths", type: "VALUE", default: ".", description: "The menu structure" },
        ],
      },
    });
  });

  test("exposes vocabulary and parser grammars to external integrations", () => {
    const vocabularyResponse = vi.fn();
    onMessageExternal({ type: MESSAGE_TYPES.GET_KEYWORDS }, {}, vocabularyResponse);
    expect(vocabularyResponse.mock.calls[0]![0]!.body).toMatchObject({
      matchers: expect.any(Array),
      variables: [":date:", ":year:"],
      automaticMatchers: expect.arrayContaining(["pagedomain", "sourcekind", "mediatype"]),
      automaticContext: "AUTO",
      sourceKinds: expect.arrayContaining(["image", "document", "link"]),
    });

    const grammarResponse = vi.fn();
    onMessageExternal({ type: MESSAGE_TYPES.GET_GRAMMARS }, {}, grammarResponse);
    const response = grammarResponse.mock.calls[0]![0]!;
    expect(response.type).toBe(MESSAGE_TYPES.GRAMMAR_LIST);
    expect(response.body.version).toBe(1);
    expect(response.body.grammars.map((grammar: { id: string }) => grammar.id)).toEqual([
      "directories",
      "routing",
    ]);
    expect(response.body.grammars[1]).toMatchObject({
      option: "filenamePatterns",
      ebnf: expect.stringContaining("routing-document"),
      examples: expect.arrayContaining([expect.stringContaining("context: ^auto$")]),
    });
  });

  test("VALIDATE dry-runs paths and rules and returns errors + preview", async () => {
    vi.mocked(router.parseRulesCollecting).mockReturnValue({
      rules: [],
      errors: [{ message: "bad rule", error: "bad rule" }],
    });
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(
        { type: MESSAGE_TYPES.VALIDATE, body: { paths: " dogs \n>cats", filenamePatterns: "x" } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(Menus.buildTree).toHaveBeenCalledWith(["dogs", ">cats"]);
    expect(router.parseRulesCollecting).toHaveBeenCalledWith("x");
    const { body } = sendResponse.mock.calls[0]![0]!;
    expect(body.pathErrors).toEqual([]);
    expect(body.ruleErrors).toEqual([{ message: "bad rule", error: "bad rule" }]);
    expect(body.menuPreview).toHaveLength(2);
  });

  test("VALIDATE returns a rule trace when sample download info is supplied", async () => {
    const rules = [{ name: "into", value: "images/:filename:", type: "DESTINATION" }] as any;
    vi.mocked(router.parseRulesCollecting).mockReturnValue({ rules, errors: [] });
    vi.mocked(router.traceRules).mockResolvedValue({ selectedRule: 1 } as any);
    const info = { url: "https://x/cat.jpg", filename: "cat.jpg" };
    const sendResponse = vi.fn();
    expect(
      onMessage(
        { type: MESSAGE_TYPES.VALIDATE, body: { filenamePatterns: "x", info } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(router.traceRules).toHaveBeenCalledWith(rules, info);
    expect(sendResponse.mock.calls[0]![0]!.body.ruleTrace).toEqual({ selectedRule: 1 });
  });

  test("VALIDATE parses and traces unified automatic routing rules", async () => {
    const filenamePatterns = [
      "context: ^auto$",
      "pagedomain: ^example\\.test$",
      "sourcekind: ^image$",
      "into: Images",
    ].join("\n");
    vi.mocked(router.traceRules).mockResolvedValue({
      selectedRule: 1,
      destination: "Images",
    } as any);
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(
        {
          type: MESSAGE_TYPES.VALIDATE,
          body: {
            filenamePatterns,
            automaticCandidate: {
              pageUrl: "https://example.test/gallery",
              sourceUrl: "https://cdn.test/cat.png",
              sourceKind: "image",
            },
          },
        },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(router.traceRules).toHaveBeenCalledWith(
      expect.any(Array),
      {
        context: "AUTO",
        pageUrl: "https://example.test/gallery",
        sourceUrl: "https://cdn.test/cat.png",
        url: "https://cdn.test/cat.png",
        sourceKind: "image",
        mediaType: "image",
      },
      expect.any(Function),
    );
    expect(sendResponse.mock.calls[0]![0]!.body).toMatchObject({
      automaticTrace: { selectedRule: 1, destination: "Images" },
    });
  });

  test("VALIDATE is exposed on the internal listener too", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage({ type: MESSAGE_TYPES.VALIDATE, body: { paths: "dogs" } }, {}, sendResponse),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ type: MESSAGE_TYPES.VALIDATE_RESULT }),
    );
  });

  test("APPLY_CONFIG applies known keys, rejects unknown ones, and resets", async () => {
    const sendResponse = vi.fn();
    onMessage(
      {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { prompt: true, paths: "  images  ", bogus: 1 } },
      },
      {},
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      prompt: true,
      paths: "images", // onSave trimmed it
    });
    expect(backgroundRuntime.reset).toHaveBeenCalled();
    const { body } = sendResponse.mock.calls[0]![0]!;
    expect(body.applied).toEqual({ prompt: true, paths: "images" });
    expect(body.rejected).toEqual([{ name: "bogus", reason: "unknown option" }]);
  });

  test("APPLY_CONFIG atomically rejects a stale expected value", async () => {
    vi.mocked(global.browser.storage.local.get).mockResolvedValueOnce({ prompt: false });
    const sendResponse = vi.fn();
    onMessage(
      {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { prompt: false }, expected: { prompt: true } },
      },
      {},
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(backgroundRuntime.reset).not.toHaveBeenCalled();
    expect(sendResponse.mock.calls[0]![0]!.body).toMatchObject({
      applied: {},
      rejected: [{ name: "prompt", reason: "changed since save" }],
    });
  });

  test("APPLY_CONFIG serializes compare-and-set requests", async () => {
    let storedPrompt = false;
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(global.browser.storage.local.get).mockImplementation(async () => ({
      prompt: storedPrompt,
    }));
    vi.mocked(global.browser.storage.local.set)
      .mockImplementationOnce(async (values) => {
        await firstWrite;
        storedPrompt = values.prompt as boolean;
      })
      .mockImplementationOnce(async (values) => {
        storedPrompt = values.prompt as boolean;
      });

    const firstResponse = vi.fn();
    const secondResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: { prompt: true } } },
      {},
      firstResponse,
    );
    onMessage(
      {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { prompt: false }, expected: { prompt: true } },
      },
      {},
      secondResponse,
    );
    await vi.waitFor(() => expect(global.browser.storage.local.set).toHaveBeenCalledTimes(1));
    releaseFirst();
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalled());

    expect(storedPrompt).toBe(false);
    expect(secondResponse.mock.calls[0]![0]!.body).toMatchObject({
      applied: { prompt: false },
      rejected: [],
    });
  });

  test("APPLY_CONFIG rejects a type mismatch", async () => {
    const sendResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: { prompt: "yes" } } },
      {},
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(sendResponse.mock.calls[0]![0]!.body.rejected).toEqual([
      { name: "prompt", reason: "expected a boolean" },
    ]);
  });

  test("APPLY_CONFIG rejects values outside schema constraints", async () => {
    (OptionsManagement.OPTION_KEYS as unknown as Array<Record<string, unknown>>).push(
      {
        name: "conflictAction",
        type: "VALUE",
        default: "uniquify",
        validate: (value: string) => ["uniquify", "overwrite", "prompt"].includes(value),
      },
      {
        name: "notifyDuration",
        type: "VALUE",
        default: 7000,
        validate: (value: number) => value >= 0,
      },
    );
    const sendResponse = vi.fn();
    onMessage(
      {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { conflictAction: "destroy", notifyDuration: -1 } },
      },
      {},
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(sendResponse.mock.calls[0]![0]!.body.rejected).toEqual([
      { name: "conflictAction", reason: "invalid value" },
      { name: "notifyDuration", reason: "invalid value" },
    ]);
  });

  test("APPLY_CONFIG ignores a malformed config container", () => {
    const sendResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: ["not", "an", "object"] } },
      {},
      sendResponse,
    );

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  test("APPLY_CONFIG is NOT reachable from external extensions", () => {
    const sendResponse = vi.fn();
    onMessageExternal(
      { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: { prompt: true } } },
      {},
      sendResponse,
    );
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    // falls through to the UNKNOWN_TYPE reply
    expect(sendResponse.mock.calls[0]![0]!.body.error).toBe("UNKNOWN_TYPE");
  });
});
