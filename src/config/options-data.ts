import type { SaveInOptions } from "./option-schema.ts";

// Startup seeds every schema key before background listeners can observe the
// bag. Keeping the object identity stable lets all read-only consumers share it.
export const options = {} as SaveInOptions;

export const replaceOptions = (next: SaveInOptions): void => {
  Object.keys(options).forEach((key) => Reflect.deleteProperty(options, key));
  Object.assign(options, next);
};

export const resetOptions = (entries: Iterable<readonly [string, unknown]>): void => {
  Object.keys(options).forEach((key) => Reflect.deleteProperty(options, key));
  for (const [key, value] of entries) Reflect.set(options, key, value);
};
