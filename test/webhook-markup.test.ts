// @vitest-environment jsdom
import { parseOptionsDocument } from "./options-markup-helpers.ts";

test("keeps webhook consent, field controls, preview, and status connected", () => {
  const document = parseOptionsDocument();
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl");
  expect(endpoint?.type).toBe("url");
  expect(endpoint?.getAttribute("aria-describedby")).toContain("webhook-status");
  expect(document.querySelector("#webhookEnabled")?.hasAttribute("data-no-autosave")).toBe(true);
  expect(document.querySelector("#webhookIncludePageUrl")).not.toBeNull();
  expect(document.querySelector("#webhookIncludePageTitle")).not.toBeNull();
  expect(document.querySelector("#webhookIncludeSelectionText")).not.toBeNull();
  expect(document.querySelector("#webhook-payload-preview")).not.toBeNull();
  expect(document.querySelector("#webhook-status")?.getAttribute("role")).toBe("status");
  expect(document.querySelector<HTMLAnchorElement>("#webhook-documentation")?.href).toBe(
    "https://github.com/gyng/save-in/wiki/Webhooks",
  );
});
