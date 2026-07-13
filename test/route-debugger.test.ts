// @vitest-environment jsdom
import { setupRouteDebugger } from "../src/options/route-debugger.ts";
import { webExtensionApi } from "../src/platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../src/shared/constants.ts";

const renderWorkbench = (): void => {
  document.body.innerHTML = `
    <span id="route-ide-stats"></span>
    <textarea id="filenamePatterns">fileext: png\ninto: images/\n\nfileext: pdf\npagedomain: example\\.com\ninto: pdf/:filename:</textarea>
    <div id="route-debugger-form">
      <input id="route-debugger-filename" value="report.pdf">
      <input id="route-debugger-source-url" value="https://cdn.example/report.pdf">
      <input id="route-debugger-page-url" value="https://example.com/reports">
      <input id="route-debugger-mime" value="application/pdf">
      <select id="route-debugger-context"><option value=""></option><option value="link">Link</option></select>
      <details class="route-debugger-more">
        <input id="route-debugger-page-title">
        <input id="route-debugger-referrer-url">
        <input id="route-debugger-frame-url">
        <input id="route-debugger-link-text">
        <input id="route-debugger-selection-text">
        <select id="route-debugger-media-type"><option value=""></option><option value="image">Image</option></select>
      </details>
      <button id="route-debugger-run" type="button">Run test</button>
    </div>
    <button id="route-debugger-clear" type="button">Clear</button>
    <button id="route-debugger-use-last" type="button">Use last download</button>
    <div id="route-debugger-result"></div>`;
};

afterEach(() => {
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
  expect(ruleCards[1]?.querySelector(".route-debugger-rule-destination")?.textContent).toBe(
    "into: pdf/:filename:",
  );

  const validationCount = () =>
    sendMessage.mock.calls.filter(([message]: any[]) => message.type === MESSAGE_TYPES.VALIDATE)
      .length;
  const beforeShortcut = validationCount();
  document
    .querySelector<HTMLTextAreaElement>("#filenamePatterns")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  await vi.waitFor(() => expect(validationCount()).toBe(beforeShortcut + 1));

  const pageDomainClause = [
    ...result.querySelectorAll<HTMLButtonElement>(".route-debugger-rule li button"),
  ].find((button) => button.querySelector("code")?.textContent === "pagedomain:");
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
  expect(document.querySelector<HTMLDetailsElement>(".route-debugger-more")?.open).toBe(true);

  document.querySelector<HTMLButtonElement>("#route-debugger-clear")?.click();
  expect(document.querySelector<HTMLInputElement>("#route-debugger-filename")?.value).toBe("");
  expect(document.querySelector<HTMLInputElement>("#route-debugger-page-title")?.value).toBe("");
  expect(document.querySelector<HTMLDetailsElement>(".route-debugger-more")?.open).toBe(false);
  expect(document.querySelector<HTMLElement>("#route-debugger-result")?.dataset.state).toBe(
    "empty",
  );
});
