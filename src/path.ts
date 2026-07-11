import { webExtensionApi } from "./web-extension-api.ts";

import { SPECIAL_DIRS, FORBIDDEN_FILENAME_CHARS, PATH_SEGMENT_TYPES } from "./constants.ts";
import { options } from "./options-data.ts";

const specialDirVariables = Object.values(SPECIAL_DIRS);
const specialDirRegexp = new RegExp(`(${specialDirVariables.join("|")})`);

type PathSegmentType = (typeof PATH_SEGMENT_TYPES)[keyof typeof PATH_SEGMENT_TYPES] | undefined;

type PathSegmentValue = {
  type: PathSegmentType;
  val: string;
  toString?: () => string;
};

type SplitPathInput = {
  split(separator: RegExp): string | string[];
};

type PathInput = string | SplitPathInput | null | undefined;

type PathValidation = { valid: boolean; message?: string };

interface PathApi {
  SPECIAL_CHARACTERS_REGEX: RegExp;
  BAD_LEADING_CHARACTERS: RegExp;
  TRAILING_DOTS_AND_SPACES_REGEX: RegExp;
  RESERVED_DEVICE_NAME_REGEX: RegExp;
  SEPARATOR_REGEX: RegExp;
  SEPARATOR_REGEX_INCLUSIVE: RegExp;
  PathSegment: {
    new (type: PathSegmentType, val: string): PathSegmentValue;
    String(value: unknown): PathSegmentValue;
    Variable(value: string): PathSegmentValue;
    Separator(): PathSegmentValue;
  };
  Path: {
    new (str?: PathInput): {
      raw: PathInput;
      rawbuf: PathSegmentValue[];
      buf: PathSegmentValue[] | null;
      toString(): string;
      finalize(): string;
      validate(): PathValidation;
    };
  };
  replacementChar(override?: string, fallback?: string): string;
  replaceFsBadChars(value: string, replacement?: string): string;
  replaceLeadingDots(value: string, replacement?: string): string;
  truncateIfLongerThan(value: string, max: number): string;
  trimTrailingDotsAndSpaces(value: string): string;
  neutralizeReservedDeviceName(value: string, replacement?: string): string;
  sanitizeFilename(value: null, max?: number, leadingDotsForbidden?: boolean): null;
  sanitizeFilename(value: string, max?: number, leadingDotsForbidden?: boolean): string;
  sanitizeBufStrings(buf: PathSegmentValue[]): PathSegmentValue[];
  parsePathStr(pathStr?: PathInput): PathSegmentValue[];
}

function sanitizeFilename(str: null, max?: number, leadingDotsForbidden?: boolean): null;
function sanitizeFilename(str: string, max?: number, leadingDotsForbidden?: boolean): string;
function sanitizeFilename(str: string | null, max = 0, leadingDotsForbidden = true): string | null {
  if (!str) {
    return str;
  }

  const fsSafe = Path.truncateIfLongerThan(Path.replaceFsBadChars(str), max);
  const dotsHandled = leadingDotsForbidden ? Path.replaceLeadingDots(fsSafe) : fsSafe;
  const trimmed = Path.trimTrailingDotsAndSpaces(dotsHandled);

  return Path.neutralizeReservedDeviceName(trimmed);
}

export const Path: PathApi = {
  // The shared forbidden-char class (constants.js), with the `g` flag added for
  // String#replace; :pagetitle:/selection text can carry raw newlines/tabs that
  // Windows filenames can't contain (GH #221)
  SPECIAL_CHARACTERS_REGEX: new RegExp(FORBIDDEN_FILENAME_CHARS.source, "g"),
  BAD_LEADING_CHARACTERS: /^[./\\]/g,
  // Windows trims/rejects trailing dots and spaces on every path segment
  TRAILING_DOTS_AND_SPACES_REGEX: /[. ]+$/,
  // Windows reserves these device names case-insensitively, extension
  // ignored ("con.txt" is just as reserved as bare "con")
  RESERVED_DEVICE_NAME_REGEX: /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i,
  SEPARATOR_REGEX: /[/\\]/g,
  SEPARATOR_REGEX_INCLUSIVE: /([/\\])/g,

  PathSegment: class PathSegment {
    type: PathSegmentType;
    val: string;
    constructor(type: PathSegmentType, val: string) {
      this.type = type;
      this.val = val;
    }

    static String(v: unknown) {
      return new PathSegment(PATH_SEGMENT_TYPES.STRING, v == null ? "" : v.toString());
    }

    static Variable(v: string) {
      return new PathSegment(PATH_SEGMENT_TYPES.VARIABLE, v);
    }

    static Separator() {
      return new PathSegment(PATH_SEGMENT_TYPES.SEPARATOR, "/");
    }

    toString() {
      return this.val;
    }
  },

  Path: class _Path {
    raw: PathInput;
    rawbuf: PathSegmentValue[];
    buf: PathSegmentValue[] | null;
    constructor(str?: PathInput) {
      const buf = Path.parsePathStr(str);
      this.raw = str;
      this.rawbuf = buf;
      this.buf = buf;
    }

    toString() {
      return this.buf!.join("");
    }

    finalize() {
      const stringifiedBuf = this.buf!.map((s) => {
        if (s.type !== PATH_SEGMENT_TYPES.SEPARATOR) {
          return Path.PathSegment.String(s.val);
        } else {
          return s;
        }
      }).map((s) => (s.val ? s : Path.PathSegment.String(options.replacementChar || "_")));

      const sanitizedStringifiedBuf = Path.sanitizeBufStrings(stringifiedBuf);

      const finalizedPath = Object.assign(new _Path(), this, {
        buf: sanitizedStringifiedBuf,
      });

      return finalizedPath.toString();
    }

    validate() {
      // Special cases
      if (this.buf == null) {
        return { valid: false };
      }

      if (this.buf[0].val === ".") {
        return { valid: true };
      }

      // Path is not a child of the default downloads directory
      if (this.buf[0].type === PATH_SEGMENT_TYPES.SEPARATOR || this.buf[0].val === "..") {
        return {
          valid: false,
          message: webExtensionApi.i18n.getMessage("rulePathStartsWithDot"),
        };
      }

      for (let i = 0; i < this.buf.length; i += 1) {
        // Sanitisation failure
        const segment = this.buf[i];
        if (
          segment.type === PATH_SEGMENT_TYPES.STRING &&
          Path.sanitizeFilename(segment.val) !== segment.val
        ) {
          return {
            valid: false,
            message: webExtensionApi.i18n.getMessage("rulePathInvalidCharacter"),
          };
        }
      }
      return { valid: true };
    }
  },

  // Resolve the replacement character: explicit override, else the user's
  // configured replacementChar, else the fallback ("" strips, "_" prefixes)
  replacementChar: (override?: string, fallback = "") =>
    override || (typeof options !== "undefined" && options && options.replacementChar) || fallback,

  // TODO: Make this OS-aware instead of assuming Windows as LCD
  replaceFsBadChars: (s: string, replacement?: string) =>
    s.replace(Path.SPECIAL_CHARACTERS_REGEX, Path.replacementChar(replacement)),

  // Leading dots are considered invalid by both Firefox and Chrome
  replaceLeadingDots: (s: string, replacement?: string) =>
    s.replace(Path.BAD_LEADING_CHARACTERS, Path.replacementChar(replacement)),

  truncateIfLongerThan: (str: string, max: number) =>
    str && max > 0 && str.length > max ? str.substr(0, max) : str,

  // Trailing dots/spaces are silently dropped or rejected by Windows Explorer
  // and the underlying Win32 API
  trimTrailingDotsAndSpaces: (s: string) => s.replace(Path.TRAILING_DOTS_AND_SPACES_REGEX, ""),

  // Windows treats everything up to the first dot as the device name, so
  // "con.tar.gz" is just as reserved as "con"
  neutralizeReservedDeviceName: (s: string, replacement?: string) => {
    const baseName = s.split(".")[0];
    if (!Path.RESERVED_DEVICE_NAME_REGEX.test(baseName)) {
      return s;
    }

    const char = Path.replacementChar(replacement, "_");
    return `${char}${s}`;
  },

  sanitizeFilename,

  sanitizeBufStrings: (buf: PathSegmentValue[]) =>
    buf.map((s, i) => {
      if (i === 0 && s.type === PATH_SEGMENT_TYPES.STRING && s.val === ".") {
        return s;
      }

      if (s.type === PATH_SEGMENT_TYPES.STRING) {
        // This allows for Path segments [(STRING, foofilename), (STRING, .bar)]
        // but forbids [(SEPARATOR, /), (STRING, .bar)]
        // STRING followed by a STRING can happen in filename rewrites
        const forbidLeadingDots = i === 0 || buf[i - 1].type === PATH_SEGMENT_TYPES.SEPARATOR;
        return Path.PathSegment.String(
          Path.sanitizeFilename(s.val, options.truncateLength, forbidLeadingDots),
        );
      } else {
        return s;
      }
    }),

  parsePathStr: (pathStr: PathInput = "") => {
    if (pathStr == null) {
      pathStr = "";
    }

    let split = pathStr.split(Path.SEPARATOR_REGEX_INCLUSIVE);
    if (typeof split === "string") {
      split = [split];
    }

    const tokenized = split.map((c) => c.split(specialDirRegexp).filter((sub) => sub.length > 0));
    const flattened = tokenized.flat();

    const parsed = flattened.map((tok) => {
      if (tok.match(Path.SEPARATOR_REGEX_INCLUSIVE)) {
        // Both / and \ normalise to a plain "/" separator segment
        return Path.PathSegment.Separator();
      } else if (tok.match(specialDirRegexp)) {
        return Path.PathSegment.Variable(tok);
      }
      return Path.PathSegment.String(tok);
    });

    return parsed;
  },
};
