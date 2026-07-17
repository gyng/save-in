import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const english = JSON.parse(readFileSync(resolve("_locales/en/messages.json"), "utf8")) as Record<
  string,
  { message: string }
>;
const localizedOptionsHtml = readFileSync(resolve("src/options/options.html"), "utf8").replace(
  /__MSG_(html_[A-Za-z0-9_]+)__/g,
  (token, key: string) => english[key]?.message ?? token,
);

export const parseOptionsDocument = (): Document => {
  return new DOMParser().parseFromString(localizedOptionsHtml, "text/html");
};

let sharedOptionsDocument: Document | undefined;
export const getReadOnlyOptionsDocument = (): Document =>
  (sharedOptionsDocument ??= parseOptionsDocument());
