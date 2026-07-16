import { vi } from "vitest";

export const installHostProperty = (
  target: object,
  property: PropertyKey,
  value: unknown,
): void => {
  if (!Reflect.set(target, property, value)) {
    throw new Error(`Unable to install WebExtension test property ${String(property)}`);
  }
};

export const browserTab = (overrides: Partial<browser.tabs.Tab> = {}): browser.tabs.Tab => ({
  index: 0,
  highlighted: false,
  active: true,
  pinned: false,
  incognito: false,
  ...overrides,
});

type TestListener<Args extends unknown[]> = (...args: Args) => unknown;

export const webExtensionEvent = <Args extends unknown[] = unknown[]>() => {
  const listeners = new Set<TestListener<Args>>();
  return {
    addListener: vi.fn((listener: TestListener<Args>) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: TestListener<Args>) => {
      listeners.delete(listener);
    }),
    hasListener: vi.fn((listener: TestListener<Args>) => listeners.has(listener)),
    hasListeners: vi.fn(() => listeners.size > 0),
    emit: (...args: Args): void => {
      for (const listener of listeners) listener(...args);
    },
  };
};

type StorageKeys = string | string[] | Record<string, unknown> | null | undefined;
type TestHostKind = "firefox" | "chrome";

const selectStoredValues = (
  stored: Record<string, unknown>,
  keys: StorageKeys,
): Record<string, unknown> => {
  if (keys == null) return { ...stored };
  if (typeof keys === "string") return keys in stored ? { [keys]: stored[keys] } : {};
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, stored[key]]));
  }
  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [key, key in stored ? stored[key] : fallback]),
  );
};

export const webExtensionStorageArea = (kind: TestHostKind = "firefox") => {
  const stored: Record<string, unknown> = {};
  const returnValue = <T>(value: T, callback?: (result: T) => void): Promise<T> | undefined => {
    if (callback) {
      if (kind === "firefox") throw new TypeError("Firefox browser APIs do not accept callbacks");
      callback(value);
      return undefined;
    }
    return Promise.resolve(value);
  };
  return {
    get: vi.fn((keys?: StorageKeys, callback?: (values: Record<string, unknown>) => void) =>
      returnValue(selectStoredValues(stored, keys), callback),
    ),
    getBytesInUse: vi.fn((_keys?: StorageKeys, callback?: (bytes: number) => void) =>
      returnValue(0, callback),
    ),
    set: vi.fn((values: Record<string, unknown>, callback?: () => void) => {
      Object.assign(stored, values);
      return returnValue(undefined, callback);
    }),
    remove: vi.fn((keys: string | string[], callback?: () => void) => {
      for (const key of typeof keys === "string" ? [keys] : keys) delete stored[key];
      return returnValue(undefined, callback);
    }),
    clear: vi.fn((callback?: () => void) => {
      for (const key of Object.keys(stored)) delete stored[key];
      return returnValue(undefined, callback);
    }),
    onChanged: webExtensionEvent(),
  };
};

// One deliberately broad cast per host keeps individual tests typed without a
// hand-maintained declaration copy. The two instances remain behaviorally and
// statefully distinct, including Promise-only Firefox and callback-capable Chrome.
const createTestHost = (kind: TestHostKind): Record<string, unknown> => {
  const runtimeMessages =
    webExtensionEvent<
      [
        message: unknown,
        sender?: browser.runtime.MessageSender,
        sendResponse?: (response?: unknown) => void,
      ]
    >();
  const externalMessages =
    webExtensionEvent<
      [
        message: unknown,
        sender?: browser.runtime.MessageSender,
        sendResponse?: (response?: unknown) => void,
      ]
    >();

  const contextMenus = {
    create: vi.fn(() => "generated-menu-id"),
    update: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    removeAll: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    onClicked: webExtensionEvent(),
    onShown: webExtensionEvent(),
    onHidden: webExtensionEvent(),
  };
  const downloads = {
    download: vi.fn(async () => 1),
    search: vi.fn(async () => []),
    cancel: vi.fn(async () => undefined),
    erase: vi.fn(async () => []),
    removeFile: vi.fn(async () => undefined),
    open: vi.fn(),
    show: vi.fn(),
    showDefaultFolder: vi.fn(),
    onCreated: webExtensionEvent(),
    onChanged: webExtensionEvent(),
    onErased: webExtensionEvent(),
    onDeterminingFilename: webExtensionEvent(),
  };
  const notifications = {
    create: vi.fn(async (id?: string) => id || "generated-notification-id"),
    update: vi.fn(async () => true),
    clear: vi.fn(async () => true),
    getAll: vi.fn(async () => ({})),
    getPermissionLevel: vi.fn(async () => "granted"),
    onClosed: webExtensionEvent(),
    onClicked: webExtensionEvent(),
    onButtonClicked: webExtensionEvent(),
    onPermissionLevelChanged: webExtensionEvent(),
    onShowSettings: webExtensionEvent(),
  };
  const tabs = {
    get: vi.fn(async (id: number) => browserTab({ id })),
    getCurrent: vi.fn(async () => browserTab()),
    create: vi.fn(async (properties: { url?: string }) => browserTab({ url: properties.url })),
    remove: vi.fn(async () => undefined),
    query: vi.fn(async () => []),
    update: vi.fn(async (id: number) => browserTab({ id })),
    sendMessage: vi.fn(async () => undefined),
    onActivated: webExtensionEvent(),
    onHighlighted: webExtensionEvent(),
    onUpdated: webExtensionEvent(),
    onRemoved: webExtensionEvent(),
    onCreated: webExtensionEvent(),
  };
  const permissions = {
    contains: vi.fn(async () => false),
    getAll: vi.fn(async () => ({ permissions: [], origins: [] })),
    remove: vi.fn(async () => false),
    request: vi.fn(async () => false),
    onAdded: webExtensionEvent(),
    onRemoved: webExtensionEvent(),
  };
  const declarativeNetRequest = {
    getSessionRules: vi.fn(async () => []),
    updateSessionRules: vi.fn(async () => undefined),
  };
  return {
    contextMenus,
    menus: contextMenus,
    commands: { getAll: vi.fn(async () => []), onCommand: webExtensionEvent() },
    downloads,
    declarativeNetRequest,
    i18n: {
      getAcceptLanguages: vi.fn(async () => ["en"]),
      getMessage: vi.fn((key: string) => `Translated<${key}>`),
      getUILanguage: vi.fn(() => "en"),
      detectLanguage: vi.fn(async () => ({ isReliable: true, languages: [] })),
    },
    notifications,
    permissions,
    runtime: {
      id: "save-in-test",
      getManifest: vi.fn(() => ({ manifest_version: 3, name: "Save In", version: "4.0.0" })),
      getURL: vi.fn((path: string) => `moz-extension://save-in-test/${path}`),
      openOptionsPage: vi.fn(async () => undefined),
      sendMessage: vi.fn((message: unknown, ...args: unknown[]) => {
        const callback = args.findLast((argument) => typeof argument === "function") as
          | ((response?: unknown) => void)
          | undefined;
        if (callback && kind === "firefox")
          throw new TypeError("Firefox browser APIs do not accept callbacks");
        runtimeMessages.emit(message, {}, () => undefined);
        if (callback) {
          callback(undefined);
          return undefined;
        }
        return Promise.resolve(undefined);
      }),
      onMessage: runtimeMessages,
      onMessageExternal: externalMessages,
      onConnect: webExtensionEvent(),
      onInstalled: webExtensionEvent(),
    },
    storage: {
      local: webExtensionStorageArea(kind),
      sync: webExtensionStorageArea(kind),
      session: webExtensionStorageArea(kind),
      managed: webExtensionStorageArea(kind),
      onChanged: webExtensionEvent(),
    },
    tabs,
    webNavigation: {
      getFrame: vi.fn(async () => null),
      getAllFrames: vi.fn(async () => []),
      onBeforeNavigate: webExtensionEvent(),
      onCommitted: webExtensionEvent(),
      onDOMContentLoaded: webExtensionEvent(),
      onCompleted: webExtensionEvent(),
      onErrorOccurred: webExtensionEvent(),
      onCreatedNavigationTarget: webExtensionEvent(),
      onReferenceFragmentUpdated: webExtensionEvent(),
      onTabReplaced: webExtensionEvent(),
      onHistoryStateUpdated: webExtensionEvent(),
    },
  };
};

export const createFirefoxTestHost = (): typeof browser =>
  createTestHost("firefox") as unknown as typeof browser;

export const createChromeTestHost = (): typeof chrome =>
  createTestHost("chrome") as unknown as typeof chrome;

export const createWebExtensionTestHost = (): {
  browser: typeof browser;
  chrome: typeof chrome;
} => {
  return {
    browser: createFirefoxTestHost(),
    chrome: createChromeTestHost(),
  };
};
