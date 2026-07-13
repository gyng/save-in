import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8");

test("the routing last-download panel fills its editor column", () => {
  const css = read("src/options/style.css");

  expect(css).toMatch(/\.last-download-row \{[^}]*width: 100%;[^}]*max-width: none;/s);
  expect(css).toMatch(
    /\.last-download-row \.last-download-info,[^}]*\.last-download-table \{[^}]*width: 100%;/s,
  );
  expect(css).toMatch(/\.last-download-url,\s*\.last-download-value \{[^}]*text-align: left;/s);
});

test("the empty last-download status uses normal text typography", () => {
  expect(read("src/options/style.css")).toMatch(
    /\.last-download-url\.is-empty \{[^}]*font-family: inherit;/s,
  );
  expect(read("src/options/options.ts")).toContain(
    'document.querySelector("#last-dl-url")?.classList.add("is-empty")',
  );
  expect(read("src/options/options.ts")).toContain('lastDlUrl.classList.remove("is-empty")');
});
