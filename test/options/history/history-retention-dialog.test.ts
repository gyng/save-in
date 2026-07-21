// @vitest-environment jsdom
import { getMessage } from "../../../src/platform/localization.ts";
import { setHistoryLocalizer } from "../../../src/options/history/history-messages.ts";
import { showHistoryRetentionDialog } from "../../../src/options/history/history-retention-dialog.ts";

beforeEach(() => {
  document.body.innerHTML = '<input id="historyRetentionLimit">';
  setHistoryLocalizer((key) => `Translated<${key}>`);
});

afterEach(() => {
  setHistoryLocalizer(getMessage);
});

test("confirms lowering the History limit and restores focus", async () => {
  const opener = document.querySelector<HTMLInputElement>("#historyRetentionLimit")!;
  opener.focus();

  const pending = showHistoryRetentionDialog();
  const dialog = document.querySelector<HTMLDialogElement>(".history-retention-dialog")!;
  expect(dialog.getAttribute("aria-describedby")).toBe("history-retention-dialog-description");
  expect(dialog.textContent).toContain("Translated<historyRetentionConfirmDescription>");
  dialog.querySelectorAll<HTMLButtonElement>("button")[1]!.click();

  await expect(pending).resolves.toBe(true);
  expect(document.activeElement).toBe(opener);
});

test("keeps the current limit when the dialog is canceled", async () => {
  const pending = showHistoryRetentionDialog();
  const dialog = document.querySelector<HTMLDialogElement>(".history-retention-dialog")!;

  dialog.dispatchEvent(new Event("cancel", { cancelable: true }));

  await expect(pending).resolves.toBe(false);
  expect(dialog.isConnected).toBe(false);
});
