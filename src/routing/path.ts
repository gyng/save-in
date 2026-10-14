import {
  SPECIAL_DIRS,
  FORBIDDEN_FILENAME_CHARS,
  PATH_SEGMENT_TYPES,
  UNSAFE_INVISIBLE_FILENAME_CHARS,
} from "../shared/constants.ts";
import { options } from "../config/options-data.ts";
import { routingPorts } from "./ports.ts";
import { EXTENSION_REGEX } from "./filename.ts";
import { findUnknownPathVariables } from "./path-variables.ts";

const specialDirVariables = Object.values(SPECIAL_DIRS);
const specialDirRegexp = new RegExp(`(${specialDirVariables.join("|")})`);
const utf8Encoder = new TextEncoder();

export type PathSegmentType =
  | (typeof PATH_SEGMENT_TYPES)[keyof typeof PATH_SEGMENT_TYPES]
  | undefined;

export type PathSegment = {
  type: PathSegmentType;
  val: string;
  toString(): string;
};

type SplitPathInput = {
  split(separator: RegExp): string | string[];
};

export type PathInput = string | SplitPathInput | null | undefined;
export type PathValidation = {
  valid: boolean;
  message?: string;
  error?: string;
  sourceRange?: { start: number; end: number };
};
export type FilenameDiagnostics = {
  utf8Bytes: number;
  limitBytes: number;
  exceedsLimit: boolean;
};
export type PathFinalizeOptions = {
  finalComponentIsFilename?: boolean;
  // rename: edits the final filename component after expansion but before
  // sanitization and truncation, so the hook runs on the raw component value.
  transformFinalComponent?: (value: string) => string;
};

// These regexes are exported because they define the platform-neutral path
// policy; callers should normally use the sanitizing functions below.
const SPECIAL_CHARACTERS_REGEX = new RegExp(FORBIDDEN_FILENAME_CHARS.source, "g");
const INVISIBLE_CHARACTERS_REGEX = new RegExp(
  UNSAFE_INVISIBLE_FILENAME_CHARS.source,
  `${UNSAFE_INVISIBLE_FILENAME_CHARS.flags}g`,
);
const BAD_LEADING_CHARACTERS = /^[./\\]/g;
// Browsers strip whitespace from the edges of a path component, so a component
// left edged with it is silently altered or dropped instead of being saved
// where the rule says (#53). `\s` matters more than the ASCII space here: the
// report was about U+00A0, which no filesystem rule forbids and which nothing
// else in this file removes. JS `\s` omits U+0085, which is Unicode White_Space
// and so is trimmed (and refused at an edge) by Chrome just like the others.
const LEADING_WHITESPACE_REGEX = /^[\s\u0085]+/;
const TRAILING_DOTS_AND_SPACES_REGEX = /[.\s\u0085]+$/;
// CLOCK$ and the two shell files are not reserved by every filesystem, but
// Chrome's downloads API refuses them as "Invalid filename" on every OS.
export const RESERVED_DEVICE_NAME_REGEX = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CLOCK\$)$/i;
const RESERVED_SHELL_FILE_REGEX = /^(desktop\.ini|thumbs\.db)$/i;
// Chrome also refuses, on every OS, a component whose final extension Windows
// shells interpret: .lnk runs code, .local redirects DLL loading, and a {CLSID}
// extension disguises the file type. The dot becomes "_" rather than gaining a
// suffix: a same-length edit cannot be undone by a later byte-limit
// truncation, and the original extension stays readable.
const SHELL_INTEGRATED_EXTENSION_REGEX = /\.(lnk|local|\{[^.]*\})$/i;
const DELETE_AND_C1_CONTROLS_REGEX = /[\x7f-\x9f]/g;
const SEPARATOR_REGEX_INCLUSIVE = /([/\\])/g;
// A destination ending in a separator names a folder and keeps the download's
// own name. It must accept every separator the line above splits on, or the
// router reads a folder the parser normalized as a filename. Deliberately not
// global: callers share it, so it must hold no lastIndex.
export const ROUTES_TO_FOLDER_REGEX = /[/\\]\s*$/;

function segment(type: PathSegmentType, val: string): PathSegment {
  return {
    type,
    val,
    toString() {
      return this.val;
    },
  };
}

export function stringSegment(value: unknown): PathSegment {
  return segment(PATH_SEGMENT_TYPES.STRING, value == null ? "" : value.toString());
}

function variableSegment(value: string): PathSegment {
  return segment(PATH_SEGMENT_TYPES.VARIABLE, value);
}

function separatorSegment(): PathSegment {
  return segment(PATH_SEGMENT_TYPES.SEPARATOR, "/");
}

export function replacementChar(override?: string, fallback = "") {
  return override || options.replacementChar || fallback;
}

export function replaceFsBadChars(value: string, replacement?: string) {
  // Configured text is literal; `$&` and the prefix/suffix substitutions can
  // otherwise reintroduce the forbidden characters being removed.
  return value.replace(SPECIAL_CHARACTERS_REGEX, () => replacementChar(replacement));
}

function removeUnsafeInvisibleChars(value: string) {
  return value.replace(INVISIBLE_CHARACTERS_REGEX, "");
}

function replaceLeadingDots(value: string, replacement?: string) {
  return value.replace(BAD_LEADING_CHARACTERS, () => replacementChar(replacement));
}

export function truncateIfLongerThan(value: string, max: number) {
  if (!value || max <= 0) return value;
  if (utf8Encoder.encode(value).byteLength <= max) return value;
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8Encoder.encode(character).byteLength;
    if (bytes + characterBytes > max) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function truncatePreservingExtension(value: string, max: number) {
  if (!value || max <= 0 || !getFilenameDiagnostics(value, max).exceedsLimit) return value;
  const extension = value.match(EXTENSION_REGEX)?.[0];
  if (!extension) return truncateIfLongerThan(value, max);
  const extensionBytes = utf8Encoder.encode(extension).byteLength;
  const stemBudget = max - extensionBytes;
  if (stemBudget <= 0) return truncateIfLongerThan(value, max);
  const stem = truncateIfLongerThan(value.slice(0, -extension.length), stemBudget) || "_";
  return `${stem}${extension}`;
}

export function getFilenameDiagnostics(value: string, limitBytes = 255): FilenameDiagnostics {
  const utf8Bytes = utf8Encoder.encode(value).byteLength;
  return { utf8Bytes, limitBytes, exceedsLimit: limitBytes > 0 && utf8Bytes > limitBytes };
}

function trimTrailingDotsAndSpaces(value: string) {
  return value.replace(TRAILING_DOTS_AND_SPACES_REGEX, "");
}

function trimLeadingWhitespace(value: string) {
  return value.replace(LEADING_WHITESPACE_REGEX, "");
}

function neutralizeReservedDeviceName(value: string, replacement?: string) {
  const baseName = value.split(".")[0] || value;
  if (!RESERVED_DEVICE_NAME_REGEX.test(baseName) && !RESERVED_SHELL_FILE_REGEX.test(value)) {
    return value;
  }

  return `${replacementChar(replacement, "_")}${value}`;
}

function defuseShellIntegratedExtension(value: string) {
  return value.replace(SHELL_INTEGRATED_EXTENSION_REGEX, (extension) => `_${extension.slice(1)}`);
}

// Only the rules added after 4.1.0; see acceptStoredPath.
function neutralizeBrowserRefusals(value: string) {
  const controlsReplaced = value.replace(DELETE_AND_C1_CONTROLS_REGEX, () => replacementChar());
  return defuseShellIntegratedExtension(
    neutralizeReservedDeviceName(removeUnsafeInvisibleChars(controlsReplaced)),
  );
}

export function sanitizeFilename(
  value: null,
  max?: number,
  leadingDotsForbidden?: boolean,
  preserveExtension?: boolean,
): null;
export function sanitizeFilename(
  value: string,
  max?: number,
  leadingDotsForbidden?: boolean,
  preserveExtension?: boolean,
): string;
export function sanitizeFilename(
  value: string | null,
  max = 0,
  leadingDotsForbidden = true,
  preserveExtension = false,
): string | null {
  if (!value) {
    return value;
  }

  const fsSafe = replaceFsBadChars(removeUnsafeInvisibleChars(value));
  // Trim after the forbidden-character pass, so a control character still
  // becomes the replacement rather than disappearing, but before the
  // leading-dot guard: whitespace must not hide a dot from that guard's `^`
  // anchor and carry a hidden-file or traversal name past it.
  const edgeSafe = trimLeadingWhitespace(fsSafe);
  // Trim again after the guard, not only before it: the replacement is the
  // user's, so the guard can put back the whitespace this just took off and
  // leave the edge #53 forbids. The final leading-dot pass below cannot catch
  // that — by then the component starts with the replacement, not a dot.
  const dotsHandled = leadingDotsForbidden
    ? trimLeadingWhitespace(replaceLeadingDots(edgeSafe))
    : edgeSafe;
  const trimmed = trimTrailingDotsAndSpaces(dotsHandled);
  const truncated = preserveExtension
    ? truncatePreservingExtension(trimmed, max)
    : truncateIfLongerThan(trimmed, max);
  // A custom device-name prefix can restore leading whitespace after the
  // edge pass. Trim before bounding it and rechecking with the safe prefix.
  const safeName = trimLeadingWhitespace(
    neutralizeReservedDeviceName(trimTrailingDotsAndSpaces(truncated)),
  );
  const finalName = preserveExtension
    ? truncatePreservingExtension(safeName, max)
    : truncateIfLongerThan(safeName, max);
  const finalTrimmed = trimTrailingDotsAndSpaces(finalName);
  // A custom replacement can itself truncate back to CON/PRN/etc. The final
  // filesystem-safety pass therefore uses a known-safe one-byte prefix.
  const deviceSafe = neutralizeReservedDeviceName(finalTrimmed, "_");
  const boundedDeviceSafe = preserveExtension
    ? truncatePreservingExtension(deviceSafe, max)
    : truncateIfLongerThan(deviceSafe, max);
  const result = trimTrailingDotsAndSpaces(boundedDeviceSafe);
  const leadingSafe = leadingDotsForbidden ? replaceLeadingDots(result, "_") : result;
  return defuseShellIntegratedExtension(leadingSafe) || "_";
}

export function sanitizeBufStrings(buf: PathSegment[]) {
  return buf.map((item, index) => {
    if (index === 0 && item.type === PATH_SEGMENT_TYPES.STRING && item.val === ".") {
      return item;
    }

    if (item.type === PATH_SEGMENT_TYPES.STRING) {
      const previous = buf[index - 1];
      const forbidLeadingDots = index === 0 || previous?.type === PATH_SEGMENT_TYPES.SEPARATOR;
      return stringSegment(sanitizeFilename(item.val, options.truncateLength, forbidLeadingDots));
    }
    return item;
  });
}

const EXPLICIT_RELATIVE_PREFIX_REGEX = /^\.[/\\]/;

// 4.1.0 validated nothing after a leading "./" and sanitized those components
// only at download time, so stored menus, Quick save folders and last-used
// paths can hold e.g. "./Archive " or "./.hidden". Validation is stricter now,
// but such a stored value must keep working rather than silently vanish from
// the menu, so it is accepted as the sanitized path 4.1.0 actually saved to.
// Any stored path likewise survives the later Chrome-refusal rules (C1 and
// format characters, CLOCK$, desktop.ini, .lnk/.local), which 4.1.0 accepted.
// Everything 4.1.0 already rejected stays an error, and an unknown variable
// is a reported typo, not a component the browser would have repaired.
export function acceptStoredPath(path: string): { path: string; validation: PathValidation } {
  const validation = new Path(path).validate();
  if (validation.valid || validation.error !== undefined) return { path, validation };
  const relative = EXPLICIT_RELATIVE_PREFIX_REGEX.test(path);
  const buf = parsePathStr(path);
  const candidate = buf
    .map((item, index) => {
      if (item.type !== PATH_SEGMENT_TYPES.STRING) return item.val;
      if (!relative) return neutralizeBrowserRefusals(item.val);
      if (index === 0) return item.val;
      const startsComponent = buf[index - 1]?.type === PATH_SEGMENT_TYPES.SEPARATOR;
      return sanitizeFilename(item.val, 0, startsComponent);
    })
    .join("");
  const candidateValidation = new Path(candidate).validate();
  return candidateValidation.valid
    ? { path: candidate, validation: candidateValidation }
    : { path, validation };
}

export function parsePathStr(pathInput: PathInput = "") {
  const path = pathInput ?? "";
  let split = path.split(SEPARATOR_REGEX_INCLUSIVE);
  if (typeof split === "string") {
    split = [split];
  }

  return split
    .flatMap((character) => character.split(specialDirRegexp).filter(Boolean))
    .map((token) => {
      if (token.match(SEPARATOR_REGEX_INCLUSIVE)) {
        return separatorSegment();
      }
      if (token.match(specialDirRegexp)) {
        return variableSegment(token);
      }
      return stringSegment(token);
    });
}

// A parsed path is mutable while variables are resolved, so an instance gives
// that evolving buffer an explicit owner rather than passing parallel values.
export class Path {
  raw: PathInput;
  rawbuf: PathSegment[];
  buf: PathSegment[];

  constructor(value?: PathInput) {
    const buf = parsePathStr(value);
    this.raw = value;
    this.rawbuf = buf;
    this.buf = buf;
  }

  toString(): string {
    return this.buf.join("");
  }

  finalize(finalizeOptions: PathFinalizeOptions = {}): string {
    const completed: PathSegment[] = [];
    let component = "";
    const flush = () => {
      if (!component) return;
      completed.push(stringSegment(component));
      component = "";
    };

    for (const item of this.buf) {
      if (item.type === PATH_SEGMENT_TYPES.SEPARATOR) {
        flush();
        completed.push(separatorSegment());
      } else {
        component += item.val || options.replacementChar || "_";
      }
    }
    flush();
    let finalComponentIndex = -1;
    for (let index = completed.length - 1; index >= 0; index -= 1) {
      if (completed[index]?.type === PATH_SEGMENT_TYPES.STRING) {
        finalComponentIndex = index;
        break;
      }
    }
    return completed
      .map((item, index) => {
        if (item.type === PATH_SEGMENT_TYPES.SEPARATOR) return item;
        const isLeadingDot = index === 0 && item.val === ".";
        const isFinalFilename =
          finalizeOptions.finalComponentIsFilename === true && index === finalComponentIndex;
        const value =
          isFinalFilename && finalizeOptions.transformFinalComponent && !isLeadingDot
            ? finalizeOptions.transformFinalComponent(item.val)
            : item.val;
        return stringSegment(
          isLeadingDot
            ? item.val
            : sanitizeFilename(value, options.truncateLength, true, isFinalFilename),
        );
      })
      .join("");
  }

  validate(): PathValidation {
    if (this.buf == null) {
      return { valid: false };
    }
    const first = this.buf[0];
    if (!first) return { valid: false };
    if (first.type === PATH_SEGMENT_TYPES.SEPARATOR || first.val === "..") {
      return {
        valid: false,
        message: routingPorts.getMessage("rulePathStartsWithDot"),
      };
    }

    if (typeof this.raw === "string") {
      const unknownVariable = findUnknownPathVariables(this.raw)[0];
      if (unknownVariable) {
        return {
          valid: false,
          message: routingPorts.getMessage("ruleUnknownDestinationVariable"),
          error: unknownVariable.value,
          sourceRange: { start: unknownVariable.start, end: unknownVariable.end },
        };
      }
    }

    for (const [index, item] of this.buf.entries()) {
      // The Downloads-root marker is valid, but does not exempt the rest of
      // an explicitly relative path from variable and filename validation.
      if (index === 0 && item.val === ".") continue;
      if (item.type === PATH_SEGMENT_TYPES.STRING && sanitizeFilename(item.val) !== item.val) {
        return {
          valid: false,
          message: routingPorts.getMessage("rulePathInvalidCharacter"),
        };
      }
    }
    return { valid: true };
  }
}
