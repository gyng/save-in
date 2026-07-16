// @vitest-environment jsdom

import { referenceDescription } from "../../../src/options/core/reference-descriptions.ts";

describe("reference descriptions", () => {
  test("skips incomplete rows and normalizes matching descriptions", () => {
    document.body.innerHTML = `
      <section id="options-reference-variables"><table><tbody>
        <tr></tr>
        <tr><td><code>:date:</code></td><td>  Current\n date  </td></tr>
      </tbody></table></section>`;

    expect(referenceDescription("variables", " :DATE: ")).toBe("Current date");
  });

  test("contains code nodes without text and falls back for an unknown clause", () => {
    document.body.innerHTML = `
      <section id="options-reference-clauses"><table><tbody>
        <tr><td><code></code></td><td>Unavailable</td></tr>
      </tbody></table></section>`;
    const code = document.querySelector("code")!;
    Object.defineProperty(code, "textContent", { configurable: true, get: () => null });

    expect(referenceDescription("clauses", "custom:")).toBe(
      "Translated<referenceRuntimeRuleMatcher>",
    );
  });
});
