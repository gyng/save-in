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

export const webExtensionStorageArea = () => {
  const stored: Record<string, unknown> = {};
  return {
    get: vi.fn(async (keys?: StorageKeys) => selectStoredValues(stored, keys)),
    getBytesInUse: vi.fn(async () => 0),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(stored, values);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) delete stored[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(stored)) delete stored[key];
    }),
    onChanged: webExtensionEvent(),
  };
};

// One deliberately broad host-boundary cast keeps individual tests typed while
// avoiding a second hand-maintained copy of the Firefox and Chrome declarations.
// Suites replace the exact APIs whose behavior matters to the unit under test.
export const createWebExtensionTestHost = (): {
  browser: typeof browser;
  chrome: typeof chrome;
} => {
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
  const host = {
    contextMenus,
    menus: contextMenus,
    commands: { getAll: vi.fn(async () => []), onCommand: webExtensionEvent() },
    downloads,
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
      sendMessage: vi.fn(async (message: unknown) => {
        runtimeMessages.emit(message, {}, () => undefined);
      }),
      onMessage: runtimeMessages,
      onMessageExternal: externalMessages,
      onConnect: webExtensionEvent(),
      onInstalled: webExtensionEvent(),
    },
    storage: {
      local: webExtensionStorageArea(),
      sync: webExtensionStorageArea(),
      session: webExtensionStorageArea(),
      managed: webExtensionStorageArea(),
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

  return {
    browser: host as unknown as typeof browser,
    chrome: host as unknown as typeof chrome,
  };
};
