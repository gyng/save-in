export const EXTENSION_REGEX = /\.(?!\d+$)([0-9a-z]{1,8})$/i;

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
