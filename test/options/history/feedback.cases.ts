// Cases imported by panel.test.ts to share one jsdom environment.
import { renderHistoryFeedback } from "../../../src/options/history/history-feedback.ts";

test("renders an actionable error and clears it accessibly", () => {
  document.body.innerHTML = '<div id="feedback" aria-live="polite"></div>';
  const container = document.querySelector<HTMLElement>("#feedback")!;
  const retry = vi.fn();
  renderHistoryFeedback(container, {
    message: "Could not load history.",
    error: true,
    actionLabel: "Retry",
    onAction: retry,
  });
  expect(container.hidden).toBe(false);
  expect(container.getAttribute("role")).toBe("alert");
  container.querySelector("button")!.click();
  expect(retry).toHaveBeenCalledOnce();

  renderHistoryFeedback(container);
  expect(container.hidden).toBe(true);
  expect(container.textContent).toBe("");
  expect(container.getAttribute("role")).toBe("status");
});

test("does nothing when the feedback container is absent", () => {
  expect(() => renderHistoryFeedback(null, { message: "Ignored" })).not.toThrow();
});
