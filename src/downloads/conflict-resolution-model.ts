// Firefox's DownloadPaths.splitBaseNameAndExtension: up to three letters or
// digits before a .gz/.bz2/.Z keep the double extension together
// (a.tar.gz -> a(1).tar.gz), and a leading-dot name is all extension
// (.hidden -> (1).hidden). Measured on Firefox 140 and 158. Firefox writes it as
// /(.*?)(ext)?$/; the lazy base makes the extension the leftmost suffix that
// matches, which is what exec returns for the anchored extension alone.
const FIREFOX_EXTENSION_PATTERN = /(?:\.[A-Z0-9]{1,3}\.(?:gz|bz2|Z)|\.[^.]*)$/i;

export const splitFirefoxBaseName = (leafName: string): [string, string] => {
  const extension = FIREFOX_EXTENSION_PATTERN.exec(leafName)?.[0] ?? "";
  return [leafName.slice(0, leafName.length - extension.length), extension];
};

const pathParts = (value: string): string[] =>
  value.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");

const isWindowsPath = (value: string): boolean =>
  /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\");

// Firefox's uniquify appends "(N)" — no space — to the base name and keeps the
// extension; it never increments an existing "(1)" (x(1).png -> x(1)(1).png).
// Only that exact form, in the requested directory, is evidence of a file
// already on disk. A sanitized or truncated name is not, and must save as
// before.
export const isFirefoxUniqueRename = (requestedPath: string, actualPath: string): boolean => {
  const requested = pathParts(requestedPath);
  const actual = pathParts(actualPath);
  const requestedLeaf = requested.pop();
  const actualLeaf = actual.pop();
  if (!requestedLeaf || !actualLeaf || requested.length > actual.length) return false;
  const windows = isWindowsPath(actualPath);
  // Parts never contain a separator, so joining compares them one by one.
  const fold = (parts: string[]) => (windows ? parts.join("/").toLowerCase() : parts.join("/"));
  if (fold(requested) !== fold(actual.slice(actual.length - requested.length))) return false;
  const [base, extension] = splitFirefoxBaseName(requestedLeaf);
  if (!actualLeaf.startsWith(`${base}(`) || !actualLeaf.endsWith(`)${extension}`)) return false;
  const counter = actualLeaf.slice(base.length + 1, actualLeaf.length - extension.length - 1);
  return /^[1-9]\d*$/.test(counter);
};

// Firefox opens Save As in the folder it last saved to whenever the requested
// name has no folder part, and refuses every way of naming the top of
// Downloads explicitly ("./name" is an illegal character, measured on 140 and
// 158). Asking there would let the dialog save somewhere the user never
// routed, so a top-level conflict keeps Firefox's unique name instead.
export const isTopOfDownloads = (requestedPath: string): boolean =>
  pathParts(requestedPath).length <= 1;
