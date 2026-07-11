import type { SaveInOptions } from "./option-schema.ts";

// Startup seeds every schema key before background listeners can observe the
// bag. Keeping the object identity stable lets all read-only consumers share it.
export const options = {} as SaveInOptions;
