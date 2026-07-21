import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { DOWNLOADS_ROOT_SESSION_KEY } from "../shared/storage-keys.ts";

const splitPath = (value: string): string[] => value.split(/[\\/]+/).filter(Boolean);

const directoryParts = (value: string): string[] => splitPath(value).slice(0, -1);

const isWindowsPath = (value: string): boolean =>
  /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\");

const comparableParts = (parts: string[], windows: boolean): string =>
  (windows ? parts.map((part) => part.toLowerCase()) : parts).join("\0");

let cachedDownloadsRoot: string | null | undefined;
let downloadsRootRead: Promise<string | null> | null = null;
let downloadsRootWrite: Promise<void> = Promise.resolve();

export const getDownloadsRoot = (): Promise<string | null> => {
  if (cachedDownloadsRoot !== undefined) return Promise.resolve(cachedDownloadsRoot);
  if (downloadsRootRead) return downloadsRootRead;
  const task = extensionSessionStorage.get(DOWNLOADS_ROOT_SESSION_KEY).then((stored) => {
    const value = Reflect.get(stored, DOWNLOADS_ROOT_SESSION_KEY);
    cachedDownloadsRoot = typeof value === "string" ? value : null;
    return cachedDownloadsRoot;
  });
  downloadsRootRead = task;
  void task.then(
    () => {
      downloadsRootRead = null;
    },
    () => {
      downloadsRootRead = null;
    },
  );
  return task;
};

export const rememberDownloadsRoot = (root: string): Promise<void> => {
  const task = downloadsRootWrite
    .catch(() => {})
    .then(async () => {
      if ((await getDownloadsRoot()) === root) return;
      await extensionSessionStorage.set({ [DOWNLOADS_ROOT_SESSION_KEY]: root });
      cachedDownloadsRoot = root;
    });
  downloadsRootWrite = task;
  return task;
};

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
