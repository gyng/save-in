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
import { bindTabInteractions, syncTabSelection } from "./tab-controls.ts";
import {
  deletePathNode,
  dropPathNode,
  getPathAlias,
  getPathEnabled,
  parseDirectoryLine,
  pathLinesToNodes,
  pathNodesToLines,
  serializeDirectoryLine,
  reorderPathNode,
  setPathAlias,
  setPathEnabled,
  updateDirectoryLine,
  type DirectoryLineNode,
  type DirectoryLineUpdate,
} from "./path-editor-model.ts";
import {
  clearValidationFields,
  EDITOR_VALIDATION_EVENT,
  markValidationField,
  validationFeedbackFromEvent,
  validationFeedbackLabel,
  type EditorValidationFeedback,
} from "./editor-validation.ts";

type EditorOwner = { rebuildVisual?: () => void };
const PathEditorHelpers = {
  parseLine: parseDirectoryLine,
  serializeLine: serializeDirectoryLine,
  linesToNodes: pathLinesToNodes,
  nodesToLines: pathNodesToLines,
  getAlias: getPathAlias,
  getEnabled: getPathEnabled,
  setAlias: setPathAlias,
  setEnabled: setPathEnabled,
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
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    PathEditorHelpers.insertText(textarea, text, start, end);
  },

  // Inserts a whole line after the line the cursor is on
  insertLine: (textarea: HTMLTextAreaElement, line: string): void => {
    const start = textarea.selectionStart;
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
    const pathsTextarea = document.querySelector<HTMLElement>("#paths");
    const textContainer = document.querySelector<HTMLElement>("#paths-text-editor");
    const visualContainer = document.querySelector<HTMLElement>("#paths-visual");
    if (!textButton || !visualButton || !textContainer || !visualContainer || !pathsTextarea) {
      return;
    }

    const select = (visual: boolean): void => {
      syncTabSelection(
        [textButton, visualButton],
        [textContainer, visualContainer],
        visual ? 1 : 0,
      );
      pathsTextarea.dispatchEvent(
        new CustomEvent("syntax-editor-visibility", {
          detail: { visible: !visual },
        }),
      );
      if (visual && typeof owner.rebuildVisual === "function") {
        owner.rebuildVisual();
      }
      try {
        localStorage.setItem("saveInPathsEditorMode", visual ? "visual" : "text");
      } catch {
        // Storage may be unavailable in hardened extension contexts.
      }
    };

    bindTabInteractions([textButton, visualButton], (index, focus) => {
      select(index === 1);
      if (focus) [textButton, visualButton][index]?.focus();
    });
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
    let validationErrors: readonly EditorValidationFeedback[] = [];

    const clearValidationAppearance = (): void => {
      container
        .querySelectorAll<HTMLElement>(
          ".has-validation-error, .has-validation-warning, [data-validation-message]",
        )
        .forEach((row) => {
          row.classList.remove("has-validation-error", "has-validation-warning");
          if (row.dataset.validationMessage !== undefined) {
            row.removeAttribute("title");
            delete row.dataset.validationMessage;
          }
        });
      clearValidationFields(container);
    };

    const applyValidationAppearance = (): void => {
      clearValidationAppearance();
      validationErrors.forEach((error) => {
        if (error.sourceIndex === undefined) return;
        const row = container.querySelector<HTMLElement>(
          `.path-editor-row[data-source-index="${error.sourceIndex}"]`,
        );
        if (!row) return;
        row.classList.add(error.warning ? "has-validation-warning" : "has-validation-error");
        const label = validationFeedbackLabel(error);
        row.dataset.validationMessage = label;
        row.title = label;
        if (!error.warning) {
          markValidationField(row.querySelector<HTMLElement>(".path-editor-dir"), "error-paths");
        }
      });
    };
    const updateNode = (index: number, update: DirectoryLineUpdate): void => {
      const current = nodes[index];
      if (current) nodes[index] = PathEditorHelpers.updateLine(current, update);
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
        getMessage("o_lPathEditorDragHelp") ||
          "Drag by the dotted handle. Drop above or below a row to place it at the same level, or onto the row to nest it inside.",
        "",
      ],
    ];
    helpLines.forEach(([copy, className]) => {
      const line = document.createElement("p");
      line.textContent = copy;
      line.className = className;
      visualHelp.append(line);
    });
    (document.querySelector(".path-editor-toolbar") ?? container).after(visualHelp);

    // Serialize rows back to the textarea (the source of truth) and let
    // the normal pipeline (autosave, previews) react
    const commit = () => {
      textarea.value = PathEditorHelpers.nodesToLines(nodes).join("\n");
      validationErrors = [];
      clearValidationAppearance();
      committing = true;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
      committing = false;
    };

    const render = () => {
      container.textContent = "";

      nodes.forEach((node, index) => {
        const rowEl = document.createElement("div");
        rowEl.className = "visual-editor-row path-editor-row";
        rowEl.dataset.depth = String(node.depth);
        rowEl.dataset.sourceIndex = String(index);
        rowEl.style.setProperty("--row-depth", String(node.depth));
        rowEl.classList.toggle("is-disabled", !PathEditorHelpers.getEnabled(node));
        rowEl.addEventListener("click", () => {
          container
            .querySelectorAll(".path-editor-row.is-preview-selected")
            .forEach((row) => row.classList.remove("is-preview-selected"));
          rowEl.classList.add("is-preview-selected");
          document
            .querySelectorAll<HTMLElement>("#menu-preview-tree [data-source-index]")
            .forEach((previewRow) => {
              previewRow.classList.toggle(
                "is-source-selected",
                Number(previewRow.dataset.sourceIndex) === index,
              );
            });
          textarea.dispatchEvent(
            new CustomEvent("path-editor-row-selected", {
              bubbles: true,
              detail: { sourceIndex: index },
            }),
          );
        });

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
        handle.className = "visual-editor-handle path-editor-handle";
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
              const previous = nodes[index - 1];
              if (!previous) return;
              updateNode(index, {
                depth: Math.min(node.depth + 1, previous.depth + 1),
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
          nodes = reorderPathNode(nodes, index, destination);
          commit();
          rebuild();
          container.querySelectorAll<HTMLElement>(".path-editor-handle")[destination]?.focus();
        });
        rowEl.appendChild(handle);

        const enabledControl = document.createElement("span");
        enabledControl.className = "visual-editor-enabled path-editor-enabled-control";
        const enabled = document.createElement("input");
        enabled.type = "checkbox";
        enabled.className = "path-editor-enabled";
        enabled.name = "path-enabled";
        enabled.checked = PathEditorHelpers.getEnabled(node);
        enabled.setAttribute(
          "aria-label",
          `${getMessage("visualEditorEnabled") || "Enabled"}: ${rowName}`,
        );
        enabled.addEventListener("change", () => {
          const current = nodes[index];
          if (!current) return;
          nodes[index] = PathEditorHelpers.setEnabled(current, enabled.checked);
          commit();
          rebuild();
        });
        enabledControl.append(enabled);
        rowEl.append(enabledControl);

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
          nodes = dropPathNode(
            nodes,
            dragFrom,
            index,
            dropInside ? "inside" : dropAfter ? "after" : "before",
          );
          dragFrom = null;
          dropInside = false;
          commit();
          rebuild();
        });

        const actions = document.createElement("div");
        actions.className = "visual-editor-row-actions path-editor-actions";

        if (node.path.value === SPECIAL_DIRS.SEPARATOR) {
          const sep = document.createElement("span");
          sep.className = "path-editor-separator";
          sep.textContent = "separator";
          rowEl.appendChild(sep);
        } else {
          const dir = document.createElement("input");
          dir.type = "text";
          dir.className = "path-editor-dir";
          dir.name = "path-directory";
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
          alias.name = "path-alias";
          alias.value = PathEditorHelpers.getAlias(node);
          alias.placeholder = "alias";
          const aliasOpen = Boolean(alias.value);
          alias.classList.toggle("is-open", aliasOpen);
          alias.tabIndex = aliasOpen ? 0 : -1;
          alias.setAttribute("aria-hidden", String(!aliasOpen));
          alias.setAttribute("aria-label", `Display name for directory ${index + 1}`);
          alias.addEventListener("input", () => {
            const current = nodes[index];
            if (!current) return;
            nodes[index] = PathEditorHelpers.setAlias(current, alias.value);
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
              updateNode(index, { depth: node.depth + 1 });
            },
          ],
          [
            "▲",
            "move up",
            () => {
              nodes = reorderPathNode(nodes, index, index - 1);
            },
          ],
          [
            "▼",
            "move down",
            () => {
              nodes = reorderPathNode(nodes, index, index + 1);
            },
          ],
          [
            "✕",
            "delete",
            () => {
              deletedNodes = nodes.slice();
              nodes = deletePathNode(nodes, index);
              undo.hidden = false;
            },
          ],
        ];

        controls.forEach(([glyph, title, action]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "visual-editor-control path-editor-control";
          button.title = title;
          button.setAttribute(
            "aria-label",
            `${(title[0] ?? "").toUpperCase()}${title.slice(1)} ${rowName}`,
          );
          button.textContent = glyph;
          if (title === "outdent") button.disabled = node.depth === 0;
          if (title === "indent") {
            const previousDepth = nodes[index - 1]?.depth;
            button.disabled = previousDepth === undefined || node.depth >= previousDepth + 1;
          }
          if (title === "move up") button.disabled = index === 0;
          if (title === "move down") button.disabled = index === nodes.length - 1;
          button.addEventListener("click", () => {
            action();
            commit();
            rebuild();
          });
          actions.appendChild(button);
        });

        rowEl.append(actions);

        container.appendChild(rowEl);
      });
      applyValidationAppearance();
      textarea.dispatchEvent(new Event("visual-editor-rendered"));
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
      validationErrors = [];
      clearValidationAppearance();
      if (committing) return;
      if (rebuildTimer !== null) {
        window.clearTimeout(rebuildTimer);
      }
      rebuildTimer = window.setTimeout(() => {
        rebuildTimer = null;
        rebuild();
      }, 300);
    });
    textarea.addEventListener(EDITOR_VALIDATION_EVENT, (event) => {
      validationErrors = validationFeedbackFromEvent(event);
      applyValidationAppearance();
    });

    // restoreOptions fills the textarea programmatically (no input event).
    document.addEventListener("options-restored", rebuild);
  },
};

export class PathEditor {
  rebuildVisual?: () => void;

  static parseLine = PathEditorHelpers.parseLine;
  static serializeLine = PathEditorHelpers.serializeLine;
  static linesToNodes = PathEditorHelpers.linesToNodes;
  static nodesToLines = PathEditorHelpers.nodesToLines;
  static getAlias = PathEditorHelpers.getAlias;
  static getEnabled = PathEditorHelpers.getEnabled;
  static setAlias = PathEditorHelpers.setAlias;
  static setEnabled = PathEditorHelpers.setEnabled;
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
