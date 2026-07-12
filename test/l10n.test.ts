import { hardenLinks, localizeString, localizeDocument } from "../src/options/l10n.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("l10n", () => {
  beforeEach(() => {
    (global.chrome as any).i18n = {
      getMessage: vi.fn((key: string) => ({ greeting: "Hello", name: "save-in" })[key] || ""),
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("replaces placeholders in strings", () => {
    expect(localizeString("__MSG_greeting__, __MSG_name__!")).toBe("Hello, save-in!");
  });

  test("keeps unknown placeholders verbatim", () => {
    expect(localizeString("__MSG_missing__")).toBe("__MSG_missing__");
  });

  test("localizes document text nodes and attributes", () => {
    document.body.innerHTML =
      '<p id="t">__MSG_greeting__</p><input id="i" placeholder="__MSG_name__"><span id="plain">untouched</span>';

    localizeDocument();

    expect(document.getElementById("t")?.textContent).toBe("Hello");
    expect(document.getElementById("i")?.getAttribute("placeholder")).toBe("save-in");
    expect(document.getElementById("plain")?.textContent).toBe("untouched");
  });

  test("opens external links separately without exposing the options window", () => {
    document.body.innerHTML = `
      <a id="external" class="external" href="https://example.com">external</a>
      <a id="blank" href="help.html" target="_blank">help</a>
      <a id="same" href="help.html">same</a>`;

    hardenLinks();

    const external = document.getElementById("external") as HTMLAnchorElement;
    const blank = document.getElementById("blank") as HTMLAnchorElement;
    expect(external.target).toBe("_blank");
    expect(external.relList.contains("noreferrer")).toBe(true);
    expect(blank.relList.contains("noreferrer")).toBe(true);
    expect((document.getElementById("same") as HTMLAnchorElement).target).toBe("");
  });
});

test("English options headings use sentence case", () => {
  const messages = JSON.parse(readFileSync(resolve("_locales/en/messages.json"), "utf8"));
  expect(
    [
      "o_sDownloads",
      "o_sRenameAndRouteDownloads",
      "o_sSaveAsShortcuts",
      "o_sKeyboardShortcuts",
      "o_sContextMenu",
      "o_sClickToSave",
      "o_sVisualEditor",
    ].map((key) => messages[key].message),
  ).toEqual([
    "Downloads menu",
    "Rename and route downloads",
    "Shortcut files",
    "Click-to-save",
    "Context menu access keys",
    "Click-to-save gesture",
    "Visual editor",
  ]);
});
