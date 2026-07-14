type DeferredPageReloadPorts = {
  isBlocked(): boolean;
  reload(): void;
  schedule?(callback: () => void, delayMs: number): unknown;
};

const defaultSchedule = (callback: () => void, delayMs: number): unknown =>
  globalThis.setTimeout(callback, delayMs);

export const createDeferredPageReload = ({
  isBlocked,
  reload,
  schedule = defaultSchedule,
}: DeferredPageReloadPorts) => {
  let pending = false;

  const attempt = () => {
    if (!pending) return;
    if (isBlocked()) {
      schedule(attempt, 250);
      return;
    }
    pending = false;
    reload();
  };

  return {
    request: () => {
      if (pending) return;
      pending = true;
      // Navigation in a later task lets the WebMCP tool result settle first.
      schedule(attempt, 0);
    },
    isPending: () => pending,
  };
};
