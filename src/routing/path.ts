import { webExtensionApi } from "../platform/web-extension-api.ts";

import { SPECIAL_DIRS, FORBIDDEN_FILENAME_CHARS, PATH_SEGMENT_TYPES } from "../shared/constants.ts";
import { options } from "../config/options-data.ts";

const specialDirVariables = Object.values(SPECIAL_DIRS);
const specialDirRegexp = new RegExp(`(${specialDirVariables.join("|")})`);

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

// These regexes are exported because they define the platform-neutral path
// policy; callers should normally use the sanitizing functions below.
export const SPECIAL_CHARACTERS_REGEX = new RegExp(FORBIDDEN_FILENAME_CHARS.source, "g");
export const BAD_LEADING_CHARACTERS = /^[./\\]/g;
export const TRAILING_DOTS_AND_SPACES_REGEX = /[. ]+$/;
export const RESERVED_DEVICE_NAME_REGEX = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
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
  return value && max > 0 && value.length > max ? value.slice(0, max) : value;
}

export function trimTrailingDotsAndSpaces(value: string) {
  return value.replace(TRAILING_DOTS_AND_SPACES_REGEX, "");
}

export function neutralizeReservedDeviceName(value: string, replacement?: string) {
  const baseName = value.split(".")[0];
  if (!RESERVED_DEVICE_NAME_REGEX.test(baseName)) {
    return value;
  }

  return `${replacementChar(replacement, "_")}${value}`;
}

export function sanitizeFilename(value: null, max?: number, leadingDotsForbidden?: boolean): null;
export function sanitizeFilename(
  value: string,
  max?: number,
  leadingDotsForbidden?: boolean,
): string;
export function sanitizeFilename(
  value: string | null,
  max = 0,
  leadingDotsForbidden = true,
): string | null {
  if (!value) {
    return value;
  }

  const fsSafe = truncateIfLongerThan(replaceFsBadChars(value), max);
  const dotsHandled = leadingDotsForbidden ? replaceLeadingDots(fsSafe) : fsSafe;
  const trimmed = trimTrailingDotsAndSpaces(dotsHandled);
  return neutralizeReservedDeviceName(trimmed);
}

export function sanitizeBufStrings(buf: PathSegment[]) {
  return buf.map((item, index) => {
    if (index === 0 && item.type === PATH_SEGMENT_TYPES.STRING && item.val === ".") {
      return item;
    }

    if (item.type === PATH_SEGMENT_TYPES.STRING) {
      const forbidLeadingDots = index === 0 || buf[index - 1].type === PATH_SEGMENT_TYPES.SEPARATOR;
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

  finalize() {
    const stringifiedBuf = this.buf!.map((item) =>
      item.type === PATH_SEGMENT_TYPES.SEPARATOR ? item : stringSegment(item.val),
    ).map((item) => (item.val ? item : stringSegment(options.replacementChar || "_")));

    return Object.assign(new Path(), this, { buf: sanitizeBufStrings(stringifiedBuf) }).toString();
  }

  validate(): PathValidation {
    if (this.buf == null) {
      return { valid: false };
    }
    if (this.buf[0].val === ".") {
      return { valid: true };
    }
    if (this.buf[0].type === PATH_SEGMENT_TYPES.SEPARATOR || this.buf[0].val === "..") {
      return {
        valid: false,
        message: webExtensionApi.i18n.getMessage("rulePathStartsWithDot"),
      };
    }

    for (const item of this.buf) {
      if (item.type === PATH_SEGMENT_TYPES.STRING && sanitizeFilename(item.val) !== item.val) {
        return {
          valid: false,
          message: webExtensionApi.i18n.getMessage("rulePathInvalidCharacter"),
        };
      }
    }
    return { valid: true };
  }
}
