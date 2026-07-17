// This file is long and stays one file on purpose. Everything in it serves one
// job — the drag-and-drop directory-tree editor — so its row rendering was
// decomposed into named builders rather than split into modules, the same shape
// rule-visual-editor.ts has. Long is not the same as tangled; splitting here
// would invent seams the feature does not have.
//
// Directory-list editing helpers for the options page:
// - an insert menu ("+ Add") for the paths textarea: variables (with their
//   current values from the last download), separators, submenu lines
// - a visual editor (its own tab) with one row per line: indent/outdent,
//   reorder, alias/access-key editing, add/delete
// The paths textarea stays the single source of truth: every edit
// serializes back to it and fires the normal input/autosave pipeline.

import { MESSAGE_TYPES, SPECIAL_DIRS } from "../../shared/constants.ts";
import { getMessage } from "../../platform/localization.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { buildTree, type MenuTreeItem } from "../../menus/menu-tree.ts";
import { resolveMenuAccessKey } from "../../menus/access-key.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import { attachAutocomplete } from "../syntax-editor/autocomplete.ts";
import { setupPathInsertMenu } from "./path-editor-insert-menu.ts";
import { completeDirectorySyntax } from "../syntax-editor/syntax-editor-model.ts";
import { bindTabInteractions, syncTabSelection } from "../core/tab-controls.ts";
import { registerPathSourceElement, selectPathSource } from "./path-source-selection.ts";
import { sortVariables } from "../core/vocabulary-groups.ts";
import {
  deletePathNode,
  dropPathNode,
  getPathAccessKey,
  getPathDialog,
  getPathAlias,
  getPathEnabled,
  parseDirectoryLine,
  pathLinesToNodes,
  pathNodesToLines,
  serializeDirectoryLine,
  reorderPathNode,
  setPathAccessKey,
  setPathDialog,
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
} from "../syntax-editor/editor-validation.ts";

type EditorOwner = { rebuildVisual?: () => void };
type TextField = HTMLInputElement | HTMLTextAreaElement;

// One entry in a row's "more" menu. `run` only edits nodes — the menu wiring
// owns committing and re-rendering, so every action behaves the same way.
type RowControl = {
  action: string;
  label: string;
  accessible: string;
  disabled: boolean;
  run: () => void;
  danger?: boolean;
  pressed?: boolean;
};

// What a row needs from the tree as a whole, resolved once per render: a row's
// access-key placeholder depends on the numbering its siblings produce.
type RenderPass = {
  showNumberedItems: boolean;
  menuItems: Map<number, Extract<MenuTreeItem, { kind: "path" }>>;
};

const localize = (
  key: string,
  fallback: string,
  substitutions?: string | number | Array<string | number>,
): string => getMessage(key, substitutions) || fallback;

const ALIAS_UNBALANCED = "Not saved: parentheses must be balanced.";

const PathEditorHelpers = {
  parseLine: parseDirectoryLine,
  serializeLine: serializeDirectoryLine,
  linesToNodes: pathLinesToNodes,
  nodesToLines: pathNodesToLines,
  getAlias: getPathAlias,
  getAccessKey: getPathAccessKey,
  getDialog: getPathDialog,
  getEnabled: getPathEnabled,
  setAlias: setPathAlias,
  setAccessKey: setPathAccessKey,
  setDialog: setPathDialog,
  setEnabled: setPathEnabled,
  updateLine: updateDirectoryLine,

  // Replaces [start, end) with text as an undoable edit: execCommand is
  // deprecated but remains the only way a programmatic edit joins the
  // browser's undo stack (it also fires input itself); setRangeText is
  // the non-undoable fallback (e.g. under jsdom)
  insertText: (field: TextField, text: string, start: number, end: number): void => {
    field.focus();
    field.setSelectionRange(start, end);
    let inserted = false;
    if (document.activeElement === field) {
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch {
        inserted = false;
      }
    }
    if (!inserted) {
      field.setRangeText(text, start, end, "end");
      field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  },

  insertAtCursor: (field: TextField, text: string): void => {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    PathEditorHelpers.insertText(field, text, start, end);
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
    const validationSummary = document.querySelector<HTMLElement>("#error-paths");
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
      if (validationSummary) {
        if (visual) {
          visualContainer.after(validationSummary);
        } else {
          textContainer.querySelector(".editor-actions")?.after(validationSummary);
        }
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
    let committing = false;
    let deletedNodes: DirectoryLineNode[] | null = null;
    let validationErrors: readonly EditorValidationFeedback[] = [];
    let variables: string[] = [];
    let editorControlCleanups: Array<() => void> = [];
    const openMenuSelector = ".path-editor-more[open]";

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        document.querySelectorAll<HTMLDetailsElement>(openMenuSelector).forEach((menu) => {
          if (!menu.contains(target)) menu.open = false;
        });
      },
      { capture: true },
    );
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const menus = [...document.querySelectorAll<HTMLDetailsElement>(openMenuSelector)];
      const activeMenu = menus.find((menu) => menu.contains(document.activeElement));
      menus.forEach((menu) => (menu.open = false));
      activeMenu?.querySelector<HTMLElement>("summary")?.focus();
    });

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
    undo.textContent = localize("pathVisualUndoDelete", "Undo delete");
    undo.hidden = true;
    const visualSaveActions = container
      .closest("#paths-visual")
      ?.querySelector<HTMLElement>(".editor-save-actions");
    const discard = visualSaveActions?.querySelector<HTMLElement>('[data-discard="paths"]');
    if (discard) discard.before(undo);
    else if (visualSaveActions) visualSaveActions.prepend(undo);
    else container.after(undo);
    const visualHelp = document.createElement("div");
    visualHelp.className = "caption path-editor-help";
    const helpLines: Array<readonly [string, string]> = [
      [
        localize(
          "o_lPathEditorDragHelp",
          "Drag by the dotted handle. Drop above or below a row to place it at the same level, or onto the row to nest it inside.",
        ),
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

    const clearDropAppearance = (): void => {
      container
        .querySelectorAll(".path-editor-row.drag-inside")
        .forEach((row) => row.classList.remove("drag-inside"));
      container
        .querySelectorAll(".path-editor-drop-zone.is-active")
        .forEach((zone) => zone.classList.remove("is-active"));
      container.querySelectorAll(".path-editor-drop-indicator").forEach((el) => el.remove());
    };

    // The gap between two rows: a drop here places the dragged row at that
    // boundary as a sibling, which is how a row leaves its parent.
    const appendBoundaryDropZone = (boundaryIndex: number): void => {
      const zone = document.createElement("div");
      zone.className = "path-editor-drop-zone";
      zone.dataset.boundaryIndex = String(boundaryIndex);
      zone.setAttribute("aria-hidden", "true");
      zone.addEventListener("dragover", (event) => {
        if (dragFrom === null) return;
        event.preventDefault();
        if (zone.classList.contains("is-active")) return;
        clearDropAppearance();
        zone.classList.add("is-active");
        const indicator = document.createElement("span");
        indicator.className = "path-editor-drop-indicator";
        indicator.textContent = localize("pathVisualMoveHere", "Move here");
        zone.append(indicator);
      });
      zone.addEventListener("dragleave", (event) => {
        if (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget)) return;
        zone.classList.remove("is-active");
        zone.querySelector(".path-editor-drop-indicator")?.remove();
      });
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        clearDropAppearance();
        if (dragFrom === null) return;
        if (boundaryIndex < nodes.length) {
          nodes = dropPathNode(nodes, dragFrom, boundaryIndex, "before");
        } else if (nodes.length > 0) {
          nodes = dropPathNode(nodes, dragFrom, nodes.length - 1, "after");
        }
        dragFrom = null;
        container.classList.remove("is-dragging");
        commit();
        rebuild();
      });
      container.append(zone);
    };

    // Every control on a row names the row it acts on, so they share one label.
    const rowLabel = (node: DirectoryLineNode, index: number): string =>
      PathEditorHelpers.getAlias(node) ||
      node.path.value ||
      localize("pathVisualDirectoryAccessible", `Folder ${index + 1}`, index + 1);

    const buildIndent = (node: DirectoryLineNode): HTMLElement => {
      const indentEl = document.createElement("span");
      indentEl.className = "path-editor-indent";
      indentEl.style.width = `${node.depth * 20}px`;
      indentEl.setAttribute("aria-hidden", "true");
      return indentEl;
    };

    // Alt+arrows are the handle's keyboard equivalent: left/right change
    // nesting, up/down reorder. Focus follows the row to its new position.
    const moveByKeyboard = (event: KeyboardEvent, node: DirectoryLineNode, index: number): void => {
      if (!event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key))
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
    };

    // Drag to reorder: only the handle starts a drag (a draggable row
    // would fight text selection in the inputs); any row is a target
    const buildHandle = (
      node: DirectoryLineNode,
      index: number,
      rowEl: HTMLElement,
      rowName: string,
    ): HTMLButtonElement => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "visual-editor-handle path-editor-handle";
      handle.textContent = "⠿";
      handle.title = localize(
        "pathVisualReorderHelp",
        "Drag to reorder. Drop on the middle of a row to nest under it.",
      );
      handle.setAttribute(
        "aria-label",
        localize(
          "pathVisualReorderAccessible",
          `Reorder or change nesting for ${rowName}`,
          rowName,
        ),
      );
      handle.draggable = true;
      handle.addEventListener("dragstart", (e) => {
        dragFrom = index;
        container.classList.add("is-dragging");
        rowEl.classList.add("dragging");
        if (e.dataTransfer) {
          // Firefox requires data for a drag to start
          e.dataTransfer.setData("text/plain", String(index));
          e.dataTransfer.effectAllowed = "move";
        }
      });
      handle.addEventListener("dragend", () => {
        dragFrom = null;
        container.classList.remove("is-dragging");
        rowEl.classList.remove("dragging");
        clearDropAppearance();
      });
      handle.addEventListener("keydown", (event) => moveByKeyboard(event, node, index));
      return handle;
    };

    const buildEnabledControl = (
      node: DirectoryLineNode,
      index: number,
      rowName: string,
    ): HTMLElement => {
      const enabledControl = document.createElement("span");
      enabledControl.className = "visual-editor-enabled path-editor-enabled-control";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.className = "path-editor-enabled";
      enabled.name = "path-enabled";
      enabled.checked = PathEditorHelpers.getEnabled(node);
      enabled.title = localize("visualEditorEnabled", "Enabled");
      enabled.setAttribute(
        "aria-label",
        localize("pathVisualEnabledAccessible", `Enabled: ${rowName}`, rowName),
      );
      enabled.addEventListener("change", () => {
        const current = nodes[index];
        if (!current) return;
        nodes[index] = PathEditorHelpers.setEnabled(current, enabled.checked);
        commit();
        rebuild();
      });
      enabledControl.append(enabled);
      return enabledControl;
    };

    // Dropping onto the row itself nests the dragged row inside it. A separator
    // holds nothing, so it is never a nesting target.
    const wireRowDropTarget = (
      rowEl: HTMLElement,
      node: DirectoryLineNode,
      index: number,
      rowName: string,
    ): void => {
      const nestable = (): boolean =>
        dragFrom !== null && dragFrom !== index && node.path.value !== SPECIAL_DIRS.SEPARATOR;
      rowEl.addEventListener("dragover", (e) => {
        if (!nestable()) return;
        e.preventDefault();
        if (rowEl.classList.contains("drag-inside")) return;
        clearDropAppearance();
        rowEl.classList.add("drag-inside");
        const indicator = document.createElement("span");
        indicator.className = "path-editor-drop-indicator";
        indicator.textContent = localize("pathVisualNestUnder", `Nest under “${rowName}”`, rowName);
        rowEl.append(indicator);
      });
      rowEl.addEventListener("dragleave", (event) => {
        if (event.relatedTarget instanceof Node && rowEl.contains(event.relatedTarget)) return;
        rowEl.classList.remove("drag-inside");
        rowEl.querySelector(".path-editor-drop-indicator")?.remove();
      });
      rowEl.addEventListener("drop", (e) => {
        e.preventDefault();
        clearDropAppearance();
        if (dragFrom === null || !nestable()) return;
        nodes = dropPathNode(nodes, dragFrom, index, "inside");
        dragFrom = null;
        container.classList.remove("is-dragging");
        commit();
        rebuild();
      });
    };

    const buildDirectoryInput = (node: DirectoryLineNode, index: number): HTMLInputElement => {
      const dir = document.createElement("input");
      dir.type = "text";
      dir.className = "path-editor-dir";
      dir.name = "path-directory";
      dir.value = node.path.value;
      dir.placeholder = localize("pathVisualDirectoryPlaceholder", "folder/:variables:");
      dir.spellcheck = false;
      dir.setAttribute(
        "aria-label",
        localize("pathVisualDirectoryAccessible", `Folder ${index + 1}`, index + 1),
      );
      dir.addEventListener("input", () => {
        updateNode(index, { path: dir.value });
        commit();
      });
      if (variables.length > 0) {
        editorControlCleanups.push(
          attachAutocomplete(dir, (source, caret) =>
            completeDirectorySyntax(source, caret, variables),
          ),
        );
      }
      return dir;
    };

    // The display name and the button that reveals it. They are built together
    // because each keeps the other in sync: the toggle marks itself as carrying
    // a value, and typing a name updates that mark.
    const buildAliasControls = (
      node: DirectoryLineNode,
      index: number,
    ): { alias: HTMLInputElement; aliasToggle: HTMLButtonElement } => {
      const alias = document.createElement("input");
      alias.type = "text";
      alias.className = "path-editor-alias";
      alias.name = "path-alias";
      alias.value = PathEditorHelpers.getAlias(node);
      alias.placeholder = localize("pathVisualAliasPlaceholder", "Display name");
      const aliasOpen = Boolean(alias.value);
      alias.classList.toggle("is-open", aliasOpen);
      alias.tabIndex = aliasOpen ? 0 : -1;
      alias.setAttribute("aria-hidden", String(!aliasOpen));
      alias.setAttribute(
        "aria-label",
        localize("pathVisualAliasAccessible", `Display name for folder ${index + 1}`, index + 1),
      );

      const aliasToggle = document.createElement("button");
      aliasToggle.type = "button";
      aliasToggle.className = "path-editor-alias-toggle";
      aliasToggle.classList.toggle("has-value", Boolean(alias.value));
      aliasToggle.textContent = localize("pathVisualAlias", "Alias");
      aliasToggle.setAttribute("aria-expanded", String(aliasOpen));

      // setAlias only writes a name the stored syntax can give back, so an
      // unbalanced one leaves the node untouched. Report that on the field
      // itself: the value never reaches the text the routing validation
      // reads, so its error pass cannot see this and would clear an
      // aria-invalid mark on its next run.
      const markAliasRejected = (): void => {
        const stored = nodes[index];
        const rejected = stored !== undefined && alias.value !== PathEditorHelpers.getAlias(stored);
        alias.classList.toggle("path-editor-alias-rejected", rejected);
        if (rejected) alias.title = localize("pathVisualAliasUnbalanced", ALIAS_UNBALANCED);
        else alias.removeAttribute("title");
      };
      alias.addEventListener("input", () => {
        const current = nodes[index];
        if (!current) return;
        aliasToggle.classList.toggle("has-value", Boolean(alias.value));
        nodes[index] = PathEditorHelpers.setAlias(current, alias.value);
        // A name with parentheses is transiently unbalanced while it is
        // typed, so only a finished one is judged; clear a stale mark as
        // soon as the name becomes storable again.
        if (alias.classList.contains("path-editor-alias-rejected")) markAliasRejected();
        commit();
      });
      alias.addEventListener("blur", markAliasRejected);
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
      return { alias, aliasToggle };
    };

    const buildAccessKeyControl = (
      node: DirectoryLineNode,
      index: number,
      rowName: string,
      pass: RenderPass,
    ): HTMLElement => {
      const accessKeyLabel = getMessage("html_key") || "Key";
      const accessKeyAssignment = getMessage("html_assignAnAccessKey") || "Assign an access key";
      const accessKeyControl = document.createElement("label");
      accessKeyControl.className = "path-editor-access-key";
      accessKeyControl.title = accessKeyAssignment;
      const accessKeyMarker = document.createElement("span");
      accessKeyMarker.className = "path-editor-access-key-label";
      accessKeyMarker.textContent = accessKeyLabel;
      accessKeyMarker.setAttribute("aria-hidden", "true");
      const accessKey = document.createElement("input");
      accessKey.type = "text";
      accessKey.className = "path-editor-access-key-input";
      accessKey.name = "path-access-key";
      accessKey.value = PathEditorHelpers.getAccessKey(node);
      // The placeholder shows the key the menu would assign on its own, which
      // only exists once the whole tree is numbered.
      const menuItem = pass.menuItems.get(index);
      accessKey.placeholder =
        pass.showNumberedItems && menuItem && menuItem.accessKeyOverride !== ""
          ? (resolveMenuAccessKey(menuItem.number) ?? "")
          : "";
      accessKey.maxLength = 1;
      accessKey.spellcheck = false;
      accessKey.setAttribute(
        "aria-label",
        localize("pathVisualAccessKeyAccessible", `${accessKeyAssignment}: ${rowName}`, rowName),
      );
      accessKey.addEventListener("input", () => {
        const current = nodes[index];
        if (!current) return;
        const key = [...accessKey.value][0] ?? "";
        accessKey.value = key;
        nodes[index] = PathEditorHelpers.setAccessKey(current, key);
        commit();
      });
      accessKeyControl.append(accessKeyMarker, accessKey);
      return accessKeyControl;
    };

    // Every action reachable from the row's "more" menu. Each one only edits
    // nodes; the menu wiring commits and re-renders once, for all of them.
    const rowActionControls = (
      node: DirectoryLineNode,
      index: number,
      rowName: string,
    ): RowControl[] => {
      const previousNode = nodes[index - 1];
      return [
        ...(node.path.value === SPECIAL_DIRS.SEPARATOR
          ? []
          : [
              {
                action: "save as",
                label: localize("pathVisualAlwaysAsk", "Always ask where to save"),
                accessible: localize(
                  "pathVisualAlwaysAskAccessible",
                  `Always ask where to save ${rowName}`,
                  rowName,
                ),
                disabled: false,
                pressed: PathEditorHelpers.getDialog(node),
                run: () => {
                  const current = nodes[index];
                  if (!current) return;
                  nodes[index] = PathEditorHelpers.setDialog(
                    current,
                    !PathEditorHelpers.getDialog(current),
                  );
                },
              },
            ]),
        {
          action: "outdent",
          label: localize("pathVisualOutdent", "Outdent"),
          accessible: localize("pathVisualOutdentAccessible", `Outdent ${rowName}`, rowName),
          disabled: node.depth === 0,
          run: () => {
            updateNode(index, { depth: Math.max(0, node.depth - 1) });
          },
        },
        {
          action: "indent",
          label: localize("pathVisualIndent", "Indent"),
          accessible: localize("pathVisualIndentAccessible", `Indent ${rowName}`, rowName),
          disabled: previousNode === undefined || node.depth >= previousNode.depth + 1,
          run: () => {
            updateNode(index, { depth: node.depth + 1 });
          },
        },
        {
          action: "move up",
          label: localize("pathVisualMoveUp", "Move up"),
          accessible: localize("pathVisualMoveUpAccessible", `Move ${rowName} up`, rowName),
          disabled: index === 0,
          run: () => {
            nodes = reorderPathNode(nodes, index, index - 1);
          },
        },
        {
          action: "move down",
          label: localize("pathVisualMoveDown", "Move down"),
          accessible: localize("pathVisualMoveDownAccessible", `Move ${rowName} down`, rowName),
          disabled: index === nodes.length - 1,
          run: () => {
            nodes = reorderPathNode(nodes, index, index + 1);
          },
        },
        {
          action: "delete",
          label: localize("pathVisualDelete", "Delete"),
          accessible: localize("pathVisualDeleteAccessible", `Delete ${rowName}`, rowName),
          disabled: false,
          run: () => {
            deletedNodes = nodes.slice();
            nodes = deletePathNode(nodes, index);
            undo.hidden = false;
          },
          danger: true,
        },
      ];
    };

    const buildMoreMenu = (controls: RowControl[], rowName: string): HTMLDetailsElement => {
      const more = document.createElement("details");
      more.className = "path-editor-more details-popup";
      const moreTrigger = document.createElement("summary");
      moreTrigger.className =
        "visual-editor-control visual-editor-more-trigger path-editor-more-trigger";
      moreTrigger.textContent = "⋯";
      const moreLabel = localize(
        "pathVisualMoreActionsAccessible",
        `More actions for ${rowName}`,
        rowName,
      );
      moreTrigger.title = moreLabel;
      moreTrigger.setAttribute("aria-label", moreLabel);
      const moreMenu = document.createElement("div");
      moreMenu.className = "path-editor-action-menu menu-popover";
      controls.forEach((control) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "visual-editor-control path-editor-control";
        button.dataset.pathAction = control.action;
        button.title = control.label;
        button.setAttribute("aria-label", control.accessible);
        button.textContent = control.label;
        button.disabled = control.disabled;
        if (control.pressed !== undefined) {
          button.setAttribute("aria-pressed", String(control.pressed));
          button.classList.toggle("is-active", control.pressed);
        }
        button.classList.toggle("danger-button", control.danger === true);
        button.addEventListener("click", () => {
          control.run();
          commit();
          rebuild();
        });
        moreMenu.appendChild(button);
      });
      more.append(moreTrigger, moreMenu);
      return more;
    };

    const buildRow = (node: DirectoryLineNode, index: number, pass: RenderPass): HTMLElement => {
      const rowEl = document.createElement("div");
      rowEl.className = "visual-editor-row path-editor-row";
      rowEl.dataset.depth = String(node.depth);
      registerPathSourceElement(rowEl, index);
      rowEl.style.setProperty("--row-depth", String(node.depth));
      rowEl.classList.toggle("is-disabled", !PathEditorHelpers.getEnabled(node));
      rowEl.addEventListener("click", () => {
        selectPathSource(index, { document: textarea.ownerDocument });
        textarea.dispatchEvent(
          new CustomEvent("path-editor-row-selected", {
            bubbles: true,
            detail: { sourceIndex: index },
          }),
        );
      });

      const rowName = rowLabel(node, index);
      rowEl.append(buildIndent(node));
      rowEl.append(buildHandle(node, index, rowEl, rowName));
      rowEl.append(buildEnabledControl(node, index, rowName));
      wireRowDropTarget(rowEl, node, index, rowName);

      const actions = document.createElement("div");
      actions.className = "visual-editor-row-actions path-editor-actions";

      if (node.path.value === SPECIAL_DIRS.SEPARATOR) {
        const sep = document.createElement("span");
        sep.className = "path-editor-separator";
        sep.textContent = localize("o_bAddSeparator", "Separator");
        rowEl.append(sep);
      } else {
        rowEl.append(buildDirectoryInput(node, index));
        const { alias, aliasToggle } = buildAliasControls(node, index);
        rowEl.append(alias);
        actions.append(aliasToggle, buildAccessKeyControl(node, index, rowName, pass));
      }

      actions.append(buildMoreMenu(rowActionControls(node, index, rowName), rowName));
      rowEl.append(actions);
      return rowEl;
    };

    const renderEmptyState = (): void => {
      const empty = document.createElement("div");
      empty.className = "path-editor-empty";
      empty.textContent = localize(
        "pathVisualEmpty",
        "No custom folders. Save In will use only the browser Downloads folder.",
      );
      container.append(empty);
    };

    const render = () => {
      editorControlCleanups.forEach((cleanup) => cleanup());
      editorControlCleanups = [];
      container.replaceChildren();
      visualHelp.hidden = nodes.length < 2;

      if (nodes.length === 0) {
        renderEmptyState();
        textarea.dispatchEvent(new Event("visual-editor-rendered"));
        return;
      }

      const pass: RenderPass = {
        showNumberedItems:
          document.querySelector<HTMLInputElement>("#enableNumberedItems")?.checked === true,
        menuItems: new Map(
          buildTree(PathEditorHelpers.nodesToLines(nodes))
            .items.filter((item) => item.kind === "path")
            .map((item) => [item.sourceIndex, item]),
        ),
      };

      appendBoundaryDropZone(0);
      nodes.forEach((node, index) => {
        container.append(buildRow(node, index, pass));
        appendBoundaryDropZone(index + 1);
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
      const input = container
        .querySelectorAll<HTMLElement>(".path-editor-row")
        [nodes.length - 1]?.querySelector<HTMLInputElement>(".path-editor-dir");
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
    document.querySelector("#enableNumberedItems")?.addEventListener("change", rebuild);

    sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.GET_KEYWORDS })
      .then((response) => {
        if (!("variables" in response.body) || !Array.isArray(response.body.variables)) return;
        variables = sortVariables(
          response.body.variables.filter(
            (variable: unknown): variable is string => typeof variable === "string",
          ),
        );
        if (variables.length > 0) rebuild();
      })
      .catch(() => {});

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
  static getAccessKey = PathEditorHelpers.getAccessKey;
  static getDialog = PathEditorHelpers.getDialog;
  static getEnabled = PathEditorHelpers.getEnabled;
  static setAlias = PathEditorHelpers.setAlias;
  static setAccessKey = PathEditorHelpers.setAccessKey;
  static setDialog = PathEditorHelpers.setDialog;
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
