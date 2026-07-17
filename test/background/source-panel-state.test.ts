import {
  resetSourcePanelState,
  setSourcePanelOpenState,
  syncSourcePanelToTab,
} from "../../src/background/source-panel-state.ts";

beforeEach(async () => {
  vi.clearAllMocks();
  await resetSourcePanelState();
});

afterEach(() => resetSourcePanelState());

test("resets the worker fallback after session storage is cleared", async () => {
  await setSourcePanelOpenState(true);
  await resetSourcePanelState();
  vi.mocked(browser.storage.session.get).mockResolvedValue({});

  await syncSourcePanelToTab(7);

  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(7, {
    type: "SET_SOURCE_PANEL",
    body: { open: false },
  });
});

test("waits for work queued while a reset is draining", async () => {
  let releaseFirst: (() => void) | undefined;
  let releaseSecond: (() => void) | undefined;
  vi.mocked(browser.storage.session.set)
    .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
    .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseSecond = resolve)));
  const first = setSourcePanelOpenState(true);
  const reset = resetSourcePanelState();
  await Promise.resolve();
  const second = setSourcePanelOpenState(false);
  releaseFirst?.();
  await first;
  releaseSecond?.();

  await expect(Promise.all([second, reset])).resolves.toEqual([undefined, undefined]);
});
