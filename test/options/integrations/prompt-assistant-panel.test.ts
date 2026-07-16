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

const copy: Record<string, string> = {
  promptAssistantStatusOff: "Off — no model checks or prompts",
  promptAssistantStatusChecking: "Checking on-device model…",
  promptAssistantStatusReady: "Ready on this device",
  promptAssistantStatusDownloadable: "The model downloads when you suggest your first rule",
  promptAssistantStatusDownloading: "Chrome is downloading the on-device model",
  promptAssistantStatusUnavailable: "Not available in this browser or on this device",
  promptAssistantStatusWorking: "Creating and checking a draft…",
  promptAssistantStatusInvalid: "The draft needs another try: $ERROR$",
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

beforeEach(() => {
  markup();
  mocks.availability.mockReset();
  mocks.runPrompt.mockReset();
  mocks.sendMessage.mockReset();
  mocks.appendRule.mockReset();
  mocks.availability.mockResolvedValue("available");
  mocks.runPrompt.mockResolvedValue("fileext: ^png$\ninto: Images/:filename:");
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
  });
  expect(mocks.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "VALIDATE",
      body: { filenamePatterns: "fileext: ^png$\ninto: Images/:filename:" },
    }),
  );
  expect(element("prompt-assistant-rule").textContent).toBe(
    "fileext: ^png$\ninto: Images/:filename:",
  );
  expect(mocks.appendRule).not.toHaveBeenCalled();

  element<HTMLButtonElement>("prompt-assistant-add").click();
  expect(mocks.appendRule).toHaveBeenCalledWith(
    element<HTMLTextAreaElement>("filenamePatterns"),
    "fileext: ^png$\ninto: Images/:filename:",
  );
  expect(element<HTMLButtonElement>("prompt-assistant-add").disabled).toBe(true);
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
