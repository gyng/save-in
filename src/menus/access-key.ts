export const resolveMenuAccessKey = (key: string | number, override?: string): string | null => {
  const accessKey = String(override != null ? override : key);
  return [...accessKey].length === 1 && accessKey !== "&" ? accessKey : null;
};
