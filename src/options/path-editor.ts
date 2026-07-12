import { webExtensionApi } from "../platform/web-extension-api.ts";

// Directory-list editing helpers for the options page:
// - an insert menu ("+ Add") for the paths textarea: variables (with their
//   current values from the last download), separators, submenu lines
// - a visual editor (its own tab) with one row per line: indent/outdent,
//   reorder, alias editing, add/delete
// The paths textarea stays the single source of truth: every edit
// serializes back to it and fires the normal input/autosave pipeline.

import { SPECIAL_DIRS } from "../shared/constants.ts";

type PathRow = { depth: number; body: string; comment: string };
type EditorOwner = { rebuildVisual?: () => void };
type InsertEntry = {
  variable: string;
  value: string;
  button: HTMLButtonElement;
  valueEl: HTMLElement;
};
type MessageResponse = {
  body?: {
    variables?: string[];
    interpolatedVariables?: Record<string, string>;
  };
};

const PathEditorHelpers = {
  // "  >>i/cats // cute (alias: Cats)" -> { depth: 2, body: "i/cats",
  // comment: "cute (alias: Cats)" }. Round-trips through serializeLine
  // with whitespace normalized.
  parseLine: (line: string): PathRow => {
    const commentIdx = line.indexOf("//");
    const rawBody = commentIdx === -1 ? line : line.slice(0, commentIdx);
    const comment = commentIdx === -1 ? "" : line.slice(commentIdx + 2).trim();
    const depthMatch = rawBody.trim().match(/^(>*)\s*(.*)$/);
    return {
      depth: depthMatch?.[1].length ?? 0,
      body: depthMatch?.[2].trim() ?? "",
      comment,
    };
  },

  serializeLine: (row: PathRow): string =>
    `${">".repeat(row.depth)}${row.body}${row.comment ? ` // ${row.comment}` : ""}`,

  linesToRows: (text: string): PathRow[] =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(PathEditorHelpers.parseLine),

  rowsToLines: (rows: PathRow[]): string[] => rows.map(PathEditorHelpers.serializeLine),

  getAlias: (comment: string): string => {
    const match = (comment || "").match(/\(alias:\s*([^)]*)\)/);
    return match ? match[1].trim() : "";
  },

  // Replaces (or appends/removes) the (alias: …) meta while leaving the
  // rest of the comment untouched
  setAlias: (comment: string, alias: string): string => {
    const cleaned = (comment || "").replace(/\s*\(alias:\s*[^)]*\)/, "").trim();
    if (!alias) {
      return cleaned;
    }
    return cleaned ? `${cleaned} (alias: ${alias})` : `(alias: ${alias})`;
  },

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

  // An insertion menu for an editor: line-insert buttons (data-insert-line)
  // and a filterable variable list. The menu targets the textarea named
  // by its data-insert-target; children are found by class so the same
  // markup shape works for the paths and rules editors.
  setupInsertMenu: (menuSelector: string): void => {
    const menu = document.querySelector<HTMLDetailsElement>(menuSelector);
    if (!menu) {
      return;
    }
    const target = menu.dataset.insertTarget;
    const textarea = target ? document.querySelector<HTMLTextAreaElement>(`#${target}`) : null;
    const variablesContainer = menu.querySelector<HTMLElement>(".insert-menu-variables");
    const filter = menu.querySelector<HTMLInputElement>(".insert-menu-filter");
    if (!textarea) {
      return;
    }

    const closeMenu = () => {
      menu.open = false;
    };

    menu.querySelectorAll<HTMLElement>("[data-insert-line]").forEach((button) => {
      button.addEventListener("click", () => {
        PathEditorHelpers.insertLine(textarea, button.dataset.insertLine ?? "");
        closeMenu();
      });
    });

    if (!variablesContainer) return;

    const entries: InsertEntry[] = [];

    // Interpolated values come from the last download and change with
    // every save, so they are re-fetched each time the menu opens
    const refreshValues = () => {
      webExtensionApi.runtime
        .sendMessage({ type: "CHECK_ROUTES" })
        .then((res: MessageResponse) => {
          const values = (res && res.body && res.body.interpolatedVariables) || {};
          entries.forEach((entry) => {
            entry.value = values[entry.variable] || "";
            entry.valueEl.textContent = entry.value;
            // Long values ellipsize; the tooltip carries the full value
            entry.button.title = entry.value;
          });
        })
        .catch(() => {});
    };

    const applyFilter = () => {
      const query = filter ? filter.value.trim().toLowerCase() : "";
      entries.forEach((entry) => {
        const match =
          !query || entry.variable.includes(query) || entry.value.toLowerCase().includes(query);
        entry.button.style.display = match ? "" : "none";
      });
    };

    webExtensionApi.runtime
      .sendMessage({ type: "GET_KEYWORDS" })
      .then((res: MessageResponse) => {
        const variables = (res && res.body && res.body.variables) || [];
        variables.forEach((variable: string) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "insert-menu-variable";

          const name = document.createElement("code");
          name.textContent = variable;
          button.appendChild(name);

          const valueEl = document.createElement("span");
          valueEl.className = "caption insert-menu-value";
          button.appendChild(valueEl);

          button.addEventListener("click", () => {
            PathEditorHelpers.insertAtCursor(textarea, variable);
            closeMenu();
          });
          variablesContainer.appendChild(button);
          entries.push({ variable, value: "", button, valueEl });
        });
        refreshValues();
      })
      .catch(() => {});

    if (filter) {
      filter.addEventListener("input", applyFilter);
      filter.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          // Typeahead: Enter inserts the first visible match
          e.preventDefault();
          const first = entries.find((entry) => entry.button.style.display !== "none");
          if (first) {
            first.button.click();
          }
        } else if (e.key === "Escape") {
          closeMenu();
        }
      });
    }

    menu.addEventListener("toggle", () => {
      if (menu.open) {
        refreshValues();
        if (filter) {
          filter.value = "";
          applyFilter();
          filter.focus();
        }
      }
    });

    // A native <details> only toggles from its summary, so an open menu stays
    // open when you click elsewhere. Close it on any click outside the menu
    // (the summary click that opens it is inside the menu, so it survives).
    document.addEventListener("click", (e) => {
      if (menu.open && e.target instanceof Node && !menu.contains(e.target)) {
        closeMenu();
      }
    });
  },

  // Text/Visual sub-tabs inside the Downloads Menu tab: both edit the same
  // list; text is the default and stays the source of truth
  setupModeToggle: (owner: EditorOwner): void => {
    const textButton = document.querySelector<HTMLElement>("#paths-mode-text");
    const visualButton = document.querySelector<HTMLElement>("#paths-mode-visual");
    const textElements = [
      document.querySelector("#paths-text-help"),
      document.querySelector("#paths-text-actions"),
      document.querySelector("#paths"),
      document.querySelector(".paths-editor .manual-save-help") ??
        document.querySelector(".manual-save-help"),
    ] as (HTMLElement | null)[];
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
    let visual = false;
    try {
      visual = localStorage.getItem("saveInPathsEditorMode") === "visual";
    } catch {}
    select(visual);
  },

  setupVisualEditor: (owner: EditorOwner): void => {
    const textarea = document.querySelector<HTMLTextAreaElement>("#paths");
    const container = document.querySelector<HTMLElement>("#path-editor-rows");
    if (!textarea || !container) {
      return;
    }

    let rows: PathRow[] = [];
    // Index being dragged via a row handle; null when no drag is active
    let dragFrom: number | null = null;
    let dropAfter = true;
    let dropInside = false;
    let committing = false;
    let deletedRows: PathRow[] | null = null;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "path-editor-undo";
    undo.textContent = "Undo delete";
    undo.hidden = true;
    container.after(undo);
    const visualHelp = document.createElement("div");
    visualHelp.className = "caption path-editor-help";
    [
      ["Changes in this editor are saved when you select Apply.", "manual-save-help"],
      [
        "Drag by the dotted handle. Drop above or below a row to place it at the same level, or onto the row to nest it inside.",
        "",
      ],
    ].forEach(([copy, className]) => {
      const line = document.createElement("p");
      line.textContent = copy;
      line.className = className;
      visualHelp.append(line);
    });
    (document.querySelector(".path-editor-toolbar") ?? container).after(visualHelp);

    // Serialize rows back to the textarea (the source of truth) and let
    // the normal pipeline (autosave, previews) react
    const commit = () => {
      textarea.value = PathEditorHelpers.rowsToLines(rows).join("\n");
      committing = true;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
      committing = false;
    };

    const render = () => {
      container.textContent = "";

      rows.forEach((row, index) => {
        const rowEl = document.createElement("div");
        rowEl.className = "path-editor-row";
        rowEl.dataset.depth = String(row.depth);
        rowEl.style.setProperty("--row-depth", String(row.depth));

        const indentEl = document.createElement("span");
        indentEl.className = "path-editor-indent";
        indentEl.style.width = `${row.depth * 20}px`;
        indentEl.setAttribute("aria-hidden", "true");
        rowEl.appendChild(indentEl);

        // Drag to reorder: only the handle starts a drag (a draggable row
        // would fight text selection in the inputs); any row is a target
        const rowName = PathEditorHelpers.getAlias(row.comment) || row.body || `row ${index + 1}`;
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "path-editor-handle";
        handle.textContent = "⠿";
        handle.title = "Drag vertically to reorder; drag right or left to change nesting";
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
            if (event.key === "ArrowLeft") row.depth = Math.max(0, row.depth - 1);
            else if (index > 0) row.depth = Math.min(row.depth + 1, rows[index - 1]!.depth + 1);
            commit();
            rebuild();
            container.querySelectorAll<HTMLElement>(".path-editor-handle")[index]?.focus();
            return;
          }
          const destination = event.key === "ArrowUp" ? index - 1 : index + 1;
          if (destination < 0 || destination >= rows.length) return;
          event.preventDefault();
          const [moved] = rows.splice(index, 1);
          if (moved) rows.splice(destination, 0, moved);
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
              row.body !== SPECIAL_DIRS.SEPARATOR &&
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
          const target = rows[index];
          const [moved] = rows.splice(dragFrom, 1);
          const adjustedTarget = dragFrom < index ? index - 1 : index;
          const targetIndex = target ? rows.indexOf(target) : -1;
          const destination = dropInside ? targetIndex + 1 : adjustedTarget + (dropAfter ? 1 : 0);
          if (moved) {
            rows.splice(destination, 0, moved);
            moved.depth = dropInside ? (target?.depth ?? 0) + 1 : (target?.depth ?? 0);
          }
          dragFrom = null;
          dropInside = false;
          commit();
          rebuild();
        });

        const actions = document.createElement("div");
        actions.className = "path-editor-actions";

        if (row.body === SPECIAL_DIRS.SEPARATOR) {
          const sep = document.createElement("span");
          sep.className = "path-editor-separator";
          sep.textContent = "separator";
          rowEl.appendChild(sep);
        } else {
          const dir = document.createElement("input");
          dir.type = "text";
          dir.className = "path-editor-dir";
          dir.value = row.body;
          dir.placeholder = "directory/:variables:";
          dir.spellcheck = false;
          dir.setAttribute("aria-label", `Directory ${index + 1}`);
          dir.addEventListener("input", () => {
            row.body = dir.value;
            commit();
          });
          rowEl.appendChild(dir);

          const alias = document.createElement("input");
          alias.type = "text";
          alias.className = "path-editor-alias";
          alias.value = PathEditorHelpers.getAlias(row.comment);
          alias.placeholder = "alias";
          const aliasOpen = Boolean(alias.value);
          alias.classList.toggle("is-open", aliasOpen);
          alias.tabIndex = aliasOpen ? 0 : -1;
          alias.setAttribute("aria-hidden", String(!aliasOpen));
          alias.setAttribute("aria-label", `Display name for directory ${index + 1}`);
          alias.addEventListener("input", () => {
            row.comment = PathEditorHelpers.setAlias(row.comment, alias.value);
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
              row.depth = Math.max(0, row.depth - 1);
            },
          ],
          [
            "▶",
            "indent",
            () => {
              if (index > 0 && row.depth < rows[index - 1]!.depth + 1) row.depth += 1;
            },
          ],
          [
            "▲",
            "move up",
            () => {
              if (index > 0) {
                const moved = rows.splice(index, 1)[0];
                if (moved) rows.splice(index - 1, 0, moved);
              }
            },
          ],
          [
            "▼",
            "move down",
            () => {
              if (index < rows.length - 1) {
                const moved = rows.splice(index, 1)[0];
                if (moved) rows.splice(index + 1, 0, moved);
              }
            },
          ],
          [
            "✕",
            "delete",
            () => {
              deletedRows = rows.map((candidate) => ({ ...candidate }));
              const deletedDepth = row.depth;
              rows.splice(index, 1);
              for (
                let child = index;
                child < rows.length && rows[child]!.depth > deletedDepth;
                child++
              ) {
                rows[child]!.depth -= 1;
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
          if (title === "outdent") button.disabled = row.depth === 0;
          if (title === "indent")
            button.disabled = index === 0 || row.depth >= rows[index - 1]!.depth + 1;
          if (title === "move up") button.disabled = index === 0;
          if (title === "move down") button.disabled = index === rows.length - 1;
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
    };

    const rebuild = () => {
      rows = PathEditorHelpers.linesToRows(textarea.value);
      render();
    };
    // The mode toggle forces a rebuild when switching into visual mode
    owner.rebuildVisual = rebuild;

    undo.addEventListener("click", () => {
      if (!deletedRows) return;
      rows = deletedRows;
      deletedRows = null;
      undo.hidden = true;
      commit();
      rebuild();
    });

    document.querySelector("#path-editor-add-dir")?.addEventListener("click", () => {
      rows.push({ depth: 0, body: "new-folder", comment: "" });
      commit();
      rebuild();
      const input = container.lastElementChild?.querySelector<HTMLInputElement>(".path-editor-dir");
      input?.focus();
      input?.select();
    });
    document.querySelector("#path-editor-add-sep")?.addEventListener("click", () => {
      rows.push({ depth: 0, body: SPECIAL_DIRS.SEPARATOR, comment: "" });
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
  static linesToRows = PathEditorHelpers.linesToRows;
  static rowsToLines = PathEditorHelpers.rowsToLines;
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

document.addEventListener("DOMContentLoaded", () => {
  const editor = new PathEditor();
  editor.setupInsertMenu("#rules-clause-menu");
  editor.setupVisualEditor();
  editor.setupModeToggle();
});
