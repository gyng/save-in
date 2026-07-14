import { createDeferredPageReload } from "../../src/options/deferred-page-reload.ts";

describe("deferred page reload", () => {
  test("returns to the event loop before reloading an unblocked page", () => {
    const scheduled: Array<() => void> = [];
    const reload = vi.fn();
    const controller = createDeferredPageReload({
      isBlocked: () => false,
      reload,
      schedule: (callback) => scheduled.push(callback),
    });

    controller.request();

    expect(reload).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    const attempt = scheduled.shift()!;
    attempt();
    expect(reload).toHaveBeenCalledOnce();
    attempt();
    expect(reload).toHaveBeenCalledOnce();
  });

  test("waits for drafts and in-flight saves without scheduling duplicate loops", () => {
    const scheduled: Array<() => void> = [];
    let blocked = true;
    const reload = vi.fn();
    const controller = createDeferredPageReload({
      isBlocked: () => blocked,
      reload,
      schedule: (callback) => scheduled.push(callback),
    });

    controller.request();
    controller.request();
    expect(scheduled).toHaveLength(1);

    scheduled.shift()!();
    expect(reload).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    blocked = false;
    scheduled.shift()!();
    expect(reload).toHaveBeenCalledOnce();
    expect(controller.isPending()).toBe(false);
  });

  test("uses the event-loop scheduler by default", () => {
    vi.useFakeTimers();
    try {
      const reload = vi.fn();
      createDeferredPageReload({ isBlocked: () => false, reload }).request();
      expect(reload).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
