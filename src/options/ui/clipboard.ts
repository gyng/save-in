export type CopyText = (text: string) => Promise<void>;

export const copyText = async (
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | null | undefined = navigator.clipboard,
): Promise<void> => {
  if (!clipboard?.writeText) throw new Error("Clipboard API is unavailable");
  await clipboard.writeText(text);
};
