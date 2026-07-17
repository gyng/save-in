// Cases imported by shell.test.ts to share one jsdom environment.
import { applyUiTheme, setupUiThemeControl } from "../../../src/options/core/theme.ts";

test("applies valid options-page themes and safely defaults malformed values", () => {
  const root = document.createElement("html");

  expect(applyUiTheme("dark", root)).toBe("dark");
  expect(root.dataset.theme).toBe("dark");
  expect(applyUiTheme("light", root)).toBe("light");
  expect(root.dataset.theme).toBe("light");
  expect(applyUiTheme("system", root)).toBe("system");
  expect(root.dataset.theme).toBe("system");
  expect(applyUiTheme("solarized-dark", root)).toBe("solarized-dark");
  expect(root.dataset.theme).toBe("solarized-dark");
  expect(applyUiTheme("forest", root)).toBe("pastel-pink");
  expect(root.dataset.theme).toBe("pastel-pink");
  expect(applyUiTheme("auto", root)).toBe("system");
  expect(root.dataset.theme).toBe("system");
});

test("updates the options page immediately when the theme control changes", () => {
  const root = document.createElement("html");
  const valueInput = document.createElement("input");
  valueInput.type = "hidden";
  valueInput.value = "system";
  const picker = document.createElement("fieldset");
  picker.innerHTML = `
    <label><input type="radio" name="theme" value="system">System</label>
    <label><input type="radio" name="theme" value="dark">Dark</label>
  `;
  document.body.append(valueInput, picker);
  const system = picker.querySelector<HTMLInputElement>('input[value="system"]')!;
  const dark = picker.querySelector<HTMLInputElement>('input[value="dark"]')!;
  const changes = vi.fn();
  valueInput.addEventListener("change", changes);
  const remove = setupUiThemeControl(valueInput, picker, root);

  expect(system.checked).toBe(true);
  dark.click();
  expect(root.dataset.theme).toBe("dark");
  expect(valueInput.value).toBe("dark");
  expect(changes).toHaveBeenCalledOnce();

  picker.dispatchEvent(new Event("change"));
  expect(valueInput.value).toBe("dark");

  valueInput.value = "system";
  document.dispatchEvent(new Event("options-restored"));
  expect(system.checked).toBe(true);
  expect(root.dataset.theme).toBe("system");

  remove();
  dark.click();
  expect(root.dataset.theme).toBe("system");

  valueInput.remove();
  picker.remove();
});
