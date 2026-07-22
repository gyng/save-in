// The routing/validation preview panel: live VALIDATE error channels for the
// paths/filenamePatterns editors, plus the CHECK_ROUTES-driven "last
// download" summary (routing result, capture groups, interpolated
// variables). Both come from the same round trip in updateErrors, so they
// stay in one module instead of being force-split.
import { getMessage } from "../../platform/localization.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { isStringKeyedRecord } from "../../shared/message-protocol.ts";
import { addClickToCopy } from "../ui/click-to-copy.ts";
import { createLatestOnly } from "../ui/latest-only.ts";
import { getPathSourceRange } from "../path-editor/path-editor-model.ts";
import { setSyntaxEditorDiagnostics } from "../syntax-editor/syntax-editor.ts";
import {
  directoryValidationLocation,
  validationErrorsToDiagnostics,
} from "../syntax-editor/syntax-editor-model.ts";
import { dispatchEditorValidation } from "../syntax-editor/editor-validation.ts";
import { cssSelectorErrors } from "./css-selector-validation.ts";

// Shared with menu-preview.ts's paths-textarea debounce (both editors debounce
// their live preview/validation by the same amount).
export const MENU_PREVIEW_DEBOUNCE_MS = 250;

export type ValidationError = {
  message: string;
  error: string;
  warning?: boolean;
  sourceRange?: { start: number; end: number };
  location?: {
    start: number;
    end: number;
    line: number;
    column: number;
  };
};
type IndexedValidationError = ValidationError & { sourceIndex: number };

const isValidationError = (value: unknown): value is ValidationError =>
  isStringKeyedRecord(value) &&
  typeof value.message === "string" &&
  typeof value.error === "string" &&
  (typeof value.warning === "undefined" || typeof value.warning === "boolean") &&
  (typeof value.sourceRange === "undefined" ||
    (isStringKeyedRecord(value.sourceRange) &&
      typeof value.sourceRange.start === "number" &&
      typeof value.sourceRange.end === "number")) &&
  (typeof value.location === "undefined" ||
    (isStringKeyedRecord(value.location) &&
      typeof value.location.start === "number" &&
      typeof value.location.end === "number" &&
      typeof value.location.line === "number" &&
      typeof value.location.column === "number"));

const isIndexedValidationError = (value: unknown): value is IndexedValidationError =>
  isStringKeyedRecord(value) &&
  typeof value.sourceIndex === "number" &&
  Number.isInteger(value.sourceIndex) &&
  value.sourceIndex >= 0 &&
  isValidationError(value);

export type ManualEditorStateLike = {
  setValidity: (id: string, valid: boolean) => void;
  setValidationPending: (id: string) => void;
  setValidationUnavailable: (id: string) => void;
};

// Latest interpolated variables from the most recent CHECK_ROUTES; read by
// the once-bound #see-variables-btn handler.
let latestInterpolatedVariables: Record<string, string> | null = null;

const replaceVariablesTableRows = (
  tableBody: HTMLElement,
  variables: Record<string, string>,
): void => {
  tableBody.innerHTML = "";
  Object.keys(variables).forEach((key) => {
    const val = variables[key];

    const variableRow = document.createElement("tr");

    const nameEl = document.createElement("td");
    nameEl.textContent = key;
    nameEl.classList.add("click-to-copy");
    nameEl.classList.add("code");
    addClickToCopy(nameEl);

    const interpolatedEl = document.createElement("td");
    interpolatedEl.classList.add("last-download-value");
    interpolatedEl.textContent = val ?? "";

    variableRow.appendChild(nameEl);
    variableRow.appendChild(interpolatedEl);
    tableBody.appendChild(variableRow);
  });
};

export const errorChannel = (panel: Element, name: string): Element => {
  let channel = panel.querySelector(`[data-error-channel="${name}"]`);
  if (!channel) {
    channel = document.createElement("div");
    channel.setAttribute("data-error-channel", name);
    panel.appendChild(channel);
  }
  return channel;
};

export const updateErrorSummary = (panel: Element): void => {
  panel.setAttribute(
    "aria-label",
    panel.textContent?.trim() || getMessage("o_lNoValidationErrors") || "No validation errors",
  );
};

// Reveal + select the offending text in its editor. Best-effort: the error
// string is usually the offending line/clause, so we find and select it.
export const jumpToError = (
  textareaId: string,
  needle: string,
  sourceIndex?: number,
  location?: ValidationError["location"],
): void => {
  // Paths in Visual mode: jump to the matching visual row instead of switching
  // back to the textarea. Match the row whose directory field is contained in
  // the (raw) line; fall back to Text mode if nothing matches (e.g. a line the
  // visual editor couldn't represent).
  if (textareaId === "#paths" && needle) {
    const visual = document.querySelector("#paths-visual");
    if (visual instanceof HTMLElement && !visual.hidden) {
      const rows = [...document.querySelectorAll("#path-editor-rows .path-editor-row")];
      const target =
        sourceIndex === undefined
          ? rows.find((r) => {
              const dir = r.querySelector(".path-editor-dir");
              return (
                dir instanceof HTMLInputElement &&
                dir.value.trim() &&
                needle.includes(dir.value.trim())
              );
            })
          : rows[sourceIndex];
      if (target) {
        target.scrollIntoView({ block: "center" });
        const dir = target.querySelector(".path-editor-dir");
        if (dir instanceof HTMLInputElement) {
          dir.focus();
          dir.select();
        }
        target.classList.add("path-editor-row-flash");
        window.setTimeout(() => target.classList.remove("path-editor-row-flash"), 1200);
        return;
      }
      const textBtn = document.querySelector("#paths-mode-text");
      if (textBtn instanceof HTMLElement) {
        textBtn.click();
      }
    }
  }

  const ta = document.querySelector(textareaId);
  if (!(ta instanceof HTMLTextAreaElement)) {
    return;
  }
  ta.scrollIntoView({ block: "center" });
  ta.focus();
  const sourceRange =
    textareaId === "#paths" && sourceIndex !== undefined
      ? getPathSourceRange(ta.value, sourceIndex)
      : null;
  const idx = location?.start ?? sourceRange?.start ?? (needle ? ta.value.indexOf(needle) : -1);
  if (idx >= 0) {
    ta.setSelectionRange(idx, location?.end ?? sourceRange?.end ?? idx + needle.length);
    // Nudge the caret into view (setSelectionRange alone may not scroll)
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const line = ta.value.slice(0, idx).split("\n").length - 1;
    ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 2);
  }
};

const renderErrorRow = (err: ValidationError, textareaId: string): HTMLElement => {
  const r = document.createElement("div");
  r.className = "error-row";
  r.setAttribute("role", "button");
  r.setAttribute("tabindex", "0");
  r.title = getMessage("validationJumpToIssue") || "Jump to this issue";

  const sourceIndex =
    "sourceIndex" in err && typeof err.sourceIndex === "number" ? err.sourceIndex : undefined;
  const textarea = document.querySelector(textareaId);
  const location =
    err.location ??
    (textarea instanceof HTMLTextAreaElement && sourceIndex !== undefined
      ? (directoryValidationLocation(textarea.value, sourceIndex, err.sourceRange) ?? undefined)
      : undefined);

  if (location) {
    const locationBadge = document.createElement("span");
    locationBadge.className = "error-location";
    locationBadge.textContent = `L${location.line}:${location.column + 1}`;
    r.appendChild(locationBadge);
  }

  const message = document.createElement("span");
  message.className = "error-message";
  message.textContent = err.message;
  r.appendChild(message);

  if (err.error) {
    const error = document.createElement("span");
    error.className = "error-error";
    error.textContent = err.error;
    r.appendChild(error);
  }

  const jump = () => jumpToError(textareaId, err.error, sourceIndex, location);
  r.addEventListener("click", jump);
  r.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      jump();
    }
  });

  return r;
};

export const showManualSaveError = (id: string, error: unknown): void => {
  const panel = document.querySelector(`#error-${id}`);
  if (!panel) return;
  const channel = errorChannel(panel, "persistence");
  channel.innerHTML = "";
  channel.appendChild(
    renderErrorRow(
      {
        message: getMessage("o_lSaveFailed") || "Could not save changes",
        error: String(error),
        warning: false,
      },
      `#${id}`,
    ),
  );
  updateErrorSummary(panel);
};

const renderVariablesTable = (): void => {
  if (!latestInterpolatedVariables) {
    return;
  }
  const tableBody = document.querySelector<HTMLElement>("#variables-body");
  if (!tableBody) {
    return;
  }
  tableBody.hidden = !tableBody.hidden;
  if (!tableBody.hidden) replaceVariablesTableRows(tableBody, latestInterpolatedVariables);
};

export const setupSeeVariablesButton = (): void => {
  document.querySelector("#see-variables-btn")?.addEventListener("click", renderVariablesTable);
};

export const createRoutingPreviewPanel = (manualEditorState: ManualEditorStateLike) => {
  // Validate the (possibly unsaved) editor contents live and render both
  // error panels — VALIDATE dry-runs both grammars, so the panels track the
  // menu preview (which also validates live) instead of the last-saved state.
  const validationRequests = createLatestOnly(
    (request: { body: { paths: string; filenamePatterns: string }; initiator?: string }) =>
      sendInternalMessage(webExtensionApi.runtime, {
        type: MESSAGE_TYPES.VALIDATE,
        body: request.body,
      }),
    (res: unknown) => {
      const body = isStringKeyedRecord(res) && isStringKeyedRecord(res.body) ? res.body : {};
      const pathErrors = Array.isArray(body.pathErrors)
        ? body.pathErrors.filter(isIndexedValidationError)
        : [];
      const backgroundRuleErrors = Array.isArray(body.ruleErrors)
        ? body.ruleErrors.filter(isValidationError)
        : [];
      const pathsTextarea = document.querySelector("#paths");
      const rulesTextarea = document.querySelector("#filenamePatterns");
      const localCssErrors =
        rulesTextarea instanceof HTMLTextAreaElement ? cssSelectorErrors(rulesTextarea.value) : [];
      const ruleErrors = [
        ...backgroundRuleErrors,
        ...localCssErrors.filter(
          (local) =>
            !backgroundRuleErrors.some(
              (remote) =>
                remote.error === local.error &&
                remote.location?.start === local.location?.start &&
                remote.location?.end === local.location?.end,
            ),
        ),
      ];
      const pathsErrors = document.querySelector("#error-paths");
      const rulesErrors = document.querySelector("#error-filenamePatterns");
      const updatePanel = (panel: Element, errors: ValidationError[], textareaId: string) => {
        const channel = errorChannel(panel, "validation");
        const signature = JSON.stringify(errors);
        if (channel.getAttribute("data-validation-signature") === signature) return;
        channel.setAttribute("data-validation-signature", signature);
        channel.innerHTML = "";
        errors.forEach((error) => channel.appendChild(renderErrorRow(error, textareaId)));
        updateErrorSummary(panel);
      };
      if (pathsErrors) {
        errorChannel(pathsErrors, "validation-service").innerHTML = "";
        updatePanel(pathsErrors, pathErrors, "#paths");
        updateErrorSummary(pathsErrors);
        manualEditorState.setValidity("paths", !pathErrors.some((err) => !err.warning));
        if (pathsTextarea instanceof HTMLTextAreaElement) {
          dispatchEditorValidation(pathsTextarea, pathErrors);
          setSyntaxEditorDiagnostics(
            pathsTextarea,
            validationErrorsToDiagnostics("directories", pathsTextarea.value, pathErrors),
          );
        }
      }
      if (rulesErrors) {
        errorChannel(rulesErrors, "validation-service").innerHTML = "";
        updatePanel(rulesErrors, ruleErrors, "#filenamePatterns");
        updateErrorSummary(rulesErrors);
        manualEditorState.setValidity("filenamePatterns", !ruleErrors.some((err) => !err.warning));
        if (rulesTextarea instanceof HTMLTextAreaElement) {
          dispatchEditorValidation(rulesTextarea, ruleErrors);
          setSyntaxEditorDiagnostics(
            rulesTextarea,
            validationErrorsToDiagnostics("routing", rulesTextarea.value, ruleErrors),
          );
        }
      }
    },
    (_error, request) => {
      (request.initiator ? [request.initiator] : ["paths", "filenamePatterns"]).forEach((id) => {
        manualEditorState.setValidationUnavailable(id);
        const textarea = document.querySelector(`#${id}`);
        if (textarea instanceof HTMLTextAreaElement) dispatchEditorValidation(textarea, []);
        const panel = document.querySelector(`#error-${id}`);
        if (!panel) return;
        const channel = errorChannel(panel, "validation-service");
        channel.innerHTML = "";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = getMessage("o_bRetryValidation") || "Retry validation";
        retry.addEventListener("click", () => {
          manualEditorState.setValidationPending(id);
          renderValidationErrors(id);
        });
        channel.append(
          getMessage("o_lValidationUnavailable") || "Validation is temporarily unavailable. ",
          retry,
        );
        updateErrorSummary(panel);
      });
    },
  );

  const renderValidationErrors = (initiator?: string): void => {
    const pathsTa = document.querySelector("#paths");
    const rulesTa = document.querySelector("#filenamePatterns");
    const pathsErrors = document.querySelector("#error-paths");
    const rulesErrors = document.querySelector("#error-filenamePatterns");
    if (!pathsErrors && !rulesErrors) {
      return;
    }

    void validationRequests
      .run({
        ...(initiator === undefined ? {} : { initiator }),
        body: {
          paths: pathsTa instanceof HTMLTextAreaElement ? pathsTa.value : "",
          filenamePatterns: rulesTa instanceof HTMLTextAreaElement ? rulesTa.value : "",
        },
      })
      .catch(() => {}); // background not awake yet; the next edit retries
  };

  const previewRequests = createLatestOnly(
    () => sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.CHECK_ROUTES }),
    (response) => {
      if (!("routeInfo" in response.body)) {
        throw new Error("Invalid routing preview response");
      }
      const lastDlMatch = document.querySelector("#last-dl-match");
      const lastDlCapture = document.querySelector("#last-dl-capture");
      const { body } = response;
      // Last download
      const lastDownloadUrl = body.lastDownload?.info.url;
      const hasLastDownload = typeof lastDownloadUrl === "string" && lastDownloadUrl.length > 0;
      const lastDlUrl = document.querySelector("#last-dl-url");
      if (lastDlUrl) {
        if (hasLastDownload) {
          lastDlUrl.textContent = lastDownloadUrl;
          lastDlUrl.classList.remove("is-empty");
        } else {
          lastDlUrl.textContent = getMessage("o_lRoutingLastDownloadEmpty") || "none yet";
          lastDlUrl.classList.add("is-empty");
        }
      }

      const rulesAppliedRow = document.querySelector<HTMLElement>("#rules-applied-row");
      if (rulesAppliedRow) rulesAppliedRow.hidden = !hasLastDownload;

      // Routing result
      if (lastDlMatch) {
        lastDlMatch.textContent =
          body.routeInfo.outcome === "exclude"
            ? getMessage("o_lRoutingExcluded") || "Excluded by routing rule"
            : getMessage("o_lRoutingNoMatches") || "No matches";
      }
      if (lastDlMatch && body.routeInfo.path) {
        lastDlMatch.textContent = body.routeInfo.path;
      }

      // Variables
      const variablesTableRow = document.querySelector<HTMLElement>("#variables-table-row");
      if (variablesTableRow) variablesTableRow.hidden = !hasLastDownload;
      // The #see-variables-btn click handler is bound once via
      // setupSeeVariablesButton; updateErrors only refreshes the data it
      // reads. Binding here would leak a listener on every autosave and
      // make the toggle unpredictable.
      latestInterpolatedVariables = body.interpolatedVariables;
      const variablesBody = document.querySelector<HTMLElement>("#variables-body");
      if (variablesBody) {
        if (!hasLastDownload || !latestInterpolatedVariables) {
          variablesBody.hidden = true;
          variablesBody.innerHTML = "";
        } else if (!variablesBody.hidden) {
          replaceVariablesTableRows(variablesBody, latestInterpolatedVariables);
        }
      }

      // Capture groups
      const captures = body.routeInfo.captures;
      const hasCaptureMatches = Array.isArray(captures);

      const captureGroupRows = document.querySelector<HTMLElement>("#capture-group-rows");
      if (captureGroupRows) captureGroupRows.hidden = !hasCaptureMatches;

      if (hasCaptureMatches && lastDlCapture) {
        lastDlCapture.textContent = "";

        // Skip first match as it's just the entire input
        captures
          .slice(1)
          .map((capture, i) => {
            const div = document.createElement("div");
            div.className = "match-row";

            const code = document.createElement("code");
            code.innerText = `:$${i + 1}:`;
            code.classList.add("click-to-copy");
            addClickToCopy(code);
            div.appendChild(code);

            const value = document.createElement("div");
            value.className = "match-row-result";
            value.textContent = capture ?? "";
            div.appendChild(value);

            return div;
          })
          .forEach((rowDiv: HTMLElement) => lastDlCapture.appendChild(rowDiv));
      }
    },
  );

  const updateErrors = (): void => {
    // Errors are validated live (VALIDATE); CHECK_ROUTES fills the routing /
    // last-download / variables panes below.
    renderValidationErrors();
    void previewRequests.run();
  };

  // The rules editor has no menu preview, but its error panel should still
  // update live as you type — same as the paths editor's own live-validation
  // wiring in menu-preview.ts.
  const setupRulesValidationWiring = (): void => {
    const rulesTa = document.querySelector("#filenamePatterns");
    if (!rulesTa) {
      return;
    }
    let timer: number | null = null;
    rulesTa.addEventListener("input", () => {
      manualEditorState.setValidationPending("filenamePatterns");
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        renderValidationErrors("filenamePatterns");
      }, MENU_PREVIEW_DEBOUNCE_MS);
    });
  };

  return { updateErrors, renderValidationErrors, setupRulesValidationWiring };
};
