// Directory-list editing helpers for the options page:
// - an insert menu ("+ Add") for the paths textarea: variables (with their
//   current values from the last download), separators, submenu lines
// - a visual editor (its own tab) with one row per line: indent/outdent,
//   reorder, alias/access-key editing, add/delete
// The paths textarea stays the single source of truth: every edit
// serializes back to it and fires the normal input/autosave pipeline.

import { MESSAGE_TYPES, SPECIAL_DIRS } from "../shared/constants.ts";
import { getMessage } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { buildTree } from "../menus/menu-tree.ts";
import { resolveMenuAccessKey } from "../menus/access-key.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";
import { attachAutocomplete } from "./autocomplete.ts";
import { setupPathInsertMenu } from "./path-editor-insert-menu.ts";
import { completeDirectorySyntax } from "./syntax-editor-model.ts";
import { bindTabInteractions, syncTabSelection } from "./tab-controls.ts";
import { registerPathSourceElement, selectPathSource } from "./path-source-selection.ts";
import { sortVariables } from "./vocabulary-groups.ts";
import {
  deletePathNode,
  dropPathNode,
  getPathAccessKey,
  getPathAlias,
  getPathEnabled,
  parseDirectoryLine,
  pathLinesToNodes,
  pathNodesToLines,
  serializeDirectoryLine,
  reorderPathNode,
  setPathAccessKey,
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
type TextField = HTMLInputElement | HTMLTextAreaElement;

const localize = (
  key: string,
  fallback: string,
  substitutions?: string | number | Array<string | number>,
): string => getMessage(key, substitutions) || fallback;

const PathEditorHelpers = {
  parseLine: parseDirectoryLine,
  serializeLine: serializeDirectoryLine,
  linesToNodes: pathLinesToNodes,
  nodesToLines: pathNodesToLines,
  getAlias: getPathAlias,
  getAccessKey: getPathAccessKey,
  getEnabled: getPathEnabled,
  setAlias: setPathAlias,
  setAccessKey: setPathAccessKey,
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

    const render = () => {
      editorControlCleanups.forEach((cleanup) => cleanup());
      editorControlCleanups = [];
      container.replaceChildren();
      visualHelp.hidden = nodes.length < 2;

      if (nodes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "path-editor-empty";
        empty.textContent = localize(
          "pathVisualEmpty",
          "No custom folders. Save In will use only the browser Downloads folder.",
        );
        container.append(empty);
        textarea.dispatchEvent(new Event("visual-editor-rendered"));
        return;
      }

      const showNumberedItems =
        document.querySelector<HTMLInputElement>("#enableNumberedItems")?.checked === true;
      const menuItemsBySourceIndex = new Map(
        buildTree(PathEditorHelpers.nodesToLines(nodes))
          .items.filter((item) => item.kind === "path")
          .map((item) => [item.sourceIndex, item]),
      );

      const clearDropAppearance = (): void => {
        container
          .querySelectorAll(".path-editor-row.drag-inside")
          .forEach((row) => row.classList.remove("drag-inside"));
        container
          .querySelectorAll(".path-editor-drop-zone.is-active")
          .forEach((zone) => zone.classList.remove("is-active"));
        container.querySelectorAll(".path-editor-drop-indicator").forEach((el) => el.remove());
      };

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

      appendBoundaryDropZone(0);

      nodes.forEach((node, index) => {
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

        const indentEl = document.createElement("span");
        indentEl.className = "path-editor-indent";
        indentEl.style.width = `${node.depth * 20}px`;
        indentEl.setAttribute("aria-hidden", "true");
        rowEl.appendChild(indentEl);

        // Drag to reorder: only the handle starts a drag (a draggable row
        // would fight text selection in the inputs); any row is a target
        const rowName =
          PathEditorHelpers.getAlias(node) ||
          node.path.value ||
          localize("pathVisualDirectoryAccessible", `Folder ${index + 1}`, index + 1);
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
        rowEl.append(enabledControl);

        rowEl.addEventListener("dragover", (e) => {
          if (dragFrom === null || dragFrom === index || node.path.value === SPECIAL_DIRS.SEPARATOR)
            return;
          e.preventDefault();
          if (rowEl.classList.contains("drag-inside")) return;
          clearDropAppearance();
          rowEl.classList.add("drag-inside");
          const indicator = document.createElement("span");
          indicator.className = "path-editor-drop-indicator";
          indicator.textContent = localize(
            "pathVisualNestUnder",
            `Nest under “${rowName}”`,
            rowName,
          );
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
          if (
            dragFrom === null ||
            dragFrom === index ||
            node.path.value === SPECIAL_DIRS.SEPARATOR
          ) {
            return;
          }
          nodes = dropPathNode(nodes, dragFrom, index, "inside");
          dragFrom = null;
          container.classList.remove("is-dragging");
          commit();
          rebuild();
        });

        const actions = document.createElement("div");
        actions.className = "visual-editor-row-actions path-editor-actions";

        if (node.path.value === SPECIAL_DIRS.SEPARATOR) {
          const sep = document.createElement("span");
          sep.className = "path-editor-separator";
          sep.textContent = localize("o_bAddSeparator", "Separator");
          rowEl.appendChild(sep);
        } else {
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
          rowEl.appendChild(dir);

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
            localize(
              "pathVisualAliasAccessible",
              `Display name for folder ${index + 1}`,
              index + 1,
            ),
          );
          alias.addEventListener("input", () => {
            const current = nodes[index];
            if (!current) return;
            aliasToggle.classList.toggle("has-value", Boolean(alias.value));
            nodes[index] = PathEditorHelpers.setAlias(current, alias.value);
            commit();
          });
          const aliasToggle = document.createElement("button");
          aliasToggle.type = "button";
          aliasToggle.className = "path-editor-alias-toggle";
          aliasToggle.classList.toggle("has-value", Boolean(alias.value));
          aliasToggle.textContent = localize("pathVisualAlias", "Alias");
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

          const accessKeyLabel = getMessage("html_key") || "Key";
          const accessKeyAssignment =
            getMessage("html_assignAnAccessKey") || "Assign an access key";
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
          const menuItem = menuItemsBySourceIndex.get(index);
          accessKey.placeholder =
            showNumberedItems && menuItem && menuItem.accessKeyOverride !== ""
              ? (resolveMenuAccessKey(menuItem.number) ?? "")
              : "";
          accessKey.maxLength = 1;
          accessKey.spellcheck = false;
          accessKey.setAttribute(
            "aria-label",
            localize(
              "pathVisualAccessKeyAccessible",
              `${accessKeyAssignment}: ${rowName}`,
              rowName,
            ),
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
          rowEl.append(alias);
          actions.append(aliasToggle, accessKeyControl);
        }

        const controls: Array<{
          action: string;
          label: string;
          accessible: string;
          disabled: boolean;
          run: () => void;
          danger?: boolean;
        }> = [
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
            disabled:
              nodes[index - 1] === undefined || node.depth >= (nodes[index - 1]?.depth ?? 0) + 1,
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

        const more = document.createElement("details");
        more.className = "path-editor-more details-popup";
        const moreTrigger = document.createElement("summary");
        moreTrigger.className = "visual-editor-control path-editor-more-trigger";
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
          button.classList.toggle("danger-button", control.danger === true);
          button.addEventListener("click", () => {
            control.run();
            commit();
            rebuild();
          });
          moreMenu.appendChild(button);
        });
        more.append(moreTrigger, moreMenu);
        actions.append(more);

        rowEl.append(actions);

        container.appendChild(rowEl);
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
  static getEnabled = PathEditorHelpers.getEnabled;
  static setAlias = PathEditorHelpers.setAlias;
  static setAccessKey = PathEditorHelpers.setAccessKey;
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
