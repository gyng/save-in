const appendLinkedText = (container: HTMLElement, text: string) => {
  let remainder = text;
  for (;;) {
    const match = /https?:\/\/\S+/.exec(remainder);
    if (!match) {
      container.append(remainder);
      return;
    }

    container.append(remainder.slice(0, match.index));
    const trailing = match[0].match(/[),.;:!?]+$/)?.[0] ?? "";
    const href = match[0].slice(0, match[0].length - trailing.length);
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = href;
    container.append(link, trailing);
    remainder = remainder.slice(match.index + match[0].length);
  }
};

const renderPrivacyMarkdown = (container: HTMLElement, markdown: string) => {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const rendered = document.createDocumentFragment();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    /* v8 ignore next -- The loop bound guarantees a line at this index. */
    if (line === undefined) break;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const headingMarks = heading?.[1];
    const headingText = heading?.[2];
    if (headingMarks && headingText) {
      const level = headingMarks.length;
      const element = document.createElement(`h${level}` as "h1");
      appendLinkedText(element, headingText);
      rendered.append(element);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const list = document.createElement("ul");
      for (;;) {
        const itemLine = lines[index];
        if (itemLine === undefined || !/^[-*]\s+/.test(itemLine)) break;
        const item = document.createElement("li");
        appendLinkedText(item, itemLine.replace(/^[-*]\s+/, ""));
        list.append(item);
        index += 1;
      }
      rendered.append(list);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    for (;;) {
      const paragraphLine = lines[index];
      if (
        paragraphLine === undefined ||
        !paragraphLine.trim() ||
        /^(#{1,6}|[-*])\s+/.test(paragraphLine)
      )
        break;
      paragraphLines.push(paragraphLine.trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendLinkedText(paragraph, paragraphLines.join(" "));
    rendered.append(paragraph);
  }

  container.replaceChildren(rendered);
};

export const setupPrivacyDialog = () => {
  const dialog = document.querySelector<HTMLDialogElement>("#privacy-dialog");
  const open = document.querySelector<HTMLButtonElement>("#privacy-open");
  const close = dialog?.querySelector<HTMLButtonElement>(".privacy-close");
  const content = dialog?.querySelector<HTMLElement>("#privacy-content");
  if (!dialog || !open || !close || !content) return;
  let returnFocusTarget: HTMLElement = open;

  // The runtime package stages this canonical file, so policy edits cannot drift
  // from a separately maintained in-app copy.
  const privacyUrl = new URL("../../PRIVACY.md", document.baseURI).href;
  let loadPromise: Promise<void> | undefined;
  const load = () => {
    content.setAttribute("aria-busy", "true");
    loadPromise ??= fetch(privacyUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Privacy policy request failed: ${response.status}`);
        return response.text();
      })
      .then((markdown) => renderPrivacyMarkdown(content, markdown))
      .catch(() => {
        const link = document.createElement("a");
        link.href = privacyUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = open.textContent?.trim() || "Privacy policy";
        const paragraph = document.createElement("p");
        paragraph.append(link);
        content.replaceChildren(paragraph);
      })
      .finally(() => content.removeAttribute("aria-busy"));
    return loadPromise;
  };

  open.addEventListener("click", () => {
    const parentDetails = open.closest("details");
    returnFocusTarget = parentDetails?.querySelector<HTMLElement>("summary") ?? open;
    parentDetails?.removeAttribute("open");
    dialog.showModal();
    void load();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (returnFocusTarget.isConnected && !document.querySelector("dialog[open]")) {
      returnFocusTarget.focus();
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
};
