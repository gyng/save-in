import { options } from "./options-data.ts";

export type ExtensionFetchCredentials = "include" | "omit";

export const getExtensionFetchCredentials = (privateContext = false): ExtensionFetchCredentials =>
  !privateContext && options.includeFetchCredentials === true ? "include" : "omit";
