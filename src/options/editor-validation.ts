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
