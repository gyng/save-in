import { SPECIAL_DIRS, FORBIDDEN_FILENAME_CHARS, PATH_SEGMENT_TYPES } from "../shared/constants.ts";
import { options } from "../config/options-data.ts";
import { routingPorts } from "./ports.ts";
import { EXTENSION_REGEX } from "./filename.ts";

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
export type PathValidation = { valid: boolean; message?: string };
export type FilenameDiagnostics = {
  utf8Bytes: number;
  limitBytes: number;
  exceedsLimit: boolean;
};
export type PathFinalizeOptions = { finalComponentIsFilename?: boolean };

// These regexes are exported because they define the platform-neutral path
// policy; callers should normally use the sanitizing functions below.
export const SPECIAL_CHARACTERS_REGEX = new RegExp(FORBIDDEN_FILENAME_CHARS.source, "g");
export const BAD_LEADING_CHARACTERS = /^[./\\]/g;
export const TRAILING_DOTS_AND_SPACES_REGEX = /[. ]+$/;
export const RESERVED_DEVICE_NAME_REGEX = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i;
export const SEPARATOR_REGEX_INCLUSIVE = /([/\\])/g;

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

export function variableSegment(value: string): PathSegment {
  return segment(PATH_SEGMENT_TYPES.VARIABLE, value);
}

export function separatorSegment(): PathSegment {
  return segment(PATH_SEGMENT_TYPES.SEPARATOR, "/");
}

export function replacementChar(override?: string, fallback = "") {
  return override || options.replacementChar || fallback;
}

export function replaceFsBadChars(value: string, replacement?: string) {
  return value.replace(SPECIAL_CHARACTERS_REGEX, replacementChar(replacement));
}

export function replaceLeadingDots(value: string, replacement?: string) {
  return value.replace(BAD_LEADING_CHARACTERS, replacementChar(replacement));
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

export function trimTrailingDotsAndSpaces(value: string) {
  return value.replace(TRAILING_DOTS_AND_SPACES_REGEX, "");
}

export function neutralizeReservedDeviceName(value: string, replacement?: string) {
  const baseName = value.split(".")[0] || value;
  if (!RESERVED_DEVICE_NAME_REGEX.test(baseName)) {
    return value;
  }

  return `${replacementChar(replacement, "_")}${value}`;
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

  const fsSafe = replaceFsBadChars(value);
  const dotsHandled = leadingDotsForbidden ? replaceLeadingDots(fsSafe) : fsSafe;
  const trimmed = trimTrailingDotsAndSpaces(dotsHandled);
  const truncated = preserveExtension
    ? truncatePreservingExtension(trimmed, max)
    : truncateIfLongerThan(trimmed, max);
  const safeName = neutralizeReservedDeviceName(trimTrailingDotsAndSpaces(truncated));
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
  return leadingSafe || "_";
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
  buf: PathSegment[] | null;

  constructor(value?: PathInput) {
    const buf = parsePathStr(value);
    this.raw = value;
    this.rawbuf = buf;
    this.buf = buf;
  }

  toString() {
    return this.buf!.join("");
  }

  finalize(finalizeOptions: PathFinalizeOptions = {}) {
    const completed: PathSegment[] = [];
    let component = "";
    const flush = () => {
      if (!component) return;
      completed.push(stringSegment(component));
      component = "";
    };

    for (const item of this.buf!) {
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
        return stringSegment(
          isLeadingDot
            ? item.val
            : sanitizeFilename(
                item.val,
                options.truncateLength,
                true,
                finalizeOptions.finalComponentIsFilename && index === finalComponentIndex,
              ),
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
    if (first.val === ".") {
      return { valid: true };
    }
    if (first.type === PATH_SEGMENT_TYPES.SEPARATOR || first.val === "..") {
      return {
        valid: false,
        message: routingPorts.getMessage("rulePathStartsWithDot"),
      };
    }

    for (const item of this.buf) {
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
