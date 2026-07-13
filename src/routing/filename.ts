export const EXTENSION_REGEX = /\.([\p{L}\p{M}\p{N}_+-]+)$/u;

export const getFilenameFromUrl = (url: string): string => {
  let segment;
  try {
    const remotePath = new URL(url).pathname;
    segment = remotePath.substring(remotePath.lastIndexOf("/") + 1);
  } catch {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};
