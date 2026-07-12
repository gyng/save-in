import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("options behavior information architecture", () => {
  test("groups controls by user task without changing their identities", () => {
    const document = new DOMParser().parseFromString(
      readFileSync(resolve("src/options/options.html"), "utf8"),
      "text/html",
    );
    const groups = [...document.querySelectorAll<HTMLElement>("[data-behavior-group]")];

    expect(groups.map((group) => group.dataset.behaviorGroup)).toEqual([
      "context-menu",
      "save-dialog",
      "existing-files",
    ]);
    expect(
      groups.map((group) =>
        [
          ...group.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[id], select[id]"),
        ].map((control) => control.id),
      ),
    ).toEqual([
      [
        "enableLastLocation",
        "links",
        "preferLinks",
        "preferLinksFilterEnabled",
        "selection",
        "page",
        "tabEnabled",
        "closeTabOnSave",
      ],
      ["prompt", "promptIfNoExtension", "promptOnShift", "promptOnFailure"],
      ["conflictAction"],
    ]);
  });
});
