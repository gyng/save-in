import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyUiTheme, setupUiThemeControl } from "../src/options/theme.ts";

test("puts the shared theme override in Advanced Appearance", () => {
  const document = new DOMParser().parseFromString(
    readFileSync(resolve("src/options/options.html"), "utf8"),
    "text/html",
  );
  const theme = document.querySelector<HTMLSelectElement>("#section-more-options ~ label #uiTheme");

  expect(theme).not.toBeNull();
  expect([...theme!.options].map(({ value }) => value)).toEqual(["system", "dark", "light"]);
  expect(theme!.closest("label")?.previousElementSibling?.textContent).toContain(
    "__MSG_o_sAppearance__",
  );
  expect(theme!.closest("label")?.querySelector(".caption")?.textContent).toContain(
    "__MSG_o_lUiThemeHelp__",
  );
});

test("applies valid options-page themes and safely defaults malformed values", () => {
  const root = document.createElement("html");

  expect(applyUiTheme("dark", root)).toBe("dark");
  expect(root.dataset.theme).toBe("dark");
  expect(applyUiTheme("light", root)).toBe("light");
  expect(root.dataset.theme).toBe("light");
  expect(applyUiTheme("system", root)).toBe("system");
  expect(root.dataset.theme).toBe("system");
  expect(applyUiTheme("auto", root)).toBe("system");
  expect(root.dataset.theme).toBe("system");
});

test("updates the options page immediately when the theme control changes", () => {
  const root = document.createElement("html");
  const select = document.createElement("select");
  select.append(new Option("System", "system"), new Option("Dark", "dark"));
  const remove = setupUiThemeControl(select, root);

  select.value = "dark";
  select.dispatchEvent(new Event("change"));
  expect(root.dataset.theme).toBe("dark");

  remove();
  select.value = "system";
  select.dispatchEvent(new Event("change"));
  expect(root.dataset.theme).toBe("dark");
});

test("supports forced dark and system-driven dark options palettes", () => {
  const stylesheet = readFileSync(resolve("src/options/style.css"), "utf8");

  expect(stylesheet).toContain(':root[data-theme="dark"]');
  expect(stylesheet).toContain(':root:not([data-theme="light"]):not([data-theme="dark"])');
  expect(stylesheet).toContain("color-scheme: dark");
});
