export type HistoryFeedbackOptions = {
  message?: string;
  error?: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

export const renderHistoryFeedback = (
  container: HTMLElement | null,
  { message = "", error = false, actionLabel, onAction }: HistoryFeedbackOptions = {},
) => {
  if (!container) return;
  container.replaceChildren();
  container.hidden = !message;
  container.classList.toggle("history-feedback-error", error);
  container.setAttribute("role", error ? "alert" : "status");
  if (!message) return;
  container.append(message);
  if (actionLabel && onAction) {
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = actionLabel;
    action.addEventListener("click", onAction);
    container.append(" ", action);
  }
};
