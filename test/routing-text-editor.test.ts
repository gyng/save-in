// @vitest-environment jsdom

import { createSyntaxEditor } from "../src/options/syntax-editor.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

test("omits line-end diagnostic messages from the routing text editor", () => {
  document.body.innerHTML = [
    '<div id="directories"><textarea>broken</textarea></div>',
    '<div id="routing"><textarea>broken</textarea></div>',
  ].join("");
  const directories = document.querySelector<HTMLTextAreaElement>("#directories textarea")!;
  const routing = document.querySelector<HTMLTextAreaElement>("#routing textarea")!;

  createSyntaxEditor(directories, "directories");
  createSyntaxEditor(routing, "routing");

  expect(document.querySelector("#directories .syntax-editor-inline-diagnostics")).not.toBeNull();
  expect(document.querySelector("#routing .syntax-editor-inline-diagnostics")).toBeNull();
});
