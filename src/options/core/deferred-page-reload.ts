// Options the page can only answer while it loads. uiLocale picks the catalog
// the document is built from. webmcpEnabled is read once, at registration:
// Chrome's ModelContext registers a tool and offers no way to take one back, so
// neither switching agent access on nor off can reach an open page.
const PAGE_LOAD_OPTIONS: ReadonlySet<string> = new Set(["uiLocale", "webmcpEnabled"]);

export const changesNeedPageReload = (changes: readonly { name: string }[] = []): boolean =>
  changes.some(({ name }) => PAGE_LOAD_OPTIONS.has(name));

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
