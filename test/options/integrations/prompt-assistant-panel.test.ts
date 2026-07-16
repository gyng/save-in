// @vitest-environment jsdom

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  runPrompt: vi.fn(),
  sendMessage: vi.fn(),
  appendRule: vi.fn(),
}));

vi.mock("../../../src/platform/prompt-api.ts", () => ({
  promptAvailability: mocks.availability,
  runPrompt: mocks.runPrompt,
}));

vi.mock("../../../src/platform/web-extension-api.ts", () => ({
  webExtensionApi: { runtime: { sendMessage: mocks.sendMessage } },
}));

import { setupPromptAssistantPanel } from "../../../src/options/integrations/prompt-assistant-panel.ts";
import * as CssValidation from "../../../src/options/core/css-selector-validation.ts";

const copy: Record<string, string> = {
  promptAssistantStatusOff: "Off — no model checks or prompts",
  promptAssistantStatusChecking: "Checking on-device model…",
  promptAssistantStatusReady: "Ready on this device",
  promptAssistantStatusDownloadable: "The model downloads when you suggest your first rule",
  promptAssistantStatusDownloading: "Chrome is downloading the on-device model",
  promptAssistantStatusUnavailable: "Not available in this browser or on this device",
  promptAssistantStatusUnusable: "The model did not return a usable rule",
  promptAssistantStatusUnusableReview: "The model did not finish checking the draft",
  promptAssistantStatusWorking: "Creating and checking a draft…",
  promptAssistantStatusInvalid: "The draft needs another try: $ERROR$",
  promptAssistantSingleRule: "The draft must contain exactly one rule",
  promptAssistantStatusFailed: "Could not create a draft: $ERROR$",
  promptAssistantStatusDraftReady: "Draft ready — review it before adding",
  promptAssistantStatusAdded: "Added as an unsaved draft in the rules editor",
};

const localize = (key: string, substitutions?: string | number | Array<string | number>) => {
  const value = copy[key] || key;
  const replacement = Array.isArray(substitutions) ? substitutions[0] : substitutions;
  return replacement ? value.replace("$ERROR$", String(replacement)) : value;
};

const markup = () => {
  document.body.innerHTML = `
    <input id="promptAssistantEnabled" type="checkbox">
    <span id="prompt-assistant-status"></span>
    <form id="prompt-assistant-form">
      <textarea id="prompt-assistant-input"></textarea>
      <button id="prompt-assistant-submit" type="submit">Suggest rule</button>
      <button id="prompt-assistant-cancel" type="button" hidden disabled>Cancel</button>
      <progress id="prompt-assistant-progress" max="1" hidden></progress>
    </form>
    <section id="prompt-assistant-result" hidden>
      <pre id="prompt-assistant-rule"></pre>
      <button id="prompt-assistant-add" type="button">Add to rules</button>
      <button id="prompt-assistant-clear" type="button">Clear</button>
    </section>
    <textarea id="filenamePatterns"></textarea>
    <button id="tab-section-dynamic-downloads"></button>
    <button id="rules-mode-text"></button>`;
};

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLElement)) throw new Error(`Missing #${id}`);
  return value as T;
};

const enable = async () => {
  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = true;
  control.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(mocks.availability).toHaveBeenCalled());
};

const setup = () => setupPromptAssistantPanel(localize, { appendRule: mocks.appendRule });

const submitRequest = (request = "Put PNG files in Images") => {
  const input = element<HTMLTextAreaElement>("prompt-assistant-input");
  input.value = request;
  input.dispatchEvent(new InputEvent("input"));
  element<HTMLFormElement>("prompt-assistant-form").dispatchEvent(
    new SubmitEvent("submit", { cancelable: true }),
  );
};

// The model returns the facts of the request; the panel assembles the rule.
// The text below is what assembleRule builds from defaultPlan, spelled out so a
// change to the assembled shape has to be read and agreed to here.
const defaultPlan = { folder: "Images", fileExtensions: ["png"] };
const defaultRule = "fileext/i: ^png$\ninto: Images/:filename:";

const authorResponse = (plan: Record<string, unknown> = defaultPlan) => JSON.stringify(plan);

const critiqueResponse = (
  plan: Record<string, unknown> = defaultPlan,
  accepted = true,
  issues: string[] = [],
) => JSON.stringify({ accepted, issues, repairedPlan: plan });

beforeEach(() => {
  vi.restoreAllMocks();
  markup();
  mocks.availability.mockReset();
  mocks.runPrompt.mockReset();
  mocks.sendMessage.mockReset();
  mocks.appendRule.mockReset();
  mocks.availability.mockResolvedValue("available");
  mocks.runPrompt.mockImplementation(async (prompt: string) =>
    prompt.startsWith("Review one proposed") ? critiqueResponse() : authorResponse(),
  );
  mocks.sendMessage.mockImplementation(async (message: { type: string }) =>
    message.type === "GET_GRAMMARS"
      ? {
          type: "GRAMMAR_LIST",
          body: {
            version: 1,
            grammars: [
              {
                id: "routing",
                option: "filenamePatterns",
                ebnf: "routing grammar",
                semantics: ["one matcher and a destination"],
                examples: ["fileext: png\ninto: Images"],
              },
            ],
          },
        }
      : message.type === "GET_KEYWORDS"
        ? {
            type: "KEYWORD_LIST",
            body: {
              matchers: ["fileext", "pagedomain"],
              variables: ["filename", "pagedomain"],
              automaticMatchers: [],
              automaticContext: "auto",
              sourceKinds: [],
            },
          }
        : { type: "VALIDATE_RESULT", body: { version: 1, ruleErrors: [] } },
  );
});

test("stays inert while the explicit opt-in is off", () => {
  setup();

  expect(mocks.availability).not.toHaveBeenCalled();
  expect(element<HTMLTextAreaElement>("prompt-assistant-input").disabled).toBe(true);
  expect(element("prompt-assistant-status").textContent).toBe("Off — no model checks or prompts");
});

test("enables a global prompt when the local model is ready", async () => {
  setup();
  await enable();

  const input = element<HTMLTextAreaElement>("prompt-assistant-input");
  expect(input.disabled).toBe(false);
  expect(element("prompt-assistant-status").textContent).toBe("Ready on this device");
  input.value = "Put PNG files in Images";
  input.dispatchEvent(new InputEvent("input"));
  expect(element<HTMLButtonElement>("prompt-assistant-submit").disabled).toBe(false);
});

test("generates, validates, and appends only a reviewable draft", async () => {
  setup();
  await enable();
  const input = element<HTMLTextAreaElement>("prompt-assistant-input");
  input.value = "Put PNG files in Images";
  input.dispatchEvent(new InputEvent("input"));
  element<HTMLFormElement>("prompt-assistant-form").dispatchEvent(
    new SubmitEvent("submit", { cancelable: true }),
  );

  await vi.waitFor(() => expect(element("prompt-assistant-result").hidden).toBe(false));
  expect(mocks.runPrompt).toHaveBeenCalledWith(expect.stringContaining(input.value), {
    allowDownload: true,
    signal: expect.any(AbortSignal),
    responseConstraint: expect.any(Object),
    onDownloadProgress: expect.any(Function),
  });
  expect(mocks.runPrompt).toHaveBeenCalledTimes(2);
  // The rule the background validates is assembled here from the model's plan,
  // so it is the same text whatever the model's typing.
  expect(mocks.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "VALIDATE",
      body: { filenamePatterns: defaultRule },
    }),
  );
  expect(element("prompt-assistant-rule").textContent).toBe(defaultRule);
  expect(mocks.appendRule).not.toHaveBeenCalled();

  element<HTMLButtonElement>("prompt-assistant-add").click();
  expect(mocks.appendRule).toHaveBeenCalledWith(
    element<HTMLTextAreaElement>("filenamePatterns"),
    defaultRule,
  );
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
});

test("repairs a drifted plan and independently reviews the repaired rule", async () => {
  // The model can still get the facts wrong; only the syntax is out of its
  // hands now.
  const drifted = { folder: "Images", fileExtensions: ["png", "jpg"] };
  const repairedPlan = { folder: "dongs", fileExtensions: ["png"] };
  const repaired = "fileext/i: ^png$\ninto: dongs/:filename:";
  mocks.runPrompt
    .mockResolvedValueOnce(authorResponse(drifted))
    .mockResolvedValueOnce(
      critiqueResponse(repairedPlan, false, ["JPEG and Images were not requested"]),
    )
    .mockResolvedValueOnce(critiqueResponse(repairedPlan));
  setup();
  await enable();

  submitRequest("save png into /dongs");

  await vi.waitFor(() =>
    expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(false),
  );
  expect(mocks.runPrompt).toHaveBeenCalledTimes(3);
  expect(element("prompt-assistant-rule").textContent).toBe(repaired);
  expect(mocks.sendMessage).toHaveBeenCalledWith({
    type: "VALIDATE",
    body: { filenamePatterns: repaired },
  });
});

test("keeps a valid but semantically rejected repair out of the editor", async () => {
  const drifted = { folder: "Images", fileExtensions: ["png", "jpg"] };
  const incompletePlan = { folder: "dongs", fileExtensions: ["png", "jpg"] };
  const incompleteRepair = "fileext/i: ^(?:png|jpg)$\ninto: dongs/:filename:";
  mocks.runPrompt
    .mockResolvedValueOnce(authorResponse(drifted))
    .mockResolvedValueOnce(
      critiqueResponse(incompletePlan, false, ["The destination was incorrect"]),
    )
    .mockResolvedValueOnce(
      critiqueResponse({ folder: "dongs", fileExtensions: ["png"] }, false, [
        "JPEG is still included",
      ]),
    );
  setup();
  await enable();

  submitRequest("save png into /dongs");

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element("prompt-assistant-rule").textContent).toBe(incompleteRepair);
  expect(element("prompt-assistant-status").textContent).toContain("unrequested file types");
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
  expect(mocks.appendRule).not.toHaveBeenCalled();
});

test("rejects a malformed structured semantic review", async () => {
  mocks.runPrompt
    .mockResolvedValueOnce(authorResponse())
    .mockResolvedValueOnce(JSON.stringify({ accepted: true, issues: [] }));
  setupPromptAssistantPanel(() => "", { appendRule: mocks.appendRule });
  await enable();

  submitRequest();

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element("prompt-assistant-status").textContent).toContain(
    "did not finish checking the draft",
  );
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
});

test("rejects an absent structured semantic review", async () => {
  mocks.runPrompt.mockResolvedValueOnce(authorResponse()).mockResolvedValueOnce(null);
  setupPromptAssistantPanel(() => "", { appendRule: mocks.appendRule });
  await enable();

  submitRequest();

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element("prompt-assistant-status").textContent).toContain(
    "did not finish checking the draft",
  );
});

test("rejects an absent final structured review", async () => {
  mocks.runPrompt
    .mockResolvedValueOnce(authorResponse())
    .mockResolvedValueOnce(critiqueResponse(defaultPlan, false, ["Review again"]))
    .mockResolvedValueOnce(null);
  setupPromptAssistantPanel(() => "", { appendRule: mocks.appendRule });
  await enable();

  submitRequest();

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element("prompt-assistant-status").textContent).toContain(
    "did not finish checking the draft",
  );
});

test.each([
  [["Final review concern"], ["Initial review concern"], "Final review concern"],
  [[], ["Initial review concern"], "Initial review concern"],
  [[], [], "The draft does not match the request"],
] as const)(
  "uses the best available semantic-review diagnostic %#",
  async (finalIssues, initialIssues, expected) => {
    mocks.runPrompt
      .mockResolvedValueOnce(authorResponse())
      .mockResolvedValueOnce(critiqueResponse(defaultPlan, false, [...initialIssues]))
      .mockResolvedValueOnce(critiqueResponse(defaultPlan, false, [...finalIssues]));
    setup();
    await enable();

    submitRequest();

    await vi.waitFor(() =>
      expect(element("prompt-assistant-status").textContent).toContain(expected),
    );
    expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
  },
);

test("accepts a validation response with no diagnostic list", async () => {
  const defaultSend = mocks.sendMessage.getMockImplementation();
  mocks.sendMessage.mockImplementation(async (message: { type: string }) =>
    message.type === "VALIDATE"
      ? { type: "VALIDATE_RESULT", body: { version: 1 } }
      : defaultSend?.(message),
  );
  setup();
  await enable();

  submitRequest();

  await vi.waitFor(() =>
    expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(false),
  );
});

test("shows an invalid suggestion but does not let it enter the editor", async () => {
  mocks.sendMessage.mockImplementation(async (message: { type: string }) =>
    message.type === "GET_GRAMMARS"
      ? {
          type: "GRAMMAR_LIST",
          body: {
            version: 1,
            grammars: [
              {
                id: "routing",
                option: "filenamePatterns",
                ebnf: "routing grammar",
                semantics: [],
                examples: [],
              },
            ],
          },
        }
      : message.type === "GET_KEYWORDS"
        ? {
            type: "KEYWORD_LIST",
            body: {
              matchers: ["fileext"],
              variables: ["filename"],
              automaticMatchers: [],
              automaticContext: "auto",
              sourceKinds: [],
            },
          }
        : {
            type: "VALIDATE_RESULT",
            body: {
              version: 1,
              ruleErrors: [{ message: "Missing destination", error: "into" }],
            },
          },
  );
  setup();
  await enable();
  const input = element<HTMLTextAreaElement>("prompt-assistant-input");
  input.value = "Make a broken rule";
  input.dispatchEvent(new InputEvent("input"));
  element<HTMLFormElement>("prompt-assistant-form").dispatchEvent(
    new SubmitEvent("submit", { cancelable: true }),
  );

  await vi.waitFor(() =>
    expect(element("prompt-assistant-status").textContent).toContain("Missing destination"),
  );
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
  expect(mocks.appendRule).not.toHaveBeenCalled();
});

test("rejects invalid generated CSS before background validation", async () => {
  vi.spyOn(CssValidation, "cssSelectorErrors").mockReturnValue([
    { message: "Invalid CSS selector", error: ":save-in-unknown" },
  ]);
  setupPromptAssistantPanel(() => "", { appendRule: mocks.appendRule });
  await enable();
  const input = element<HTMLTextAreaElement>("prompt-assistant-input");
  input.value = "Use a CSS selector";
  input.dispatchEvent(new InputEvent("input"));
  element<HTMLFormElement>("prompt-assistant-form").dispatchEvent(
    new SubmitEvent("submit", { cancelable: true }),
  );

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
  expect(mocks.sendMessage.mock.calls.some(([message]) => message.type === "VALIDATE")).toBe(false);
  expect(mocks.appendRule).not.toHaveBeenCalled();
});

// A blank line is what separates two rules, so a plan value carrying one is
// how a second rule could reach the editor. The assembler refuses the plan
// instead, and nothing is validated or shown.
test("rejects a plan whose value would open a second rule", async () => {
  const smuggled = { folder: "Images/\n\nfileext: ^jpg$\ninto: Photos", fileExtensions: ["png"] };
  mocks.runPrompt.mockResolvedValueOnce(authorResponse(smuggled));
  setup();
  await enable();

  submitRequest("Sort images");

  await vi.waitFor(() =>
    expect(element("prompt-assistant-status").textContent).toContain(
      "did not return a usable rule",
    ),
  );
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
  expect(mocks.sendMessage.mock.calls.some(([message]) => message.type === "VALIDATE")).toBe(false);
});

test("rechecks availability while the on-device model is downloading", async () => {
  vi.useFakeTimers();
  try {
    mocks.availability.mockResolvedValueOnce("downloading").mockResolvedValueOnce("available");
    setup();
    const control = element<HTMLInputElement>("promptAssistantEnabled");
    control.checked = true;
    control.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(0);
    expect(element("prompt-assistant-status").textContent).toContain("downloading");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.availability).toHaveBeenCalledTimes(2);
    expect(element("prompt-assistant-status").textContent).toBe("Ready on this device");
  } finally {
    vi.useRealTimers();
  }
});

test("stops a pending availability recheck when the assistant is disabled", async () => {
  vi.useFakeTimers();
  try {
    mocks.availability.mockResolvedValue("downloading");
    setup();
    const control = element<HTMLInputElement>("promptAssistantEnabled");
    control.checked = true;
    control.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(0);

    control.checked = false;
    control.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.availability).toHaveBeenCalledTimes(1);
    expect(element("prompt-assistant-status").dataset.state).toBe("off");
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  "promptAssistantEnabled",
  "prompt-assistant-status",
  "prompt-assistant-form",
  "prompt-assistant-input",
  "prompt-assistant-submit",
  "prompt-assistant-cancel",
  "prompt-assistant-progress",
  "prompt-assistant-result",
  "prompt-assistant-rule",
  "prompt-assistant-add",
  "prompt-assistant-clear",
])("stays inert when #%s is absent", (id) => {
  document.getElementById(id)?.remove();
  expect(() => setup()).not.toThrow();
  expect(mocks.availability).not.toHaveBeenCalled();
});

test.each([
  ["downloadable", "The model downloads when you suggest your first rule", false],
  ["downloading", "Chrome is downloading the on-device model", true],
  ["unavailable", "Not available in this browser or on this device", true],
] as const)("renders the %s availability state", async (availability, status, disabled) => {
  mocks.availability.mockResolvedValue(availability);
  setupPromptAssistantPanel(() => "", { appendRule: mocks.appendRule });
  await enable();

  expect(element("prompt-assistant-status").textContent).toBe(status);
  const input = element<HTMLTextAreaElement>("prompt-assistant-input");
  input.value = "Make a rule";
  input.dispatchEvent(new InputEvent("input"));
  expect(element<HTMLButtonElement>("prompt-assistant-submit").disabled).toBe(disabled);
});

test("reports empty model output as an unusable draft, not as lost availability", async () => {
  mocks.runPrompt.mockResolvedValue("");
  setup();
  await enable();
  submitRequest();

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element("prompt-assistant-status").textContent).toContain(
    "The model did not return a usable rule",
  );
  expect(element("prompt-assistant-status").textContent).not.toContain("Not available");
});

// The repair pass is model output too, so its plan is assembled under the same
// rules rather than being trusted because a critique produced it.
test("refuses a repaired plan the assembler cannot express exactly", async () => {
  mocks.runPrompt.mockImplementation(async (prompt: string) =>
    prompt.startsWith("Review one proposed")
      ? critiqueResponse({ folder: "dongs", sourceKind: "photo" }, false, ["wrong matcher"])
      : authorResponse(),
  );
  setup();
  await enable();
  submitRequest("save png into /dongs");

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element("prompt-assistant-status").textContent).toContain(
    "The model did not return a usable rule",
  );
});

// A plan with no matcher would assemble a rule that routes every download.
test("refuses a draft plan that would silently match every download", async () => {
  mocks.runPrompt.mockImplementation(async (prompt: string) =>
    prompt.startsWith("Review one proposed")
      ? critiqueResponse()
      : authorResponse({ folder: "dongs" }),
  );
  setup();
  await enable();
  submitRequest("save png into /dongs");

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
  expect(mocks.appendRule).not.toHaveBeenCalled();
});

test("accepts a reviewer that agrees but describes the plan differently", async () => {
  mocks.runPrompt.mockResolvedValueOnce(authorResponse()).mockResolvedValueOnce(
    // The same rule, spelled the way a small model varies run to run. Agreement
    // is decided on what the plans assemble to, not on how they were written.
    critiqueResponse({ folder: "/Images/", fileExtensions: [".PNG"] }),
  );
  setup();
  await enable();
  submitRequest();

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("success"));
  // The reviewed rule, not the reviewer's restatement of it.
  expect(element("prompt-assistant-rule").textContent).toBe(defaultRule);
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(false);
  // Agreement reached without spending a repair and a second review on spacing.
  expect(mocks.runPrompt).toHaveBeenCalledTimes(2);
});

test("supports an initially enabled control and turning the assistant off", async () => {
  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = true;
  setup();
  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("ready"));

  control.checked = false;
  control.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("off"));
  expect(element<HTMLTextAreaElement>("prompt-assistant-input").disabled).toBe(true);
});

test("ignores a stale availability result after the control is disabled", async () => {
  let resolveAvailability!: (value: string) => void;
  mocks.availability.mockReturnValue(
    new Promise((resolve) => {
      resolveAvailability = resolve;
    }),
  );
  setup();
  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = true;
  control.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(mocks.availability).toHaveBeenCalled());
  control.checked = false;
  control.dispatchEvent(new Event("change"));
  resolveAvailability("available");

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("off"));
});

test("clear removes a generated draft and focuses the request", async () => {
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() => expect(element("prompt-assistant-result").hidden).toBe(false));

  element<HTMLButtonElement>("prompt-assistant-clear").click();
  expect(element("prompt-assistant-result").hidden).toBe(true);
  expect(element("prompt-assistant-rule").textContent).toBe("");
  expect(document.activeElement).toBe(element("prompt-assistant-input"));
});

test("a disabled submit and add button remain inert", () => {
  setup();
  element<HTMLFormElement>("prompt-assistant-form").dispatchEvent(
    new SubmitEvent("submit", { cancelable: true }),
  );
  element<HTMLButtonElement>("prompt-assistant-add").click();

  expect(mocks.sendMessage).not.toHaveBeenCalled();
  expect(mocks.appendRule).not.toHaveBeenCalled();
});

test.each(["missing-list", "missing-routing", "missing-vocabulary"])(
  "reports a %s authoring metadata failure",
  async (failure) => {
    mocks.sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_GRAMMARS") {
        if (failure === "missing-list") return { type: "ERROR", body: { status: "ERROR" } };
        return {
          type: "GRAMMAR_LIST",
          body: {
            version: 1,
            grammars:
              failure === "missing-routing"
                ? []
                : [
                    {
                      id: "routing",
                      option: "filenamePatterns",
                      ebnf: "grammar",
                      semantics: [],
                      examples: [],
                    },
                  ],
          },
        };
      }
      return { type: "ERROR", body: { status: "ERROR" } };
    });
    setup();
    await enable();
    submitRequest();

    await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
    expect(element("prompt-assistant-status").textContent).toContain(
      failure === "missing-vocabulary" ? "vocabulary" : "grammar",
    );
  },
);

test.each([
  ["empty output", () => mocks.runPrompt.mockResolvedValue("")],
  [
    "invalid validation response",
    () =>
      mocks.sendMessage.mockImplementation(async (message: { type: string }) =>
        message.type === "VALIDATE"
          ? { type: "ERROR", body: { status: "ERROR" } }
          : message.type === "GET_GRAMMARS"
            ? {
                type: "GRAMMAR_LIST",
                body: {
                  version: 1,
                  grammars: [
                    {
                      id: "routing",
                      option: "filenamePatterns",
                      ebnf: "grammar",
                      semantics: [],
                      examples: [],
                    },
                  ],
                },
              }
            : {
                type: "KEYWORD_LIST",
                body: {
                  matchers: ["fileext", "pagedomain"],
                  variables: [],
                  automaticMatchers: [],
                  sourceKinds: [],
                },
              },
      ),
  ],
] as const)("reports %s", async (_label, arrange) => {
  arrange();
  setupPromptAssistantPanel(() => "", { appendRule: mocks.appendRule });
  await enable();
  submitRequest();

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("error"));
  expect(element("prompt-assistant-status").textContent).toContain("Could not create a draft");
});

test("disabling during generation discards the stale completion", async () => {
  let resolvePrompt!: (value: string) => void;
  mocks.runPrompt.mockReturnValue(
    new Promise((resolve) => {
      resolvePrompt = resolve;
    }),
  );
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() => expect(mocks.runPrompt).toHaveBeenCalled());
  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = false;
  control.dispatchEvent(new Event("change"));
  resolvePrompt(authorResponse());

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("off"));
  expect(element("prompt-assistant-result").hidden).toBe(true);
});

test("shows bounded download progress while Chrome prepares the model", async () => {
  let resolvePrompt!: (value: string) => void;
  mocks.runPrompt.mockReturnValue(
    new Promise((resolve) => {
      resolvePrompt = resolve;
    }),
  );
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() => expect(mocks.runPrompt).toHaveBeenCalled());
  const options = mocks.runPrompt.mock.calls[0]![1];
  options.onDownloadProgress(0.4);

  const progress = element<HTMLProgressElement>("prompt-assistant-progress");
  expect(progress.hidden).toBe(false);
  expect(progress.value).toBe(0.4);
  expect(element("prompt-assistant-status").textContent).toBe(
    "Chrome is downloading the on-device model",
  );

  options.onDownloadProgress(1.4);
  expect(progress.hasAttribute("value")).toBe(false);
  expect(element("prompt-assistant-status").textContent).toBe("Creating and checking a draft…");

  resolvePrompt(authorResponse());
  await vi.waitFor(() => expect(progress.hidden).toBe(true));
  expect(progress.hasAttribute("value")).toBe(false);
});

test("cancel aborts the active model request and restores ready controls", async () => {
  let signal: AbortSignal | undefined;
  let reportProgress: ((loaded: number) => void) | undefined;
  mocks.runPrompt.mockImplementation(
    (_input: string, options: { signal?: AbortSignal; onDownloadProgress?: (n: number) => void }) =>
      new Promise((_resolve, reject) => {
        signal = options.signal;
        reportProgress = options.onDownloadProgress;
        options.onDownloadProgress?.(0.25);
        signal?.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")));
      }),
  );
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() => expect(mocks.runPrompt).toHaveBeenCalled());
  await vi.waitFor(() =>
    expect(element<HTMLButtonElement>("prompt-assistant-cancel").hidden).toBe(false),
  );

  element<HTMLButtonElement>("prompt-assistant-cancel").click();

  expect(signal?.aborted).toBe(true);
  expect(element<HTMLButtonElement>("prompt-assistant-cancel").hidden).toBe(true);
  expect(element<HTMLTextAreaElement>("prompt-assistant-input").disabled).toBe(false);
  expect(element("prompt-assistant-form").getAttribute("aria-busy")).toBe("false");
  expect(element("prompt-assistant-status").textContent).toBe("Ready on this device");
  reportProgress?.(0.75);
  expect(element("prompt-assistant-status").textContent).toBe("Ready on this device");
});

test("cancel restores the downloadable availability state", async () => {
  mocks.availability.mockResolvedValue("downloadable");
  mocks.runPrompt.mockReturnValue(new Promise(() => {}));
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() =>
    expect(element<HTMLButtonElement>("prompt-assistant-cancel").hidden).toBe(false),
  );

  element<HTMLButtonElement>("prompt-assistant-cancel").click();
  expect(element("prompt-assistant-status").textContent).toBe(
    "The model downloads when you suggest your first rule",
  );
});

test("cancel before authoring metadata arrives never starts the model", async () => {
  let resolveGrammar!: (value: unknown) => void;
  mocks.sendMessage.mockImplementation((message: { type: string }) => {
    if (message.type === "GET_GRAMMARS") {
      return new Promise((resolve) => {
        resolveGrammar = resolve;
      });
    }
    return Promise.resolve({
      type: "KEYWORD_LIST",
      body: {
        matchers: ["fileext", "pagedomain"],
        variables: [],
        automaticMatchers: [],
        sourceKinds: [],
      },
    });
  });
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() =>
    expect(element<HTMLButtonElement>("prompt-assistant-cancel").hidden).toBe(false),
  );

  element<HTMLButtonElement>("prompt-assistant-cancel").click();
  resolveGrammar({
    type: "GRAMMAR_LIST",
    body: {
      version: 1,
      grammars: [
        { id: "routing", option: "filenamePatterns", ebnf: "grammar", semantics: [], examples: [] },
      ],
    },
  });

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("ready"));
  expect(mocks.runPrompt).not.toHaveBeenCalled();
});

test("disabling during validation discards the stale validation result", async () => {
  let resolveValidation!: (value: unknown) => void;
  mocks.sendMessage.mockImplementation(async (message: { type: string }) => {
    if (message.type === "VALIDATE") {
      return new Promise((resolve) => {
        resolveValidation = resolve;
      });
    }
    if (message.type === "GET_GRAMMARS") {
      return {
        type: "GRAMMAR_LIST",
        body: {
          version: 1,
          grammars: [
            {
              id: "routing",
              option: "filenamePatterns",
              ebnf: "grammar",
              semantics: [],
              examples: [],
            },
          ],
        },
      };
    }
    return {
      type: "KEYWORD_LIST",
      body: {
        matchers: ["fileext", "pagedomain"],
        variables: [],
        automaticMatchers: [],
        sourceKinds: [],
      },
    };
  });
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() =>
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "VALIDATE" })),
  );
  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = false;
  control.dispatchEvent(new Event("change"));
  resolveValidation({ type: "VALIDATE_RESULT", body: { version: 1, ruleErrors: [] } });

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("off"));
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
});

test("disabling during semantic critique discards the stale review", async () => {
  let resolveCritique!: (value: string) => void;
  mocks.runPrompt
    .mockResolvedValueOnce(authorResponse())
    .mockReturnValueOnce(new Promise((resolve) => (resolveCritique = resolve)));
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() => expect(mocks.runPrompt).toHaveBeenCalledTimes(2));

  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = false;
  control.dispatchEvent(new Event("change"));
  resolveCritique(critiqueResponse());

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("off"));
  expect(element("prompt-assistant-result").hidden).toBe(true);
});

test("disabling during repaired-rule validation discards the stale result", async () => {
  let resolveValidation!: (value: unknown) => void;
  let validationCount = 0;
  const defaultSend = mocks.sendMessage.getMockImplementation();
  mocks.sendMessage.mockImplementation(async (message: { type: string }) => {
    if (message.type !== "VALIDATE") return defaultSend?.(message);
    validationCount += 1;
    if (validationCount === 1) {
      return { type: "VALIDATE_RESULT", body: { version: 1, ruleErrors: [] } };
    }
    return new Promise((resolve) => (resolveValidation = resolve));
  });
  mocks.runPrompt
    .mockResolvedValueOnce(authorResponse())
    .mockResolvedValueOnce(critiqueResponse(defaultPlan, false, ["Review again"]));
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() => expect(validationCount).toBe(2));

  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = false;
  control.dispatchEvent(new Event("change"));
  resolveValidation({ type: "VALIDATE_RESULT", body: { version: 1, ruleErrors: [] } });

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("off"));
  expect(mocks.runPrompt).toHaveBeenCalledTimes(2);
});

test("disabling during final semantic review discards the stale result", async () => {
  let resolveFinalReview!: (value: string) => void;
  mocks.runPrompt
    .mockResolvedValueOnce(authorResponse())
    .mockResolvedValueOnce(critiqueResponse(defaultPlan, false, ["Review again"]))
    .mockReturnValueOnce(new Promise((resolve) => (resolveFinalReview = resolve)));
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() => expect(mocks.runPrompt).toHaveBeenCalledTimes(3));

  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = false;
  control.dispatchEvent(new Event("change"));
  resolveFinalReview(critiqueResponse());

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("off"));
  expect(element("prompt-assistant-result").hidden).toBe(true);
});

test("disabling while metadata rejects suppresses the stale failure", async () => {
  let rejectGrammar!: (error: Error) => void;
  mocks.sendMessage.mockImplementation((message: { type: string }) =>
    message.type === "GET_GRAMMARS"
      ? new Promise((_resolve, reject) => {
          rejectGrammar = reject;
        })
      : Promise.resolve({
          type: "KEYWORD_LIST",
          body: {
            matchers: ["fileext", "pagedomain"],
            variables: [],
            automaticMatchers: [],
            sourceKinds: [],
          },
        }),
  );
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
  const control = element<HTMLInputElement>("promptAssistantEnabled");
  control.checked = false;
  control.dispatchEvent(new Event("change"));
  rejectGrammar(new Error("late failure"));

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("off"));
});

test("add refuses a vanished editor after a draft validates", async () => {
  setup();
  await enable();
  submitRequest();
  await vi.waitFor(() =>
    expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(false),
  );
  element("filenamePatterns").remove();
  element<HTMLButtonElement>("prompt-assistant-add").click();
  expect(mocks.appendRule).not.toHaveBeenCalled();
});

test("keeps a draft the reviewer approved, however it retyped the plan", async () => {
  // Measured against the on-device model: asked to review a correct png plan it
  // answered accepted with a repairedPlan naming the folder as the site and
  // adding a category. An approval is an approval of the candidate; the repair
  // is what the reviewer offers when it declines.
  mocks.runPrompt.mockResolvedValueOnce(authorResponse()).mockResolvedValueOnce(
    JSON.stringify({
      accepted: true,
      issues: [],
      repairedPlan: { folder: "Images", fileExtensions: ["png"], site: "Images" },
    }),
  );
  setup();
  await enable();
  submitRequest();

  await vi.waitFor(() => expect(element("prompt-assistant-status").dataset.state).toBe("success"));
  expect(element("prompt-assistant-rule").textContent).toBe(defaultRule);
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(false);
  expect(mocks.runPrompt).toHaveBeenCalledTimes(2);
});
