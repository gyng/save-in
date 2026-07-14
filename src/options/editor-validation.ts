export const EDITOR_VALIDATION_EVENT = "save-in:editor-validation";

export type EditorValidationFeedback = {
  readonly message: string;
  readonly error: string;
  readonly warning?: boolean;
  readonly sourceIndex?: number;
  readonly location?: {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
  };
};

export const dispatchEditorValidation = (
  target: HTMLTextAreaElement,
  errors: readonly EditorValidationFeedback[],
): void => {
  target.dispatchEvent(new CustomEvent(EDITOR_VALIDATION_EVENT, { detail: { errors } }));
};

export const validationFeedbackFromEvent = (event: Event): readonly EditorValidationFeedback[] => {
  if (!(event instanceof CustomEvent) || !Array.isArray(event.detail?.errors)) return [];
  return event.detail.errors.filter(
    (error: unknown): error is EditorValidationFeedback =>
      typeof error === "object" &&
      error !== null &&
      typeof Reflect.get(error, "message") === "string" &&
      typeof Reflect.get(error, "error") === "string",
  );
};

export const validationFeedbackLabel = (error: EditorValidationFeedback): string =>
  error.error ? `${error.message}: ${error.error}` : error.message;

export const clearValidationFields = (root: ParentNode): void => {
  root.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((field) => {
    field.removeAttribute("aria-invalid");
  });
  root.querySelectorAll<HTMLElement>("[data-validation-described-by]").forEach((field) => {
    const previous = field.dataset.validationDescribedBy;
    if (previous) field.setAttribute("aria-describedby", previous);
    else field.removeAttribute("aria-describedby");
    delete field.dataset.validationDescribedBy;
  });
};

export const markValidationField = (field: HTMLElement | null, summaryId: string): void => {
  if (!field) return;
  const previous = field.getAttribute("aria-describedby") || "";
  field.dataset.validationDescribedBy = previous;
  field.setAttribute("aria-invalid", "true");
  field.setAttribute(
    "aria-describedby",
    [...new Set([...previous.split(/\s+/).filter(Boolean), summaryId])].join(" "),
  );
};
