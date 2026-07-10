// Directory-list editing helpers for the options page:
// - an insert menu ("+ Add") for the paths textarea: variables (with their
//   current values from the last download), separators, submenu lines
// - a visual editor (its own tab) with one row per line: indent/outdent,
//   reorder, alias editing, add/delete
// The paths textarea stays the single source of truth: every edit
// serializes back to it and fires the normal input/autosave pipeline.

const PathEditor = {
  // "  >>i/cats // cute (alias: Cats)" -> { depth: 2, body: "i/cats",
  // comment: "cute (alias: Cats)" }. Round-trips through serializeLine
  // with whitespace normalized.
  parseLine: (line) => {
    const commentIdx = line.indexOf("//");
    const rawBody = commentIdx === -1 ? line : line.slice(0, commentIdx);
    const comment = commentIdx === -1 ? "" : line.slice(commentIdx + 2).trim();
    const depthMatch = rawBody.trim().match(/^(>*)\s*(.*)$/);
    return {
      depth: depthMatch[1].length,
      body: depthMatch[2].trim(),
      comment,
    };
  },

  serializeLine: (row) =>
    `${">".repeat(row.depth)}${row.body}${row.comment ? ` // ${row.comment}` : ""}`,

  linesToRows: (text) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map(PathEditor.parseLine),

  rowsToLines: (rows) => rows.map(PathEditor.serializeLine),

  getAlias: (comment) => {
    const match = (comment || "").match(/\(alias:\s*([^)]*)\)/);
    return match ? match[1].trim() : "";
  },

  // Replaces (or appends/removes) the (alias: …) meta while leaving the
  // rest of the comment untouched
  setAlias: (comment, alias) => {
    const cleaned = (comment || "").replace(/\s*\(alias:\s*[^)]*\)/, "").trim();
    if (!alias) {
      return cleaned;
    }
    return cleaned ? `${cleaned} (alias: ${alias})` : `(alias: ${alias})`;
  },

  insertAtCursor: (textarea, text) => {
    const start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
    const end = textarea.selectionEnd != null ? textarea.selectionEnd : start;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    const pos = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
  },

  // Inserts a whole line after the line the cursor is on
  insertLine: (textarea, line) => {
    const start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
    let lineEnd = textarea.value.indexOf("\n", start);
    if (lineEnd === -1) {
      lineEnd = textarea.value.length;
    }
    const before = textarea.value.slice(0, lineEnd);
    const after = textarea.value.slice(lineEnd);
    const glue = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    textarea.value = `${before}${glue}${line}${after}`;
    const pos = before.length + glue.length + line.length;
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
  },

  setupInsertMenu: () => {
    /** @type {HTMLTextAreaElement} */
    const textarea = document.querySelector("#paths");
    /** @type {HTMLDetailsElement} */
    const menu = document.querySelector("#paths-insert-menu");
    const variablesContainer = document.querySelector("#paths-insert-variables");
    if (!textarea || !menu || !variablesContainer) {
      return;
    }

    const closeMenu = () => {
      menu.open = false;
    };

    menu.querySelectorAll("[data-insert-line]").forEach((/** @type {HTMLElement} */ button) => {
      button.addEventListener("click", () => {
        PathEditor.insertLine(textarea, button.dataset.insertLine);
        closeMenu();
      });
    });

    // Variables from the background Router; current values (from the last
    // download) arrive with CHECK_ROUTES when available
    Promise.all([
      browser.runtime.sendMessage({ type: "GET_KEYWORDS" }),
      browser.runtime.sendMessage({ type: "CHECK_ROUTES" }).catch(() => null),
    ])
      .then(([keywords, routes]) => {
        const variables = (keywords && keywords.body && keywords.body.variables) || [];
        const values = (routes && routes.body && routes.body.interpolatedVariables) || {};

        variables.forEach((variable) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "insert-menu-variable";

          const name = document.createElement("code");
          name.textContent = variable;
          button.appendChild(name);

          if (values[variable]) {
            const value = document.createElement("span");
            value.className = "caption";
            value.textContent = ` ${values[variable]}`;
            button.appendChild(value);
          }

          button.addEventListener("click", () => {
            PathEditor.insertAtCursor(textarea, variable);
            closeMenu();
          });
          variablesContainer.appendChild(button);
        });
      })
      .catch(() => {});
  },

  setupVisualEditor: () => {
    /** @type {HTMLTextAreaElement} */
    const textarea = document.querySelector("#paths");
    const container = document.querySelector("#path-editor-rows");
    const previewContainer = document.querySelector("#menu-preview-tree-visual");
    if (!textarea || !container) {
      return;
    }

    let rows = [];

    const refreshPreview = () => {
      if (!previewContainer || typeof renderMenuPreview !== "function") {
        return;
      }
      browser.runtime
        .sendMessage({ type: "PREVIEW_MENUS", body: { paths: textarea.value } })
        .then((response) => {
          if (response && response.body) {
            renderMenuPreview(previewContainer, response.body);
          }
        })
        .catch(() => {});
    };

    // Serialize rows back to the textarea (the source of truth) and let
    // the normal pipeline (autosave, previews) react
    const commit = () => {
      textarea.value = PathEditor.rowsToLines(rows).join("\n");
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    };

    const render = () => {
      container.textContent = "";

      rows.forEach((row, index) => {
        const rowEl = document.createElement("div");
        rowEl.className = "path-editor-row";

        const indentEl = document.createElement("span");
        indentEl.className = "path-editor-indent";
        indentEl.style.width = `${row.depth * 20}px`;
        rowEl.appendChild(indentEl);

        if (row.body === SPECIAL_DIRS.SEPARATOR) {
          const sep = document.createElement("span");
          sep.className = "path-editor-separator";
          sep.textContent = "— separator —";
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
          alias.value = PathEditor.getAlias(row.comment);
          alias.placeholder = "alias";
          alias.addEventListener("change", () => {
            row.comment = PathEditor.setAlias(row.comment, alias.value.trim());
            commit();
          });
          rowEl.appendChild(alias);
        }

        /** @type {[string, string, () => void][]} */
        const controls = [
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
                rows.splice(index - 1, 0, rows.splice(index, 1)[0]);
              }
            },
          ],
          [
            "▼",
            "move down",
            () => {
              if (index < rows.length - 1) {
                rows.splice(index + 1, 0, rows.splice(index, 1)[0]);
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
      rows = PathEditor.linesToRows(textarea.value);
      render();
      refreshPreview();
    };

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
    let rebuildTimer = null;
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

document.addEventListener("DOMContentLoaded", () => {
  PathEditor.setupInsertMenu();
  PathEditor.setupVisualEditor();
});

// Export for testing
if (typeof module !== "undefined") {
  module.exports = PathEditor;
}
