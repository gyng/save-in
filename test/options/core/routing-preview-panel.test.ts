// @vitest-environment jsdom
import { createRoutingPreviewPanel } from "../../../src/options/core/routing-preview-panel.ts";
import { MESSAGE_TYPES } from "../../../src/shared/constants.ts";

const response = (path: string | null, outcome?: "exclude", hasLastDownload = true) => ({
  type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
  body: {
    optionErrors: {},
    routeInfo: { path, captures: null, ...(outcome ? { outcome } : {}) },
    lastDownload: hasLastDownload ? { info: { url: "https://example.test/file" } } : null,
    interpolatedVariables: null,
    persistenceErrors: [],
  },
});

beforeEach(() => {
  document.body.innerHTML = `
    <div id="rules-applied-row" hidden></div>
    <div id="last-dl-url"></div>
    <div id="last-dl-match"></div>
    <div id="capture-group-rows" hidden></div>
    <div id="last-dl-capture"></div>
    <div id="variables-table-row" hidden></div>
  `;
  vi.mocked(browser.i18n.getMessage).mockReset().mockReturnValue("");
  vi.mocked(browser.runtime.sendMessage).mockReset();
});

afterEach(() => vi.restoreAllMocks());

test("keeps an older routing preview response from replacing the latest state", async () => {
  let resolveOlder!: (value: ReturnType<typeof response>) => void;
  let resolveLatest!: (value: ReturnType<typeof response>) => void;
  const older = new Promise<ReturnType<typeof response>>((resolve) => {
    resolveOlder = resolve;
  });
  const latest = new Promise<ReturnType<typeof response>>((resolve) => {
    resolveLatest = resolve;
  });
  vi.mocked(browser.runtime.sendMessage)
    .mockImplementationOnce(() => older)
    .mockImplementationOnce(() => latest);
  const panel = createRoutingPreviewPanel({
    setValidity: vi.fn(),
    setValidationPending: vi.fn(),
    setValidationUnavailable: vi.fn(),
  });

  panel.updateErrors();
  panel.updateErrors();
  resolveLatest(response("newest/path"));
  await vi.waitFor(() =>
    expect(document.querySelector("#last-dl-match")?.textContent).toBe("newest/path"),
  );

  resolveOlder(response(null, "exclude"));
  await older;
  await Promise.resolve();
  expect(document.querySelector("#last-dl-match")?.textContent).toBe("newest/path");
});

test("clears last-download fields when the latest response has no download", async () => {
  vi.mocked(browser.runtime.sendMessage)
    .mockResolvedValueOnce(response("old/path"))
    .mockResolvedValueOnce(response(null, undefined, false));
  const panel = createRoutingPreviewPanel({
    setValidity: vi.fn(),
    setValidationPending: vi.fn(),
    setValidationUnavailable: vi.fn(),
  });

  panel.updateErrors();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#variables-table-row")?.hidden).toBe(false),
  );
  expect(document.querySelector("#last-dl-url")?.textContent).toBe("https://example.test/file");

  panel.updateErrors();
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#rules-applied-row")?.hidden).toBe(true),
  );
  expect(document.querySelector<HTMLElement>("#variables-table-row")?.hidden).toBe(true);
  expect(document.querySelector("#last-dl-url")?.textContent).toBe("none yet");
});
