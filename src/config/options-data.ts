import type { SaveInOptions } from "./option-schema.ts";
import { defaultOptions } from "./option-defaults.ts";

type MissingDefault = Exclude<keyof SaveInOptions, keyof ReturnType<typeof defaultOptions>>;
type UnknownDefault = Exclude<keyof ReturnType<typeof defaultOptions>, keyof SaveInOptions>;
const defaultsMatchSchema: Record<MissingDefault | UnknownDefault, never> = {};
void defaultsMatchSchema;

// Defaults exist before any listener can observe the bag. Keeping the object
// identity stable lets all read-only consumers share it across reloads.
export const options: SaveInOptions = defaultOptions();

export const shouldPersistActivity = (privateContext: boolean): boolean =>
  !privateContext || options.persistPrivateActivity;

// The same opt-in lets an extension the user allowlisted act in private
// windows. It loosens nothing a page can reach, and it never enables webhooks,
// browser credentials, or anything else that sends private data off the device.
export const allowsExternalPrivateTabs = (): boolean => options.persistPrivateActivity === true;

export const replaceOptions = (next: SaveInOptions): void => {
  Object.keys(options).forEach((key) => Reflect.deleteProperty(options, key));
  Object.assign(options, next);
};

export const resetOptions = (next: SaveInOptions): void => {
  Object.keys(options).forEach((key) => Reflect.deleteProperty(options, key));
  Object.assign(options, next);
};
