import { webExtensionApi } from "../platform/web-extension-api.ts";
import { PathEditor } from "./path-editor.ts";

const stringRecord = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};

export const renderVariablesPreview = async () => {
  const panels = document.querySelectorAll<HTMLElement>(".variables-preview");
  if (panels.length === 0) return;

  try {
    const [keywords, routes] = await Promise.all([
      webExtensionApi.runtime.sendMessage({ type: "GET_KEYWORDS" }),
      webExtensionApi.runtime.sendMessage({ type: "CHECK_ROUTES" }).catch(() => null),
    ]);
    const variables: string[] = Array.isArray(keywords?.body?.variables)
      ? keywords.body.variables.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];
    const values = stringRecord(routes?.body?.interpolatedVariables);

    panels.forEach((panel) => {
      const container = panel.querySelector(".variables-preview-list");
      if (!container) return;
      container.textContent = "";

      const target = panel.dataset.insertTarget
        ? document.querySelector<HTMLTextAreaElement>(`#${panel.dataset.insertTarget}`)
        : null;
      const table = document.createElement("table");
      table.className = "variables-preview-table";

      variables.forEach((variable) => {
        const row = document.createElement("tr");
        row.className = "variables-preview-row";
        const nameCell = document.createElement("td");
        const name = document.createElement("code");
        name.textContent = variable;
        if (target) {
          row.classList.add("insertable");
          const insert = document.createElement("button");
          insert.type = "button";
          insert.className = "variables-preview-insert";
          insert.setAttribute("aria-label", `Insert ${variable}`);
          insert.title = `Insert ${variable}`;
          insert.addEventListener("click", () => PathEditor.insertAtCursor(target, variable));
          insert.appendChild(name);
          nameCell.appendChild(insert);
        } else {
          nameCell.appendChild(name);
        }
        row.appendChild(nameCell);
        const valueCell = document.createElement("td");
        valueCell.className = "variables-preview-value";
        valueCell.textContent = values[variable] || "";
        valueCell.title = values[variable] || "";
        row.appendChild(valueCell);
        table.appendChild(row);
      });
      container.appendChild(table);
    });
  } catch {
    // The background may be restarting; the next download refreshes the panel.
  }
};

export const setupVariablesPreview = () => {
  void renderVariablesPreview();
};
