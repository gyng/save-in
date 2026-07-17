// Live context-menu tree preview: mirrors what the paths textarea will
// produce, updating as the user types (before autosave persists it). Its CSS
// (style-menu-preview.css) lives with the path editor, but the renderer
// itself stays here because it also reads other options-page-level fields
// (last-used/recent-locations checkboxes) that path-editor.ts does not own.
import { getMessage } from "../../platform/localization.ts";
import { buildTree, getMenuTreeEntries } from "../../menus/menu-tree.ts";
import type { MenuTree } from "../../menus/menu-tree.ts";
import { resolveMenuAccessKey } from "../../menus/access-key.ts";
import { splitLines } from "../../shared/util.ts";
import { linkOptionPreview } from "./option-navigation.ts";
import {
  registerPathSourceElement,
  revealSelectedPathSource,
  selectPathSource,
} from "../path-editor/path-source-selection.ts";
import { SYNTAX_EDITOR_LINE_SELECTED_EVENT } from "../syntax-editor/syntax-editor.ts";
import { jumpToError, MENU_PREVIEW_DEBOUNCE_MS } from "./routing-preview-panel.ts";

const renderMenuPreview = (container: Element, tree: MenuTree): void => {
  container.textContent = "";

  const rootUl = document.createElement("ul");
  const listsByParent = new Map<string, HTMLUListElement>();

  getMenuTreeEntries(tree).forEach((entry) => {
    const parentUl = (entry.parentId && listsByParent.get(entry.parentId)) || rootUl;
    const li = document.createElement("li");

    if (!("kind" in entry)) {
      li.className = "menu-preview-item menu-preview-error";
      li.title = entry.message;
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");

      const row = document.createElement("div");
      row.className = "menu-preview-row";
      registerPathSourceElement(row, entry.sourceIndex);
      const title = document.createElement("span");
      title.className = "menu-preview-title";
      title.textContent = entry.error;
      row.appendChild(title);
      li.appendChild(row);

      const jump = () => {
        selectPathSource(entry.sourceIndex, { document: container.ownerDocument });
        jumpToError("#paths", entry.error, entry.sourceIndex);
      };
      li.addEventListener("click", jump);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jump();
        }
      });
    } else if (entry.kind === "separator") {
      li.className = "menu-preview-separator";
      registerPathSourceElement(li, entry.sourceIndex);
      li.appendChild(document.createElement("hr"));
    } else {
      li.className = "menu-preview-item";

      // The row (title + dir) is a flex box so the submenu ul drops below
      // it as a block; hover highlights just the row
      const row = document.createElement("div");
      row.className = "menu-preview-row";
      registerPathSourceElement(row, entry.sourceIndex);

      const title = document.createElement("span");
      title.className = "menu-preview-title";
      title.textContent = entry.title;
      row.appendChild(title);

      // Aliased items also show the directory they save into
      if (entry.title !== entry.parsedDir) {
        const dir = document.createElement("span");
        dir.className = "menu-preview-dir";
        dir.textContent = entry.parsedDir;
        row.appendChild(dir);
      }

      // Mirror renderPathTree: the toggle gates only the automatic number, so
      // an explicit (key:) still shows with numbering off.
      const numberedItems = document.querySelector<HTMLInputElement>("#enableNumberedItems");
      const accessKey = resolveMenuAccessKey(
        numberedItems?.checked ? entry.number : "",
        entry.accessKeyOverride,
      );
      if (accessKey !== null) {
        const key = document.createElement("kbd");
        key.className = "menu-preview-access-key";
        key.textContent = accessKey;
        key.setAttribute(
          "aria-label",
          `${getMessage("o_sContextMenu") || "Context menu access key"}: ${accessKey}`,
        );
        row.appendChild(key);
      }

      // Any row jumps to its line in the editor (the row only, so clicking a
      // nested child jumps to the child, not its parent)
      if (entry.raw) {
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        const jump = () => {
          selectPathSource(entry.sourceIndex, { document: container.ownerDocument });
          jumpToError("#paths", entry.raw, entry.sourceIndex);
        };
        row.addEventListener("click", jump);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jump();
          }
        });
      }

      li.appendChild(row);

      const childUl = document.createElement("ul");
      li.appendChild(childUl);
      listsByParent.set(entry.id, childUl);
    }

    parentUl.appendChild(li);
  });

  // Mirror the real menu: the Last used slot, then the Recent locations slot,
  // sit above the configured paths — each shown when its option is enabled
  // (menu-rebuild.ts orders last-used, then recent, then a separator, then paths).
  const makeQuickLocation = (
    variant: string,
    label: string,
    input: HTMLInputElement,
    hint: string,
  ): HTMLLIElement => {
    const li = document.createElement("li");
    li.className = `menu-preview-item ${variant}`;
    const row = document.createElement("div");
    row.className = "menu-preview-row";
    const title = document.createElement("span");
    title.className = "menu-preview-title";
    title.textContent = label;
    row.appendChild(title);
    linkOptionPreview(row, input, hint);
    li.appendChild(row);
    return li;
  };

  const lastUsed = document.querySelector<HTMLInputElement>("#enableLastLocation");
  const recentCount = document.querySelector<HTMLInputElement>("#recentDestinationCount");
  const quickLocations: HTMLLIElement[] = [];
  if (lastUsed?.checked) {
    quickLocations.push(
      makeQuickLocation(
        "menu-preview-lastused",
        getMessage("contextMenuLastUsed"),
        lastUsed,
        "Show the Last used menu setting",
      ),
    );
  }
  if (recentCount && Number(recentCount.value) > 0) {
    quickLocations.push(
      makeQuickLocation(
        "menu-preview-recent",
        getMessage("contextMenuRecentLocations"),
        recentCount,
        "Show the Recent locations menu setting",
      ),
    );
  }

  if (quickLocations.length > 0) {
    if (tree.items.some((item) => item.kind === "path")) {
      const sep = document.createElement("li");
      sep.className = "menu-preview-separator";
      sep.appendChild(document.createElement("hr"));
      quickLocations.push(sep);
    }
    // Prepend the quick-location slots, preserving order, above the paths
    quickLocations.toReversed().forEach((node) => rootUl.insertBefore(node, rootUl.firstChild));
  }

  container.appendChild(rootUl);
  revealSelectedPathSource(container.ownerDocument);
};

export const updateMenuPreview = (): void => {
  const textarea = document.querySelector<HTMLTextAreaElement>("#paths");
  const preview = document.querySelector<HTMLElement>("#menu-preview-tree");
  if (!textarea || !preview) {
    return;
  }
  renderMenuPreview(preview, buildTree(splitLines(textarea.value)));
};

export type MenuPreviewWiringPorts = {
  setValidationPending: (id: string) => void;
  renderValidationErrors: (initiator?: string) => void;
};

// Menu-only settings redraw their matching affordances immediately; the paths
// textarea itself debounces both the tree preview and live validation.
export const setupPathsPreviewWiring = (ports: MenuPreviewWiringPorts): void => {
  const textarea = document.querySelector("#paths");
  if (!textarea) {
    return;
  }

  ["#enableLastLocation", "#enableNumberedItems", "#recentDestinationCount"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("change", () => updateMenuPreview());
  });
  // The Recent locations count also redraws live as it is typed or stepped.
  document
    .querySelector("#recentDestinationCount")
    ?.addEventListener("input", () => updateMenuPreview());

  const highlightSelectedSource = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const sourceIndex: unknown = Reflect.get(event.detail ?? {}, "sourceIndex");
    if (typeof sourceIndex === "number" && Number.isInteger(sourceIndex) && sourceIndex >= 0) {
      selectPathSource(sourceIndex, { document: textarea.ownerDocument });
    }
  };
  textarea.addEventListener(SYNTAX_EDITOR_LINE_SELECTED_EVENT, highlightSelectedSource);

  let previewTimer: number | null = null;
  textarea.addEventListener("input", () => {
    ports.setValidationPending("paths");
    if (previewTimer !== null) {
      window.clearTimeout(previewTimer);
    }
    previewTimer = window.setTimeout(() => {
      previewTimer = null;
      updateMenuPreview();
      ports.renderValidationErrors("paths");
    }, MENU_PREVIEW_DEBOUNCE_MS);
  });
};
