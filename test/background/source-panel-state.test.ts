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
