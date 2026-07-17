// @vitest-environment jsdom

import {
  registerPathSourceElement,
  revealSelectedPathSource,
  selectPathSource,
} from "../../../src/options/path-editor/path-source-selection.ts";

describe("path source selection", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <div id="path-editor-rows">
        <div class="path-editor-row"></div>
        <div class="path-editor-row"></div>
      </div>
      <div id="menu-preview-tree">
        <div class="menu-preview-row"></div>
        <div class="menu-preview-row"></div>
      </div>`;
  });

  test("keeps the visual row and preview entry on one semantic selection", () => {
    const visualRows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    const previewRows = document.querySelectorAll<HTMLElement>(".menu-preview-row");
    [...visualRows, ...previewRows].forEach((element, index) =>
      registerPathSourceElement(element, index % 2),
    );
    previewRows[1]!.scrollIntoView = vi.fn();

    selectPathSource(1);

    expect(visualRows[1]!.classList).toContain("is-preview-selected");
    expect(previewRows[1]!.classList).toContain("is-source-selected");
    expect(visualRows[1]!.getAttribute("aria-current")).toBe("true");
    expect(previewRows[1]!.getAttribute("aria-current")).toBe("true");
    expect(visualRows[0]!.hasAttribute("aria-current")).toBe(false);
    expect(previewRows[0]!.hasAttribute("aria-current")).toBe(false);
    expect(previewRows[1]!.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  test("restores selection when either surface rerenders", () => {
    selectPathSource(1, { revealPreview: false });
    const replacement = document.createElement("div");
    replacement.className = "menu-preview-row";
    registerPathSourceElement(replacement, 1);
    document.querySelector("#menu-preview-tree")!.replaceChildren(replacement);
    replacement.scrollIntoView = vi.fn();

    revealSelectedPathSource();

    expect(replacement.classList).toContain("is-source-selected");
    expect(replacement.getAttribute("aria-current")).toBe("true");
    expect(replacement.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  test("ignores invalid or unavailable sources", () => {
    const detachedDocument = document.implementation.createHTMLDocument();
    const detachedRow = detachedDocument.createElement("div");
    detachedRow.className = "menu-preview-separator";

    registerPathSourceElement(detachedRow, 0);
    selectPathSource(-1);
    selectPathSource(1.5);
    selectPathSource(0, { document: detachedDocument });
    revealSelectedPathSource(detachedDocument);

    expect(detachedRow.dataset.sourceIndex).toBe("0");
    expect(detachedRow.hasAttribute("aria-current")).toBe(false);
  });

  test("recognizes preview descendants and safely reveals a missing row", () => {
    const previewChild = document.createElement("span");
    document.querySelector("#menu-preview-tree")!.append(previewChild);
    registerPathSourceElement(previewChild, 2);
    selectPathSource(2, { revealPreview: false });

    expect(previewChild.classList).toContain("is-source-selected");
    previewChild.remove();
    expect(() => revealSelectedPathSource()).not.toThrow();
  });
});
