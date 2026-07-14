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

  test("sends explicit toggles as forced user overrides", async () => {
    const { toggleSourcePanelForTab } = await import("../src/background/source-panel-state.ts");

    await toggleSourcePanelForTab(3);

    expect(global.browser.storage.session.set).not.toHaveBeenCalled();
    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(3, {
      type: "TOGGLE_SOURCE_PANEL",
      body: { force: true },
    });
  });

  test("restores content-reported open state when another tab activates", async () => {
    const { setSourcePanelOpenState, syncSourcePanelToTab } =
      await import("../src/background/source-panel-state.ts");

    await setSourcePanelOpenState(true);
    await syncSourcePanelToTab(8);

    expect(global.browser.storage.session.set).toHaveBeenCalledWith({ sourcePanelOpen: true });
    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(8, {
      type: "SET_SOURCE_PANEL",
      body: { open: true },
    });
  });

  test("records content-script panel changes through the background owner", async () => {
    const { setSourcePanelOpenState, syncSourcePanelToTab } =
      await import("../src/background/source-panel-state.ts");

    await setSourcePanelOpenState(true);
    await syncSourcePanelToTab(9);

    expect(global.browser.storage.session.set).toHaveBeenCalledWith({ sourcePanelOpen: true });
    expect(global.browser.tabs.sendMessage).toHaveBeenCalledOnce();
    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(9, {
      type: "SET_SOURCE_PANEL",
      body: { open: true },
    });
  });

  test("serializes activation sync after a pending panel-state write", async () => {
    let stored = true;
    (global.browser as any).storage.session.get = vi.fn(() =>
      Promise.resolve({ sourcePanelOpen: stored }),
    );
    (global.browser as any).storage.session.set = vi.fn(async (value) => {
      stored = value.sourcePanelOpen;
    });
    const { setSourcePanelOpenState, syncSourcePanelToTab } =
      await import("../src/background/source-panel-state.ts");

    const close = setSourcePanelOpenState(false);
    const sync = syncSourcePanelToTab(11);
    await Promise.all([close, sync]);

    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(11, {
      type: "SET_SOURCE_PANEL",
      body: { open: false },
    });
  });

  test("uses worker-local state when session storage is unavailable", async () => {
    (global.browser as any).storage.session = undefined;
    const { setSourcePanelOpenState, syncSourcePanelToTab } =
      await import("../src/background/source-panel-state.ts");

    await setSourcePanelOpenState(true);
    await syncSourcePanelToTab(12);

    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(12, {
      type: "SET_SOURCE_PANEL",
      body: { open: true },
    });
  });

  test("falls back to worker-local state when session reads fail", async () => {
    (global.browser as any).storage.session.get = vi.fn(() => Promise.reject(new Error("denied")));
    const { setSourcePanelOpenState, syncSourcePanelToTab } =
      await import("../src/background/source-panel-state.ts");

    await setSourcePanelOpenState(true);
    await syncSourcePanelToTab(13);

    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(13, {
      type: "SET_SOURCE_PANEL",
      body: { open: true },
    });
  });

  test.each(["false", 1, {}, null])("ignores malformed persisted open state %p", async (stored) => {
    (global.browser as any).storage.session.get = vi.fn(() =>
      Promise.resolve({ sourcePanelOpen: stored }),
    );
    const { syncSourcePanelToTab } = await import("../src/background/source-panel-state.ts");

    await syncSourcePanelToTab(14);

    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(14, {
      type: "SET_SOURCE_PANEL",
      body: { open: false },
    });
  });
});
