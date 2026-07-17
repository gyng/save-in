// The storage port shapes. These are structural contracts — "something with a
// .get()" — with no dependency on a browser API, and shared/ modules such as
// session-state.ts accept them as injected ports rather than reaching for a
// storage area themselves. They live here, not beside the live areas in
// platform/storage-areas.ts, so that a contract in the bottom layer never has
// to name a type owned by the layer above it.

export type StorageReader = {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
};

export type StorageSetter = {
  set(items: Record<string, unknown>): Promise<void>;
};

export type StorageRemover = {
  remove(keys: string | string[]): Promise<void>;
};

export type StorageWriter = StorageReader & StorageSetter;
export type StorageArea = StorageWriter & StorageRemover;
