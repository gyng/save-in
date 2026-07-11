import { webExtensionApi } from "./web-extension-api.ts";

export type StorageReader = {
  get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>>;
};

export type StorageSetter = {
  set(items: Record<string, any>): Promise<void>;
};

export type StorageRemover = {
  remove(keys: string | string[]): Promise<void>;
};

export type StorageWriter = StorageReader & StorageSetter;
export type StorageArea = StorageWriter & StorageRemover;

// Resolve the platform API at call time: MV3 module tests and partial browser
// hosts can load the graph before a storage area is present.
export const extensionLocalStorage: StorageArea = {
  get: (keys) => webExtensionApi.storage.local.get(keys),
  set: (items) => webExtensionApi.storage.local.set(items),
  remove: (keys) => webExtensionApi.storage.local.remove(keys),
};

export const extensionSessionStorage: StorageArea = {
  get: (keys) => webExtensionApi.storage?.session?.get(keys) ?? Promise.resolve({}),
  set: (items) => webExtensionApi.storage?.session?.set(items) ?? Promise.resolve(),
  remove: (keys) => webExtensionApi.storage?.session?.remove(keys) ?? Promise.resolve(),
};
