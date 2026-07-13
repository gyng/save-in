// Directory-list editing helpers for the options page:
// - an insert menu ("+ Add") for the paths textarea: variables (with their
//   current values from the last download), separators, submenu lines
// - a visual editor (its own tab) with one row per line: indent/outdent,
//   reorder, alias editing, add/delete
// The paths textarea stays the single source of truth: every edit
// serializes back to it and fires the normal input/autosave pipeline.

import { SPECIAL_DIRS } from "../shared/constants.ts";
import { getMessage } from "../platform/localization.ts";
import { setupPathInsertMenu } from "./path-editor-insert-menu.ts";
import {
  getPathAlias,
  parseDirectoryLine,
  pathLinesToNodes,
  pathNodesToLines,
  serializeDirectoryLine,
  setPathAlias,
  updateDirectoryLine,
  type DirectoryLineNode,
  type DirectoryLineUpdate,
} from "./path-editor-model.ts";

type EditorOwner = { rebuildVisual?: () => void };
const PathEditorHelpers = {
  parseLine: parseDirectoryLine,
  serializeLine: serializeDirectoryLine,
  linesToNodes: pathLinesToNodes,
  nodesToLines: pathNodesToLines,
  getAlias: getPathAlias,
  setAlias: setPathAlias,
  updateLine: updateDirectoryLine,

  // Replaces [start, end) with text as an undoable edit: execCommand is
  // deprecated but remains the only way a programmatic edit joins the
  // browser's undo stack (it also fires input itself); setRangeText is
  // the non-undoable fallback (e.g. under jsdom)
  insertText: (textarea: HTMLTextAreaElement, text: string, start: number, end: number): void => {
    textarea.focus();
    textarea.setSelectionRange(start, end);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      textarea.setRangeText(text, start, end, "end");
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  },

  insertAtCursor: (textarea: HTMLTextAreaElement, text: string): void => {
    const start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
    const end = textarea.selectionEnd != null ? textarea.selectionEnd : start;
    PathEditorHelpers.insertText(textarea, text, start, end);
  },

  // Inserts a whole line after the line the cursor is on
  insertLine: (textarea: HTMLTextAreaElement, line: string): void => {
    const start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
    let lineEnd = textarea.value.indexOf("\n", start);
    if (lineEnd === -1) {
      lineEnd = textarea.value.length;
    }
    const glue = lineEnd > 0 ? "\n" : "";
    PathEditorHelpers.insertText(textarea, `${glue}${line}`, lineEnd, lineEnd);
  },

  setupInsertMenu: (menuSelector: string): void =>
    setupPathInsertMenu(menuSelector, PathEditorHelpers.insertLine),

  // Text/Visual sub-tabs inside the Downloads Menu tab: both edit the same
  // list; visual is the default while the textarea stays the source of truth
  setupModeToggle: (owner: EditorOwner): void => {
    const textButton = document.querySelector<HTMLElement>("#paths-mode-text");
    const visualButton = document.querySelector<HTMLElement>("#paths-mode-visual");
    const textElements = [
      document.querySelector("#paths-text-help"),
      document.querySelector("#paths-text-actions"),
      document.querySelector("#paths"),
    ] as (HTMLElement | null)[];
    const textDescription = document.querySelector<HTMLElement>("#paths-editor-description");
    if (textDescription) textElements.push(textDescription);
    const visualContainer = document.querySelector<HTMLElement>("#paths-visual");
    if (!textButton || !visualButton || !visualContainer || textElements.some((el) => !el)) {
      return;
    }
    const visibleTextElements = textElements as HTMLElement[];

    const select = (visual: boolean): void => {
      textButton.classList.toggle("active", !visual);
      visualButton.classList.toggle("active", visual);
      textButton.setAttribute("aria-selected", visual ? "false" : "true");
      visualButton.setAttribute("aria-selected", visual ? "true" : "false");
      visibleTextElements.forEach((el) => {
        el.hidden = visual;
      });
      visualContainer.hidden = !visual;
      if (visual && typeof owner.rebuildVisual === "function") {
        owner.rebuildVisual();
      }
      try {
        localStorage.setItem("saveInPathsEditorMode", visual ? "visual" : "text");
      } catch {
        // Storage may be unavailable in hardened extension contexts.
      }
    };

    textButton.addEventListener("click", () => select(false));
    visualButton.addEventListener("click", () => select(true));
    let visual = true;
    try {
      visual = localStorage.getItem("saveInPathsEditorMode") !== "text";
    } catch {}
    select(visual);
  },

  setupVisualEditor: (owner: EditorOwner): void => {
    const textarea = document.querySelector<HTMLTextAreaElement>("#paths");
    const container = document.querySelector<HTMLElement>("#path-editor-rows");
    if (!textarea || !container) {
      return;
    }

    let nodes: DirectoryLineNode[] = [];
    // Index being dragged via a row handle; null when no drag is active
    let dragFrom: number | null = null;
    let dropAfter = true;
    let dropInside = false;
    let committing = false;
    let deletedNodes: DirectoryLineNode[] | null = null;
    const updateNode = (index: number, update: DirectoryLineUpdate): void => {
      const node = nodes[index];
      if (node) nodes[index] = PathEditorHelpers.updateLine(node, update);
    };
    const normalizeHierarchy = () => {
      nodes.forEach((node, index) => {
        updateNode(index, {
          depth: index === 0 ? 0 : Math.min(node.depth, nodes[index - 1]!.depth + 1),
        });
      });
    };
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "path-editor-undo";
    undo.textContent = "Undo delete";
    undo.hidden = true;
    container.after(undo);
    const visualHelp = document.createElement("div");
    visualHelp.className = "caption path-editor-help";
    const helpLines: Array<readonly [string, string]> = [
      [
        getMessage("o_lManualEditorSaveHelp") ||
          "Changes in this editor are saved when you select Apply.",
        "manual-save-help",
      ],
      [
        getMessage("o_lPathEditorDragHelp") ||
          "Drag by the dotted handle. Drop above or below a row to place it at the same level, or onto the row to nest it inside.",
        "",
      ],
    ];
    helpLines.forEach(([copy, className]) => {
      const line = document.createElement("p");
      line.textContent = copy;
      line.className = className;
      if (className === "manual-save-help") line.dataset.manualHelpFor = "paths";
      visualHelp.append(line);
    });
    (document.querySelector(".path-editor-toolbar") ?? container).after(visualHelp);

    // Serialize rows back to the textarea (the source of truth) and let
    // the normal pipeline (autosave, previews) react
    const commit = () => {
      textarea.value = PathEditorHelpers.nodesToLines(nodes).join("\n");
      committing = true;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
      committing = false;
    };

    const render = () => {
      container.textContent = "";

      nodes.forEach((node, index) => {
        const rowEl = document.createElement("div");
        rowEl.className = "path-editor-row";
        rowEl.dataset.depth = String(node.depth);
        rowEl.style.setProperty("--row-depth", String(node.depth));

        const indentEl = document.createElement("span");
        indentEl.className = "path-editor-indent";
        indentEl.style.width = `${node.depth * 20}px`;
        indentEl.setAttribute("aria-hidden", "true");
        rowEl.appendChild(indentEl);

        // Drag to reorder: only the handle starts a drag (a draggable row
        // would fight text selection in the inputs); any row is a target
        const rowName = PathEditorHelpers.getAlias(node) || node.path.value || `row ${index + 1}`;
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "path-editor-handle";
        handle.textContent = "⠿";
        handle.title = "Drag to reorder. Drop on the middle of a row to nest under it.";
        handle.setAttribute("aria-label", `Reorder or change nesting for ${rowName}`);
        handle.draggable = true;
        handle.addEventListener("dragstart", (e) => {
          dragFrom = index;
          dropInside = false;
          rowEl.classList.add("dragging");
          if (e.dataTransfer) {
            // Firefox requires data for a drag to start
            e.dataTransfer.setData("text/plain", String(index));
            e.dataTransfer.effectAllowed = "move";
          }
        });
        handle.addEventListener("dragend", () => {
          dragFrom = null;
          dropInside = false;
          rowEl.classList.remove("dragging");
          container.querySelectorAll(".path-editor-drop-indicator").forEach((el) => el.remove());
        });
        handle.addEventListener("keydown", (event) => {
          if (
            !event.altKey ||
            !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
          )
            return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            if (event.key === "ArrowLeft") {
              updateNode(index, { depth: Math.max(0, node.depth - 1) });
            } else if (index > 0) {
              updateNode(index, {
                depth: Math.min(node.depth + 1, nodes[index - 1]!.depth + 1),
              });
            }
            commit();
            rebuild();
            container.querySelectorAll<HTMLElement>(".path-editor-handle")[index]?.focus();
            return;
          }
          const destination = event.key === "ArrowUp" ? index - 1 : index + 1;
          if (destination < 0 || destination >= nodes.length) return;
          event.preventDefault();
          const [moved] = nodes.splice(index, 1);
          if (moved) nodes.splice(destination, 0, moved);
          normalizeHierarchy();
          commit();
          rebuild();
          container.querySelectorAll<HTMLElement>(".path-editor-handle")[destination]?.focus();
        });
        rowEl.appendChild(handle);

        rowEl.addEventListener("dragover", (e) => {
          if (dragFrom !== null) {
            e.preventDefault();
            const bounds = rowEl.getBoundingClientRect();
            const relativeY = bounds.height ? (e.clientY - bounds.top) / bounds.height : 1;
            dropInside =
              dragFrom !== index &&
              node.path.value !== SPECIAL_DIRS.SEPARATOR &&
              relativeY >= 1 / 3 &&
              relativeY <= 2 / 3;
            dropAfter = relativeY > 2 / 3;
            rowEl.classList.toggle("drag-before", !dropAfter && !dropInside);
            rowEl.classList.toggle("drag-after", dropAfter && !dropInside);
            rowEl.classList.toggle("drag-inside", dropInside);
            container.querySelectorAll(".path-editor-drop-indicator").forEach((el) => el.remove());
            const indicator = document.createElement("span");
            indicator.className = "path-editor-drop-indicator";
            indicator.textContent = dropInside
              ? `Nest under “${rowName}”`
              : `${dropAfter ? "Insert after" : "Insert before"} · Same level`;
            rowEl.append(indicator);
          }
        });
        rowEl.addEventListener("dragleave", () => {
          rowEl.classList.remove("drag-before", "drag-after", "drag-inside");
          rowEl.querySelector(".path-editor-drop-indicator")?.remove();
        });
        rowEl.addEventListener("drop", (e) => {
          e.preventDefault();
          rowEl.classList.remove("drag-before", "drag-after", "drag-inside");
          rowEl.querySelector(".path-editor-drop-indicator")?.remove();
          if (dragFrom === null) return;
          if (dragFrom === index) {
            dragFrom = null;
            dropInside = false;
            return;
          }
          const target = nodes[index];
          const [moved] = nodes.splice(dragFrom, 1);
          const adjustedTarget = dragFrom < index ? index - 1 : index;
          const targetIndex = target ? nodes.indexOf(target) : -1;
          const destination = dropInside ? targetIndex + 1 : adjustedTarget + (dropAfter ? 1 : 0);
          if (moved) {
            nodes.splice(
              destination,
              0,
              PathEditorHelpers.updateLine(moved, {
                depth: dropInside ? (target?.depth ?? 0) + 1 : (target?.depth ?? 0),
              }),
            );
          }
          normalizeHierarchy();
          dragFrom = null;
          dropInside = false;
          commit();
          rebuild();
        });

        const actions = document.createElement("div");
        actions.className = "path-editor-actions";

        if (node.path.value === SPECIAL_DIRS.SEPARATOR) {
          const sep = document.createElement("span");
          sep.className = "path-editor-separator";
          sep.textContent = "separator";
          rowEl.appendChild(sep);
        } else {
          const dir = document.createElement("input");
          dir.type = "text";
          dir.className = "path-editor-dir";
          dir.value = node.path.value;
          dir.placeholder = "directory/:variables:";
          dir.spellcheck = false;
          dir.setAttribute("aria-label", `Directory ${index + 1}`);
          dir.addEventListener("input", () => {
            updateNode(index, { path: dir.value });
            commit();
          });
          rowEl.appendChild(dir);

          const alias = document.createElement("input");
          alias.type = "text";
          alias.className = "path-editor-alias";
          alias.value = PathEditorHelpers.getAlias(node);
          alias.placeholder = "alias";
          const aliasOpen = Boolean(alias.value);
          alias.classList.toggle("is-open", aliasOpen);
          alias.tabIndex = aliasOpen ? 0 : -1;
          alias.setAttribute("aria-hidden", String(!aliasOpen));
          alias.setAttribute("aria-label", `Display name for directory ${index + 1}`);
          alias.addEventListener("input", () => {
            const current = nodes[index];
            if (current) nodes[index] = PathEditorHelpers.setAlias(current, alias.value);
            commit();
          });
          const aliasToggle = document.createElement("button");
          aliasToggle.type = "button";
          aliasToggle.className = "path-editor-alias-toggle";
          aliasToggle.textContent = "Alias";
          aliasToggle.setAttribute("aria-expanded", String(aliasOpen));
          aliasToggle.addEventListener("click", () => {
            const open = !alias.classList.contains("is-open");
            alias.classList.toggle("is-open", open);
            alias.tabIndex = open ? 0 : -1;
            alias.setAttribute("aria-hidden", String(!open));
            aliasToggle.setAttribute("aria-expanded", String(open));
            if (open) {
              alias.focus();
              alias.select();
            }
          });
          rowEl.append(alias);
          actions.append(aliasToggle);
        }

        const controls: [string, string, () => void][] = [
          [
            "◀",
            "outdent",
            () => {
              updateNode(index, { depth: Math.max(0, node.depth - 1) });
            },
          ],
          [
            "▶",
            "indent",
            () => {
              if (index > 0 && node.depth < nodes[index - 1]!.depth + 1) {
                updateNode(index, { depth: node.depth + 1 });
              }
            },
          ],
          [
            "▲",
            "move up",
            () => {
              if (index > 0) {
                const moved = nodes.splice(index, 1)[0];
                if (moved) nodes.splice(index - 1, 0, moved);
              }
            },
          ],
          [
            "▼",
            "move down",
            () => {
              if (index < nodes.length - 1) {
                const moved = nodes.splice(index, 1)[0];
                if (moved) nodes.splice(index + 1, 0, moved);
              }
            },
          ],
          [
            "✕",
            "delete",
            () => {
              deletedNodes = nodes.slice();
              const deletedDepth = node.depth;
              nodes.splice(index, 1);
              for (
                let child = index;
                child < nodes.length && nodes[child]!.depth > deletedDepth;
                child++
              ) {
                updateNode(child, { depth: nodes[child]!.depth - 1 });
              }
              undo.hidden = false;
            },
          ],
        ];

        controls.forEach(([glyph, title, action]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "path-editor-control";
          button.title = title;
          button.setAttribute(
            "aria-label",
            `${title[0]!.toUpperCase()}${title.slice(1)} ${rowName}`,
          );
          button.textContent = glyph;
          if (title === "outdent") button.disabled = node.depth === 0;
          if (title === "indent")
            button.disabled = index === 0 || node.depth >= nodes[index - 1]!.depth + 1;
          if (title === "move up") button.disabled = index === 0;
          if (title === "move down") button.disabled = index === nodes.length - 1;
          button.addEventListener("click", () => {
            action();
            if (title === "move up" || title === "move down") normalizeHierarchy();
            commit();
            rebuild();
          });
          actions.appendChild(button);
        });

        rowEl.append(actions);

        container.appendChild(rowEl);
      });
    };

    const rebuild = () => {
      nodes = PathEditorHelpers.linesToNodes(textarea.value);
      render();
    };
    // The mode toggle forces a rebuild when switching into visual mode
    owner.rebuildVisual = rebuild;

    undo.addEventListener("click", () => {
      if (!deletedNodes) return;
      nodes = deletedNodes;
      deletedNodes = null;
      undo.hidden = true;
      commit();
      rebuild();
    });

    document.querySelector("#path-editor-add-dir")?.addEventListener("click", () => {
      nodes.push(PathEditorHelpers.parseLine("new-folder"));
      commit();
      rebuild();
      const input = container.lastElementChild?.querySelector<HTMLInputElement>(".path-editor-dir");
      input?.focus();
      input?.select();
    });
    document.querySelector("#path-editor-add-sep")?.addEventListener("click", () => {
      nodes.push(PathEditorHelpers.parseLine(SPECIAL_DIRS.SEPARATOR));
      commit();
      rebuild();
    });

    // Follow textarea edits made anywhere (typing in the Downloads tab,
    // templates, restore); our own commits also funnel through this
    let rebuildTimer: number | null = null;
    textarea.addEventListener("input", () => {
      if (committing) return;
      if (rebuildTimer !== null) {
        window.clearTimeout(rebuildTimer);
      }
      rebuildTimer = window.setTimeout(() => {
        rebuildTimer = null;
        rebuild();
      }, 300);
    });

    // restoreOptions fills the textarea programmatically (no input event)
    window.setTimeout(rebuild, 1000);
  },
};

export class PathEditor {
  rebuildVisual?: () => void;

  static parseLine = PathEditorHelpers.parseLine;
  static serializeLine = PathEditorHelpers.serializeLine;
  static linesToNodes = PathEditorHelpers.linesToNodes;
  static nodesToLines = PathEditorHelpers.nodesToLines;
  static getAlias = PathEditorHelpers.getAlias;
  static setAlias = PathEditorHelpers.setAlias;
  static insertText = PathEditorHelpers.insertText;
  static insertAtCursor = PathEditorHelpers.insertAtCursor;
  static insertLine = PathEditorHelpers.insertLine;

  setupInsertMenu(menuSelector: string): void {
    PathEditorHelpers.setupInsertMenu(menuSelector);
  }

  setupModeToggle() {
    PathEditorHelpers.setupModeToggle(this);
  }

  setupVisualEditor() {
    PathEditorHelpers.setupVisualEditor(this);
  }
}

export const setupPathEditor = () => {
  const editor = new PathEditor();
  editor.setupInsertMenu("#rules-clause-menu");
  editor.setupVisualEditor();
  editor.setupModeToggle();
};
