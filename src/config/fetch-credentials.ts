import { options } from "./options-data.ts";
import type { ExtensionFetchCredentials } from "../shared/content-fetch-types.ts";

export const getExtensionFetchCredentials = (privateContext = false): ExtensionFetchCredentials =>
  !privateContext && options.includeFetchCredentials === true ? "include" : "omit";
