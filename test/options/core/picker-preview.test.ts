// @vitest-environment jsdom
import {
  renderPickerPreview,
  renderPickerPreviewLegend,
} from "../../../src/options/core/picker-preview.ts";
import { buildTree } from "../../../src/menus/menu-tree.ts";

const render = (
  paths: string[],
  numbered = true,
  lastUsed: { label: string; key: string } | null = null,
): HTMLElement => {
  const container = document.createElement("div");
  renderPickerPreview(container, buildTree(paths), { numbered, lastUsed });
  return container;
};
const rows = (container: HTMLElement) =>
  [...container.children].map((row) => ({
    kind: row.className,
    title: row.querySelector(".picker-demo-title")?.textContent,
    key: row.querySelector("kbd")?.textContent ?? null,
    depth: (row as HTMLElement).style.getPropertyValue("--picker-demo-depth"),
  }));

describe("folder picker preview", () => {
  test("draws the user's folders with submenus as headings and top-level keys", () => {
    expect(
      rows(render(["Inbox", "Images", ">Nature // (key: N)", "---", "Docs // (key: D)"])),
    ).toEqual([
      { kind: "picker-demo-option active", title: "Inbox", key: "1", depth: "0" },
      { kind: "picker-demo-heading", title: "Images", key: "2", depth: "0" },
      // A nested folder's key is live only after stepping into its submenu.
      { kind: "picker-demo-option", title: "Nature", key: null, depth: "1" },
      { kind: "picker-demo-option", title: "Docs", key: "d", depth: "0" },
    ]);
  });

  test("shows only explicit keys with numbering off, and highlights the first folder it can pick", () => {
    expect(rows(render(["Group", ">Child", "Plain", "Keyed // (key: K)"], false))).toEqual([
      { kind: "picker-demo-heading", title: "Group", key: null, depth: "0" },
      { kind: "picker-demo-option active", title: "Child", key: null, depth: "1" },
      { kind: "picker-demo-option", title: "Plain", key: null, depth: "0" },
      { kind: "picker-demo-option", title: "Keyed", key: "k", depth: "0" },
    ]);
  });

  test("lists Last used first, highlighted, with its key and a divider", () => {
    const container = render(["Inbox"], true, { label: "Last used", key: "E" });

    expect(rows(container)).toEqual([
      { kind: "picker-demo-option active", title: "Last used", key: "e", depth: "" },
      { kind: "picker-demo-separator", title: undefined, key: null, depth: "" },
      { kind: "picker-demo-option", title: "Inbox", key: "1", depth: "0" },
    ]);
    // A cleared Last used key shows no chip.
    expect(rows(render([], true, { label: "Last used", key: "" }))[0]?.key).toBeNull();
  });

  test("keeps the picture short and replaces what it drew before", () => {
    const container = render(Array.from({ length: 12 }, (_, index) => `Folder ${index + 1}`));
    expect(container.children).toHaveLength(7);

    renderPickerPreview(container, buildTree([]), { numbered: true, lastUsed: null });
    expect(container.children).toHaveLength(0);
  });

  test("draws the key legend once however often it is asked", () => {
    const legend = document.createElement("div");
    renderPickerPreviewLegend(legend);
    renderPickerPreviewLegend(legend);

    expect([...legend.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual([
      "↑",
      "↓",
      "↵",
      "esc",
    ]);
  });
});
