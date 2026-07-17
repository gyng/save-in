type SelectPathSourceOptions = {
  document?: Document;
  revealPreview?: boolean;
};

const selectedSources = new WeakMap<HTMLTextAreaElement, number>();

const sourceHost = (document: Document): HTMLTextAreaElement | null =>
  document.querySelector<HTMLTextAreaElement>("#paths");

const isPreviewSource = (element: HTMLElement): boolean =>
  element.classList.contains("menu-preview-row") ||
  element.classList.contains("menu-preview-separator") ||
  element.closest("#menu-preview-tree") !== null;

const applySelection = (element: HTMLElement, selectedSourceIndex: number | undefined): void => {
  const selected = Number(element.dataset.sourceIndex) === selectedSourceIndex;
  element.classList.toggle("is-source-selected", isPreviewSource(element) && selected);
  element.classList.toggle(
    "is-preview-selected",
    element.classList.contains("path-editor-row") && selected,
  );
  if (selected) {
    element.setAttribute("aria-current", "true");
  } else {
    element.removeAttribute("aria-current");
  }
};

const sourceElements = (document: Document): NodeListOf<HTMLElement> =>
  document.querySelectorAll<HTMLElement>(
    "#menu-preview-tree [data-source-index], #path-editor-rows .path-editor-row[data-source-index]",
  );

export const registerPathSourceElement = (element: HTMLElement, sourceIndex: number): void => {
  element.dataset.sourceIndex = String(sourceIndex);
  const host = sourceHost(element.ownerDocument);
  applySelection(element, host ? selectedSources.get(host) : undefined);
};

export const revealSelectedPathSource = (document: Document = window.document): void => {
  const host = sourceHost(document);
  const sourceIndex = host ? selectedSources.get(host) : undefined;
  if (sourceIndex === undefined) return;
  document
    .querySelector<HTMLElement>(
      `#menu-preview-tree [data-source-index="${sourceIndex}"].is-source-selected`,
    )
    ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
};

export const selectPathSource = (
  sourceIndex: number,
  { document = window.document, revealPreview = true }: SelectPathSourceOptions = {},
): void => {
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0) return;
  const host = sourceHost(document);
  if (!host) return;
  selectedSources.set(host, sourceIndex);
  sourceElements(document).forEach((element) => applySelection(element, sourceIndex));
  if (revealPreview) revealSelectedPathSource(document);
};
