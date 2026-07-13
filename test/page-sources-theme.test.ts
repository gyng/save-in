import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("puts the Page Sources theme override in Advanced with all supported modes", () => {
  const document = new DOMParser().parseFromString(
    readFileSync(resolve("src/options/options.html"), "utf8"),
    "text/html",
  );
  const theme = document.querySelector<HTMLSelectElement>(
    "#section-more-options ~ label #sourcePanelTheme",
  );

  expect(theme).not.toBeNull();
  expect([...theme!.options].map(({ value }) => value)).toEqual(["system", "dark", "light"]);
  expect(theme!.closest("label")?.querySelector(".caption")?.textContent).toContain(
    "__MSG_o_lSourcePanelThemeHelp__",
  );
});
