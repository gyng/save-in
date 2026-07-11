import { webExtensionApi } from "../web-extension-api.ts";

// Directory-list editing helpers for the options page:
// - an insert menu ("+ Add") for the paths textarea: variables (with their
//   current values from the last download), separators, submenu lines
// - a visual editor (its own tab) with one row per line: indent/outdent,
//   reorder, alias editing, add/delete
// The paths textarea stays the single source of truth: every edit
// serializes back to it and fires the normal input/autosave pipeline.

import { SPECIAL_DIRS } from "../constants.ts";

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

  // A "+ Add" menu for an editor: line-insert buttons (data-insert-line)
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
    if (!textarea || !variablesContainer) {
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
      document.querySelector("#error-paths"),
    ] as (HTMLElement | null)[];
    const visualContainer = document.querySelector<HTMLElement>("#paths-visual");
    if (!textButton || !visualButton || !visualContainer || textElements.some((el) => !el)) {
      return;
    }
    const visibleTextElements = textElements as HTMLElement[];

    const select = (visual: boolean): void => {
      textButton.classList.toggle("active", !visual);
      visualButton.classList.toggle("active", visual);
      visibleTextElements.forEach((el) => {
        el.hidden = visual;
      });
      visualContainer.hidden = !visual;
      if (visual && typeof owner.rebuildVisual === "function") {
        owner.rebuildVisual();
      }
    };

    textButton.addEventListener("click", () => select(false));
    visualButton.addEventListener("click", () => select(true));
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

    // Serialize rows back to the textarea (the source of truth) and let
    // the normal pipeline (autosave, previews) react
    const commit = () => {
      textarea.value = PathEditorHelpers.rowsToLines(rows).join("\n");
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    };

    const render = () => {
      container.textContent = "";

      rows.forEach((row, index) => {
        const rowEl = document.createElement("div");
        rowEl.className = "path-editor-row";

        // Drag to reorder: only the handle starts a drag (a draggable row
        // would fight text selection in the inputs); any row is a target
        const handle = document.createElement("span");
        handle.className = "path-editor-handle";
        handle.textContent = "⠿";
        handle.title = "drag to reorder";
        handle.draggable = true;
        handle.addEventListener("dragstart", (e) => {
          dragFrom = index;
          rowEl.classList.add("dragging");
          if (e.dataTransfer) {
            // Firefox requires data for a drag to start
            e.dataTransfer.setData("text/plain", String(index));
            e.dataTransfer.effectAllowed = "move";
          }
        });
        handle.addEventListener("dragend", () => {
          dragFrom = null;
          rowEl.classList.remove("dragging");
        });
        rowEl.appendChild(handle);

        rowEl.addEventListener("dragover", (e) => {
          if (dragFrom !== null) {
            e.preventDefault();
            rowEl.classList.add("drag-over");
          }
        });
        rowEl.addEventListener("dragleave", () => {
          rowEl.classList.remove("drag-over");
        });
        rowEl.addEventListener("drop", (e) => {
          e.preventDefault();
          rowEl.classList.remove("drag-over");
          if (dragFrom === null || dragFrom === index) {
            return;
          }
          const [moved] = rows.splice(dragFrom, 1);
          if (moved) rows.splice(index, 0, moved);
          dragFrom = null;
          commit();
          rebuild();
        });

        const indentEl = document.createElement("span");
        indentEl.className = "path-editor-indent";
        indentEl.style.width = `${row.depth * 20}px`;
        rowEl.appendChild(indentEl);

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
          dir.addEventListener("change", () => {
            row.body = dir.value.trim();
            commit();
          });
          rowEl.appendChild(dir);

          const alias = document.createElement("input");
          alias.type = "text";
          alias.className = "path-editor-alias";
          alias.value = PathEditorHelpers.getAlias(row.comment);
          alias.placeholder = "alias";
          alias.addEventListener("change", () => {
            row.comment = PathEditorHelpers.setAlias(row.comment, alias.value.trim());
            commit();
          });
          rowEl.appendChild(alias);
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
              row.depth += 1;
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
              rows.splice(index, 1);
            },
          ],
        ];

        controls.forEach(([glyph, title, action]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "path-editor-control";
          button.title = title;
          button.textContent = glyph;
          button.addEventListener("click", () => {
            action();
            commit();
            rebuild();
          });
          rowEl.appendChild(button);
        });

        container.appendChild(rowEl);
      });
    };

    const rebuild = () => {
      rows = PathEditorHelpers.linesToRows(textarea.value);
      render();
    };
    // The mode toggle forces a rebuild when switching into visual mode
    owner.rebuildVisual = rebuild;

    document.querySelector("#path-editor-add-dir")?.addEventListener("click", () => {
      rows.push({ depth: 0, body: "new-folder", comment: "" });
      commit();
      rebuild();
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
  editor.setupInsertMenu("#paths-insert-menu");
  editor.setupInsertMenu("#rules-insert-menu");
  editor.setupVisualEditor();
  editor.setupModeToggle();
});
