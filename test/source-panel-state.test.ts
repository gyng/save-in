describe("shared Page Sources open state", () => {
  beforeEach(() => {
    vi.resetModules();
    let stored = false;
    (global.browser as any).storage.session = {
      get: vi.fn(async () => ({ sourcePanelOpen: stored })),
      set: vi.fn(async (value) => {
        stored = value.sourcePanelOpen;
      }),
    };
    (global.browser as any).tabs.sendMessage = vi.fn(async () => undefined);
  });

  test("persists toggles and restores the state when another tab activates", async () => {
    const { syncSourcePanelToTab, toggleSourcePanelForTab } =
      await import("../src/background/source-panel-state.ts");

    await toggleSourcePanelForTab(3);
    await syncSourcePanelToTab(8);

    expect(global.browser.storage.session.set).toHaveBeenCalledWith({ sourcePanelOpen: true });
    expect(global.browser.tabs.sendMessage).toHaveBeenNthCalledWith(1, 3, {
      type: "SET_SOURCE_PANEL",
      body: { open: true },
    });
    expect(global.browser.tabs.sendMessage).toHaveBeenNthCalledWith(2, 8, {
      type: "SET_SOURCE_PANEL",
      body: { open: true },
    });
  });
});
