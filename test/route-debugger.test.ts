// @vitest-environment jsdom
import { setupRouteDebugger } from "../src/options/route-debugger.ts";
import { webExtensionApi } from "../src/platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../src/shared/constants.ts";

const renderWorkbench = (): void => {
  document.body.innerHTML = `
    <textarea id="filenamePatterns">fileext: png\ninto: images/\n\nfileext: pdf\npagedomain: example\\.com\ninto: pdf/:filename:</textarea>
    <details class="route-debugger-disclosure" open></details>
    <div id="route-debugger-form">
      <input id="route-debugger-filename" value="report.pdf">
      <input id="route-debugger-source-url" value="https://cdn.example/report.pdf">
      <input id="route-debugger-page-url" value="https://example.com/reports">
      <input id="route-debugger-mime" value="application/pdf">
      <select id="route-debugger-context"><option value=""></option><option value="link">Link</option></select>
      <input id="route-debugger-page-title">
      <input id="route-debugger-referrer-url">
      <input id="route-debugger-frame-url">
      <input id="route-debugger-link-text">
      <input id="route-debugger-selection-text">
      <select id="route-debugger-media-type"><option value=""></option><option value="image">Image</option></select>
      <button id="route-debugger-run" type="button">Run test</button>
    </div>
    <button id="route-debugger-clear" type="button">Clear</button>
    <button id="route-debugger-use-last" type="button">Use last download</button>
    <button id="route-debugger-use-sample" type="button">Use sample download</button>
    <div id="route-debugger-result"></div>`;
};

const checkResponse = (lastDownload: unknown = null) => ({
  type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
  body: {
    optionErrors: {},
    routeInfo: {},
    lastDownload,
    interpolatedVariables: null,
    persistenceErrors: [],
  },
});

const noMatchTrace = {
  selectedRule: null,
  destination: null,
  expandedDestination: null,
  sanitizedDestination: null,
  finalPath: null,
  rules: [],
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(webExtensionApi.runtime.sendMessage).mockClear();
});

test("shows production rule and clause decisions and jumps back to their source", async () => {
  renderWorkbench();
  const sendMessage = vi
    .spyOn(webExtensionApi.runtime, "sendMessage")
    .mockImplementation(async (message: any) => {
      if (message.type === MESSAGE_TYPES.CHECK_ROUTES) {
        return {
          type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
          body: {
            optionErrors: {},
            routeInfo: {},
            lastDownload: null,
            interpolatedVariables: null,
            persistenceErrors: [],
          },
        };
      }
      if (message.type === MESSAGE_TYPES.VALIDATE) {
        return {
          type: MESSAGE_TYPES.VALIDATE_RESULT,
          body: {
            version: 1,
            ruleErrors: [],
            ruleTrace: {
              selectedRule: 2,
              destination: "pdf/:filename:",
              expandedDestination: "pdf/report.pdf",
              sanitizedDestination: "pdf/report.pdf",
              finalPath: "pdf/report.pdf",
              rules: [
                {
                  index: 1,
                  matched: false,
                  destination: "images/",
                  clauses: [{ name: "fileext", pattern: "png", matched: false }],
                },
                {
                  index: 2,
                  matched: true,
                  destination: "pdf/:filename:",
                  clauses: [
                    { name: "fileext", pattern: "pdf", matched: true },
                    { name: "pagedomain", pattern: "example\\.com", matched: true },
                  ],
                },
              ],
            },
          },
        };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });

  setupRouteDebugger();
  document.querySelector<HTMLButtonElement>("#route-debugger-run")?.click();

  const result = document.querySelector<HTMLElement>("#route-debugger-result")!;
  await vi.waitFor(() => expect(result.dataset.state).toBe("matched"));
  expect(result.textContent).toContain("pdf/report.pdf");
  const ruleCards = result.querySelectorAll<HTMLDetailsElement>(".route-debugger-rule");
  expect(ruleCards).toHaveLength(2);
  expect(ruleCards[0]?.open).toBe(false);
  expect(ruleCards[1]?.open).toBe(true);
  expect(
    ruleCards[1]?.querySelector<HTMLElement>(".route-debugger-rule-destination")?.dataset.path,
  ).toBe("pdf/:filename:");

  const validationCount = () =>
    sendMessage.mock.calls.filter(([message]: any[]) => message.type === MESSAGE_TYPES.VALIDATE)
      .length;
  const beforeShortcut = validationCount();
  document
    .querySelector<HTMLTextAreaElement>("#filenamePatterns")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  await vi.waitFor(() => expect(validationCount()).toBe(beforeShortcut + 1));

  const pageDomainClause = result.querySelector<HTMLButtonElement>(
    '[data-clause-name="pagedomain"]',
  );
  expect(pageDomainClause).toBeDefined();
  pageDomainClause!.click();
  const source = document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!;
  expect(source.value.slice(source.selectionStart, source.selectionEnd)).toBe(
    "pagedomain: example\\.com",
  );
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: MESSAGE_TYPES.VALIDATE,
      body: expect.objectContaining({
        filenamePatterns: source.value,
        info: expect.objectContaining({ filename: "report.pdf" }),
      }),
    }),
  );
});

test("loads the last download into the test bench", async () => {
  renderWorkbench();
  const sendMessage = vi
    .spyOn(webExtensionApi.runtime, "sendMessage")
    .mockImplementation(async (message: any) => {
      if (message.type === MESSAGE_TYPES.CHECK_ROUTES) {
        return {
          type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
          body: {
            optionErrors: {},
            routeInfo: {},
            lastDownload: {
              info: {
                filename: "photo.jpg",
                sourceUrl: "https://images.example/photo.jpg",
                pageUrl: "https://example.com/gallery",
                mime: "image/jpeg",
                context: "link",
                currentTab: { title: "Photo gallery" },
                referrerUrl: "https://example.com/home",
                mediaType: "image",
              },
            },
            interpolatedVariables: null,
            persistenceErrors: [],
          },
        };
      }
      return {
        type: MESSAGE_TYPES.VALIDATE_RESULT,
        body: {
          version: 1,
          ruleErrors: [],
          ruleTrace: {
            selectedRule: null,
            destination: null,
            expandedDestination: null,
            sanitizedDestination: null,
            finalPath: null,
            rules: [],
          },
        },
      };
    });

  setupRouteDebugger();
  const useLast = document.querySelector<HTMLButtonElement>("#route-debugger-use-last")!;
  await vi.waitFor(() => expect(useLast.disabled).toBe(false));
  useLast.click();

  await vi.waitFor(() =>
    expect(
      sendMessage.mock.calls.some(([message]: any[]) => message.type === MESSAGE_TYPES.VALIDATE),
    ).toBe(true),
  );
  expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")?.value).toBe(
    "photo.jpg",
  );
  expect(document.querySelector<HTMLSelectElement>("#route-debugger-context")?.value).toBe("link");
  expect(document.querySelector<HTMLInputElement>("#route-debugger-page-title")?.value).toBe(
    "Photo gallery",
  );
  document.querySelector<HTMLButtonElement>("#route-debugger-clear")?.click();
  expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")?.value).toBe("");
  expect(document.querySelector<HTMLInputElement>("#route-debugger-page-title")?.value).toBe("");
  expect(document.querySelector<HTMLElement>("#route-debugger-result")?.dataset.state).toBe(
    "empty",
  );
});

test("returns before wiring an incomplete workbench", () => {
  document.body.innerHTML = '<textarea id="filenamePatterns"></textarea>';
  expect(() => setupRouteDebugger()).not.toThrow();
});

test("prefills the sample when no latest download is available", async () => {
  renderWorkbench();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockResolvedValue(checkResponse());

  setupRouteDebugger();

  expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")!.value).toBe(
    "report.pdf",
  );
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLButtonElement>("#route-debugger-use-last")!.disabled).toBe(
      true,
    ),
  );
});

test("opens the debugger when an always-visible test action runs", async () => {
  renderWorkbench();
  const disclosure = document.querySelector<HTMLDetailsElement>(".route-debugger-disclosure")!;
  disclosure.open = false;
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) =>
    message.type === MESSAGE_TYPES.CHECK_ROUTES
      ? checkResponse()
      : {
          type: MESSAGE_TYPES.VALIDATE_RESULT,
          body: { version: 1, ruleErrors: [], ruleTrace: noMatchTrace },
        },
  );

  setupRouteDebugger();
  document.querySelector<HTMLButtonElement>("#route-debugger-run")!.click();

  expect(disclosure.open).toBe(true);
});

test("prefills the latest download and can switch back to the sample", async () => {
  renderWorkbench();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) =>
    message.type === MESSAGE_TYPES.CHECK_ROUTES
      ? checkResponse({ info: { filename: "latest.jpg" } })
      : {
          type: MESSAGE_TYPES.VALIDATE_RESULT,
          body: { version: 1, ruleErrors: [], ruleTrace: noMatchTrace },
        },
  );

  setupRouteDebugger();

  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")!.value).toBe(
      "latest.jpg",
    ),
  );
  document.querySelector<HTMLButtonElement>("#route-debugger-use-sample")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")!.value).toBe(
      "report.pdf",
    ),
  );
});

test("uses legacy last-download filename and URL fallbacks and normalizes unknown selects", async () => {
  renderWorkbench();
  vi.mocked(browser.i18n.getMessage).mockReturnValue("");
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) =>
    message.type === MESSAGE_TYPES.CHECK_ROUTES
      ? checkResponse({
          info: {
            initialFilename: "legacy.jpg",
            url: "https://legacy.example/image.jpg",
            context: "unknown",
            mediaType: "unknown",
          },
        })
      : {
          type: MESSAGE_TYPES.VALIDATE_RESULT,
          body: { version: 1, ruleErrors: [], ruleTrace: noMatchTrace },
        },
  );
  setupRouteDebugger();
  const useLast = document.querySelector<HTMLButtonElement>("#route-debugger-use-last")!;
  await vi.waitFor(() => expect(useLast.disabled).toBe(false));
  useLast.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#route-debugger-result")?.dataset.state).toBe(
      "no-match",
    ),
  );
  expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")!.value).toBe(
    "legacy.jpg",
  );
  expect(document.querySelector<HTMLInputElement>("#route-debugger-source-url")!.value).toBe(
    "https://legacy.example/image.jpg",
  );
  expect(document.querySelector<HTMLSelectElement>("#route-debugger-context")!.value).toBe("");
  expect(document.querySelector<HTMLSelectElement>("#route-debugger-media-type")!.value).toBe("");
});

test("falls through to resolved filenames and empty last-download fields", async () => {
  renderWorkbench();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) =>
    message.type === MESSAGE_TYPES.CHECK_ROUTES
      ? checkResponse({ info: { resolvedFilename: "resolved.bin" } })
      : {
          type: MESSAGE_TYPES.VALIDATE_RESULT,
          body: { version: 1, ruleErrors: [], ruleTrace: noMatchTrace },
        },
  );
  setupRouteDebugger();
  const useLast = document.querySelector<HTMLButtonElement>("#route-debugger-use-last")!;
  await vi.waitFor(() => expect(useLast.disabled).toBe(false));
  useLast.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")!.value).toBe(
      "resolved.bin",
    ),
  );
});

test("loads an empty last-download record with safe field defaults", async () => {
  renderWorkbench();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) =>
    message.type === MESSAGE_TYPES.CHECK_ROUTES
      ? checkResponse({ info: {} })
      : {
          type: MESSAGE_TYPES.VALIDATE_RESULT,
          body: { version: 1, ruleTrace: noMatchTrace },
        },
  );
  setupRouteDebugger();
  const useLast = document.querySelector<HTMLButtonElement>("#route-debugger-use-last")!;
  await vi.waitFor(() => expect(useLast.disabled).toBe(false));
  useLast.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#route-debugger-result")?.dataset.state).toBe(
      "no-match",
    ),
  );
  expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")!.value).toBe("");
});

test("shows a no-last-download message and contains unavailable history lookup", async () => {
  renderWorkbench();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockResolvedValue({ body: {} } as never);
  setupRouteDebugger();
  document
    .querySelector<HTMLButtonElement>("#route-debugger-use-last")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(document.querySelector<HTMLElement>("#route-debugger-result")!.dataset.state).toBe(
    "empty",
  );

  renderWorkbench();
  vi.mocked(webExtensionApi.runtime.sendMessage).mockRejectedValueOnce(new Error("offline"));
  setupRouteDebugger();
  await Promise.resolve();
  expect(document.querySelector<HTMLButtonElement>("#route-debugger-use-last")!.disabled).toBe(
    true,
  );
});

test.each([
  { body: { message: "bad request" } },
  { body: { error: "bad request" } },
  { body: { version: 1, ruleErrors: [], ruleTrace: {} } },
])("reports unavailable debugger response %#", async (validateResponse) => {
  renderWorkbench();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) =>
    message.type === MESSAGE_TYPES.CHECK_ROUTES ? checkResponse() : validateResponse,
  );
  setupRouteDebugger();
  document.querySelector<HTMLButtonElement>("#route-debugger-run")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#route-debugger-result")?.dataset.state).toBe(
      "error",
    ),
  );
});

test("renders blocking errors while ignoring warnings", async () => {
  renderWorkbench();
  let blocking = true;
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) => {
    if (message.type === MESSAGE_TYPES.CHECK_ROUTES) return checkResponse();
    return {
      type: MESSAGE_TYPES.VALIDATE_RESULT,
      body: {
        version: 1,
        ruleErrors: blocking
          ? [
              { message: "bad", error: "bad" },
              { message: "warn", error: "warn", warning: true },
            ]
          : [{ message: "warn", error: "warn", warning: true }],
        ruleTrace: blocking
          ? noMatchTrace
          : {
              ...noMatchTrace,
              rules: [
                {
                  index: 1,
                  matched: false,
                  destination: "images/",
                  clauses: [{ name: "fileext", pattern: "png", matched: false }],
                },
              ],
            },
      },
    };
  });
  setupRouteDebugger();
  const run = document.querySelector<HTMLButtonElement>("#route-debugger-run")!;
  run.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#route-debugger-result")?.dataset.state).toBe(
      "invalid",
    ),
  );
  blocking = false;
  run.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#route-debugger-result")?.dataset.state).toBe(
      "no-match",
    ),
  );
});

test("renders selected, also-matching, and missed rules without a destination pipeline", async () => {
  renderWorkbench();
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) =>
    message.type === MESSAGE_TYPES.CHECK_ROUTES
      ? checkResponse()
      : {
          type: MESSAGE_TYPES.VALIDATE_RESULT,
          body: {
            version: 1,
            ruleErrors: [],
            ruleTrace: {
              selectedRule: 2,
              destination: "second",
              expandedDestination: null,
              sanitizedDestination: "second",
              finalPath: null,
              rules: [
                {
                  index: 1,
                  matched: true,
                  destination: "first",
                  clauses: [{ name: "filename", pattern: "pdf", matched: true }],
                },
                {
                  index: 2,
                  matched: true,
                  destination: "second",
                  clauses: [{ name: "filename", pattern: "pdf", matched: true }],
                },
                {
                  index: 3,
                  matched: false,
                  destination: "third",
                  clauses: [{ name: "filename", pattern: "png", matched: false }],
                },
              ],
            },
          },
        },
  );
  setupRouteDebugger();
  document.querySelector<HTMLButtonElement>("#route-debugger-run")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#route-debugger-result")?.dataset.state).toBe(
      "matched",
    ),
  );
  expect(document.body.textContent).toContain("Matched, not used");
  expect(document.body.textContent).toContain("Used");
  expect(document.body.textContent).toContain("Conditions not met");
  expect(document.querySelector(".route-debugger-pipeline")).not.toBeNull();
});

test("ignores stale validation completion after clearing", async () => {
  renderWorkbench();
  let resolveValidation!: (value: unknown) => void;
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation((message: any) => {
    if (message.type === MESSAGE_TYPES.CHECK_ROUTES) return Promise.resolve(checkResponse());
    return new Promise((resolve) => {
      resolveValidation = resolve;
    });
  });
  setupRouteDebugger();
  const run = document.querySelector<HTMLButtonElement>("#route-debugger-run")!;
  run.click();
  document.querySelector<HTMLButtonElement>("#route-debugger-clear")!.click();
  resolveValidation({
    type: MESSAGE_TYPES.VALIDATE_RESULT,
    body: { version: 1, ruleErrors: [], ruleTrace: noMatchTrace },
  });
  await Promise.resolve();
  expect(document.querySelector<HTMLElement>("#route-debugger-result")!.dataset.state).toBe(
    "empty",
  );
  expect(run.disabled).toBe(false);
});

test("ignores stale validation rejection after clearing", async () => {
  renderWorkbench();
  let rejectValidation!: (error: unknown) => void;
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation((message: any) => {
    if (message.type === MESSAGE_TYPES.CHECK_ROUTES) return Promise.resolve(checkResponse());
    return new Promise((_resolve, reject) => {
      rejectValidation = reject;
    });
  });
  setupRouteDebugger();
  document.querySelector<HTMLButtonElement>("#route-debugger-run")!.click();
  document.querySelector<HTMLButtonElement>("#route-debugger-clear")!.click();
  rejectValidation(new Error("stale"));
  await Promise.resolve();
  expect(document.querySelector<HTMLElement>("#route-debugger-result")!.dataset.state).toBe(
    "empty",
  );
});

test("debounces reruns and supports form and Meta keyboard entry points", async () => {
  vi.useFakeTimers();
  renderWorkbench();
  const sendMessage = vi
    .spyOn(webExtensionApi.runtime, "sendMessage")
    .mockImplementation(async (message: any) =>
      message.type === MESSAGE_TYPES.CHECK_ROUTES
        ? checkResponse()
        : {
            type: MESSAGE_TYPES.VALIDATE_RESULT,
            body: { version: 1, ruleErrors: [], ruleTrace: noMatchTrace },
          },
    );
  setupRouteDebugger();
  const filename = document.querySelector<HTMLInputElement>("#route-debugger-filename")!;
  filename.dispatchEvent(new InputEvent("input", { bubbles: true }));
  const form = document.querySelector("#route-debugger-form")!;
  form.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
  form.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
  );
  form.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() =>
    expect(
      sendMessage.mock.calls.filter(([message]: any[]) => message.type === MESSAGE_TYPES.VALIDATE),
    ).toHaveLength(1),
  );

  document
    .querySelector<HTMLTextAreaElement>("#filenamePatterns")!
    .dispatchEvent(new InputEvent("input", { bubbles: true }));
  filename.dispatchEvent(new InputEvent("input", { bubbles: true }));
  filename.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(250);
  await vi.waitFor(() =>
    expect(
      sendMessage.mock.calls.filter(([message]: any[]) => message.type === MESSAGE_TYPES.VALIDATE),
    ).toHaveLength(2),
  );
  filename.dispatchEvent(new InputEvent("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>("#route-debugger-clear")!.click();

  const textarea = document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!;
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  textarea.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
  );
  await vi.waitFor(() =>
    expect(
      sendMessage.mock.calls.filter(([message]: any[]) => message.type === MESSAGE_TYPES.VALIDATE),
    ).toHaveLength(3),
  );
  document.dispatchEvent(new Event("options-restored"));
});

test("keeps source jumps inside Visual mode and uses explicit line heights in Text mode", async () => {
  renderWorkbench();
  document.body.insertAdjacentHTML(
    "beforeend",
    '<button id="rules-mode-visual" aria-selected="true"></button>',
  );
  vi.spyOn(webExtensionApi.runtime, "sendMessage").mockImplementation(async (message: any) =>
    message.type === MESSAGE_TYPES.CHECK_ROUTES
      ? checkResponse()
      : {
          type: MESSAGE_TYPES.VALIDATE_RESULT,
          body: {
            version: 1,
            ruleErrors: [],
            ruleTrace: {
              selectedRule: 1,
              destination: "images/",
              expandedDestination: "images/",
              sanitizedDestination: "images/",
              finalPath: "images/photo.png",
              rules: [
                {
                  index: 1,
                  matched: true,
                  destination: "images/",
                  clauses: [{ name: "fileext", pattern: "png", matched: true }],
                },
              ],
            },
          },
        },
  );
  setupRouteDebugger();
  document.querySelector<HTMLButtonElement>("#route-debugger-run")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".route-debugger-source-link")).not.toBeNull(),
  );
  const textarea = document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!;
  const focus = vi.spyOn(textarea, "focus");
  document.querySelector<HTMLButtonElement>(".route-debugger-source-link")!.click();
  expect(focus).not.toHaveBeenCalled();

  document.querySelector("#rules-mode-visual")!.setAttribute("aria-selected", "false");
  textarea.style.lineHeight = "30px";
  document.querySelector<HTMLButtonElement>(".route-debugger-source-link")!.click();
  expect(focus).toHaveBeenCalled();
});
