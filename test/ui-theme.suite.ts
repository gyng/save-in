// Options UI micro-suite; its aggregator supplies the jsdom environment.
import { applyUiTheme, setupUiThemeControl } from "../src/options/theme.ts";

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
