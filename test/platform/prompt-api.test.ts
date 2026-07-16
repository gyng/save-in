import {
  hasPromptApi,
  promptAvailability,
  runPrompt,
  type PromptAvailability,
} from "../../src/platform/prompt-api.ts";

type Session = { prompt: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };

const install = (
  availability: PromptAvailability | (() => Promise<PromptAvailability>),
  session?: Session,
): Session => {
  const active: Session = session ?? {
    prompt: vi.fn(async () => "a suggested rule"),
    destroy: vi.fn(),
  };
  Reflect.set(globalThis, "LanguageModel", {
    availability: typeof availability === "function" ? availability : async () => availability,
    create: vi.fn(async () => active),
  });
  return active;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "LanguageModel");
});

describe("prompt-api capability layer", () => {
  test("reports no API and falls back when the global is absent", async () => {
    expect(hasPromptApi()).toBe(false);
    expect(await promptAvailability()).toBe("unavailable");
    expect(await runPrompt("suggest a rule")).toBeNull();
  });

  test.each<[string, unknown]>([
    ["a null global", null],
    ["availability is not a function", { availability: "no", create: () => undefined }],
    ["create is not a function", { availability: async () => "available", create: "no" }],
  ])("ignores a malformed global (%s)", async (_label, shape) => {
    Reflect.set(globalThis, "LanguageModel", shape);
    expect(hasPromptApi()).toBe(false);
    expect(await promptAvailability()).toBe("unavailable");
  });

  test("surfaces the model's availability state verbatim", async () => {
    for (const state of ["downloadable", "downloading", "available"] as const) {
      install(state);
      expect(hasPromptApi()).toBe(true);
      expect(await promptAvailability()).toBe(state);
    }
  });

  test("accepts Chrome's function-shaped LanguageModel global", async () => {
    const model = Object.assign(function LanguageModel() {}, {
      availability: vi.fn(async () => "available" as const),
      create: vi.fn(async () => ({ prompt: vi.fn(), destroy: vi.fn() })),
    });
    Reflect.set(globalThis, "LanguageModel", model);

    expect(hasPromptApi()).toBe(true);
    await expect(promptAvailability()).resolves.toBe("available");
  });

  test("treats a throwing availability() as unavailable, never an error", async () => {
    install(async () => {
      throw new Error("model check failed");
    });
    expect(hasPromptApi()).toBe(true);
    await expect(promptAvailability()).resolves.toBe("unavailable");
  });

  test("runs a prompt and destroys the session when the model is available", async () => {
    const session = install("available");
    await expect(runPrompt("suggest a rule for twitter")).resolves.toBe("a suggested rule");
    expect(session.prompt).toHaveBeenCalledWith("suggest a rule for twitter");
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  test("does not create a session when the model is only downloadable", async () => {
    const session = install("downloadable");
    expect(await runPrompt("suggest a rule")).toBeNull();
    expect(session.prompt).not.toHaveBeenCalled();
  });

  test("allows a user-activated caller to start a downloadable model", async () => {
    const session = install("downloadable");
    await expect(runPrompt("suggest a rule", { allowDownload: true })).resolves.toBe(
      "a suggested rule",
    );
    expect(session.prompt).toHaveBeenCalledWith("suggest a rule");
  });

  test("forwards cancellation and model download progress", async () => {
    const session = install("downloadable");
    const model = Reflect.get(globalThis, "LanguageModel") as {
      create: ReturnType<typeof vi.fn>;
    };
    const controller = new AbortController();
    const progress = vi.fn();
    const pending = runPrompt("suggest a rule", {
      allowDownload: true,
      signal: controller.signal,
      onDownloadProgress: progress,
    });
    await vi.waitFor(() => expect(model.create).toHaveBeenCalled());
    const createOptions = model.create.mock.calls[0]![0]!;
    const addEventListener = vi.fn();
    createOptions.monitor({ addEventListener });
    expect(addEventListener).toHaveBeenCalledWith("downloadprogress", expect.any(Function));
    const listener = addEventListener.mock.calls[0]![1];
    listener({ loaded: 0.42 });

    await expect(pending).resolves.toBe("a suggested rule");
    expect(createOptions.signal).toBe(controller.signal);
    expect(session.prompt).toHaveBeenCalledWith("suggest a rule", { signal: controller.signal });
    expect(progress).toHaveBeenCalledWith(0.42);
  });

  test("destroys the session even when the prompt itself rejects", async () => {
    const session: Session = {
      prompt: vi.fn(async () => {
        throw new Error("inference failed");
      }),
      destroy: vi.fn(),
    };
    install("available", session);
    await expect(runPrompt("suggest a rule")).rejects.toThrow("inference failed");
    expect(session.destroy).toHaveBeenCalledOnce();
  });
});
