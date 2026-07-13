import { options } from "./options-data.ts";

export type ExtensionFetchCredentials = "include" | "omit";

export const getExtensionFetchCredentials = (): ExtensionFetchCredentials =>
  options.includeFetchCredentials === true ? "include" : "omit";
