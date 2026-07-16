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

// The download pipeline and its previews (route debugger, options preview)
// must name a download identically, so the initial-name precedence lives in
// exactly one place: a caller-supplied suggestion beats the URL-derived name,
// which beats the raw URL.
export const deriveUrlFilenames = (
  url: string,
  suggestedFilename?: string | null,
): { naiveFilename: string; initialFilename: string } => {
  const naiveFilename = getFilenameFromUrl(url);
  return { naiveFilename, initialFilename: suggestedFilename || naiveFilename || url };
};
