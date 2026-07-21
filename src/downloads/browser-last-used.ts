const splitPath = (value: string): string[] => value.split(/[\\/]+/).filter(Boolean);

const directoryParts = (value: string): string[] => splitPath(value).slice(0, -1);

const isWindowsPath = (value: string): boolean =>
  /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\");

const comparableParts = (parts: string[], windows: boolean): string =>
  (windows ? parts.map((part) => part.toLowerCase()) : parts).join("\0");

export const deriveDownloadsRoot = (
  absoluteFilename: string,
  requestedRelativeFilename: string,
): string | null => {
  const absoluteDirectory = directoryParts(absoluteFilename);
  const relativeDirectory = directoryParts(requestedRelativeFilename.replace(/^\.[\\/]/, ""));
  const windows = isWindowsPath(absoluteFilename);
  const absoluteSuffix =
    relativeDirectory.length === 0 ? [] : absoluteDirectory.slice(-relativeDirectory.length);
  if (
    relativeDirectory.length > absoluteDirectory.length ||
    comparableParts(relativeDirectory, windows) !== comparableParts(absoluteSuffix, windows)
  ) {
    return null;
  }
  const rootParts = absoluteDirectory.slice(0, absoluteDirectory.length - relativeDirectory.length);
  if (windows) {
    const prefix = absoluteFilename.startsWith("\\\\") ? "\\\\" : "";
    return `${prefix}${rootParts.join("\\")}\\`;
  }
  return `/${rootParts.join("/")}/`.replace(/^\/\//, "/");
};

export const relativeDirectoryWithinRoot = (
  absoluteFilename: string,
  downloadsRoot: string,
): string | null => {
  const absoluteDirectory = directoryParts(absoluteFilename);
  const rootParts = splitPath(downloadsRoot);
  const windows = isWindowsPath(downloadsRoot);
  const absolutePrefix = absoluteDirectory.slice(0, rootParts.length);
  if (
    rootParts.length > absoluteDirectory.length ||
    comparableParts(rootParts, windows) !== comparableParts(absolutePrefix, windows)
  ) {
    return null;
  }
  const relative = absoluteDirectory.slice(rootParts.length);
  return relative.length === 0 ? "." : relative.join("/");
};
