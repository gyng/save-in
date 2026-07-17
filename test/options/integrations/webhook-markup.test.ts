// @vitest-environment jsdom
import { parseOptionsDocument } from "../contracts/markup.fixture.ts";

test("keeps webhook consent, field controls, preview, and status connected", () => {
  const document = parseOptionsDocument();
  // One endpoint per line, so the field has to accept newlines at all.
  const endpoint = document.querySelector<HTMLTextAreaElement>("#webhookUrl");
  expect(endpoint?.type).toBe("textarea");
  expect(endpoint?.getAttribute("aria-describedby")).toContain("webhook-status");
  expect(document.querySelector("#webhookEnabled")?.hasAttribute("data-no-autosave")).toBe(true);
  expect(document.querySelector("#webhookEnabled")?.getAttribute("aria-describedby")).toContain(
    "webhookEnabledHelp",
  );
  expect(document.querySelector("#webhookIncludePageUrl")).not.toBeNull();
  expect(document.querySelector("#webhookIncludePageTitle")).not.toBeNull();
  expect(document.querySelector("#webhookIncludeSelectionText")).not.toBeNull();
  expect(document.querySelector("#webhook-payload-preview")).not.toBeNull();
  expect(document.querySelector("#webhook-status")?.getAttribute("role")).toBe("status");
  expect(document.querySelector("#webhook-state-badge")).not.toBeNull();
  expect(document.querySelector<HTMLAnchorElement>("#webhook-documentation")?.href).toBe(
    "https://github.com/gyng/save-in/wiki/Webhooks",
  );
});
