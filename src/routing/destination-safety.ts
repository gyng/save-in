export const invalidDestinationRange = (
  value: string,
): { start: number; length: number } | null => {
  if (/^[\\/]/.test(value)) return { start: 0, length: 1 };
  const drive = /^[A-Za-z]:[\\/]/.exec(value);
  if (drive) return { start: 0, length: drive[0].length };
  const parent = /(?:^|[\\/])(\.\.)(?=[\\/]|$)/.exec(value);
  if (!parent || parent.index === undefined) return null;
  const separatorLength = /^[\\/]/.test(parent[0]) ? 1 : 0;
  return { start: parent.index + separatorLength, length: 2 };
};

export const isSafeRelativeDestination = (value: string): boolean =>
  invalidDestinationRange(value) === null;
