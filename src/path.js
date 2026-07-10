const specialDirVariables = Object.values(SPECIAL_DIRS);
const specialDirRegexp = new RegExp(`(${specialDirVariables.join("|")})`);

const Path = {
  // eslint-disable-next-line no-control-regex -- control characters \x00-\x1F (including NUL) are intentionally stripped: :pagetitle:/selection text can carry raw newlines/tabs that Windows filenames can't contain (GH #221)
  SPECIAL_CHARACTERS_REGEX: /[<>:"/\\|?*\x00-\x1f]/g,
  BAD_LEADING_CHARACTERS: /^[./\\]/g,
  // Windows trims/rejects trailing dots and spaces on every path segment
  TRAILING_DOTS_AND_SPACES_REGEX: /[. ]+$/,
  // Windows reserves these device names case-insensitively, extension
  // ignored ("con.txt" is just as reserved as bare "con")
  RESERVED_DEVICE_NAME_REGEX: /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i,
  SEPARATOR_REGEX: /[/\\]/g,
  SEPARATOR_REGEX_INCLUSIVE: /([/\\])/g,

  PathSegment: class PathSegment {
    constructor(type, val) {
      this.type = type;
      this.val = val;
    }

    static String(v) {
      return new PathSegment(PATH_SEGMENT_TYPES.STRING, v == null ? "" : v.toString());
    }

    static Variable(v) {
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
    constructor(str) {
      const buf = Path.parsePathStr(str);
      this.raw = str;
      this.rawbuf = buf;
      this.buf = buf;
    }

    toString() {
      return this.buf.join("");
    }

    finalize() {
      const stringifiedBuf = this.buf
        .map((s) => {
          if (s.type !== PATH_SEGMENT_TYPES.SEPARATOR) {
            return Path.PathSegment.String(s.val);
          } else {
            return s;
          }
        })
        .map((s) => (s.val ? s : Path.PathSegment.String(options.replacementChar || "_")));

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
          message: browser.i18n.getMessage("rulePathStartsWithDot"),
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
            message: browser.i18n.getMessage("rulePathInvalidCharacter"),
          };
        }
      }
      return { valid: true };
    }
  },

  // TODO: Make this OS-aware instead of assuming Windows as LCD
  replaceFsBadChars: (s, replacement) =>
    s.replace(
      Path.SPECIAL_CHARACTERS_REGEX,
      replacement || (typeof options !== "undefined" && options && options.replacementChar) || "",
    ),

  // Leading dots are considered invalid by both Firefox and Chrome
  replaceLeadingDots: (s, replacement) =>
    s.replace(
      Path.BAD_LEADING_CHARACTERS,
      replacement || (typeof options !== "undefined" && options && options.replacementChar) || "",
    ),

  truncateIfLongerThan: (str, max) =>
    str && max > 0 && str.length > max ? str.substr(0, max) : str,

  // Trailing dots/spaces are silently dropped or rejected by Windows Explorer
  // and the underlying Win32 API
  trimTrailingDotsAndSpaces: (s) => s.replace(Path.TRAILING_DOTS_AND_SPACES_REGEX, ""),

  // Windows treats everything up to the first dot as the device name, so
  // "con.tar.gz" is just as reserved as "con"
  neutralizeReservedDeviceName: (s, replacement) => {
    const baseName = s.split(".")[0];
    if (!Path.RESERVED_DEVICE_NAME_REGEX.test(baseName)) {
      return s;
    }

    const char =
      replacement || (typeof options !== "undefined" && options && options.replacementChar) || "_";
    return `${char}${s}`;
  },

  sanitizeFilename: (str, max = 0, leadingDotsForbidden = true) => {
    if (!str) {
      return str;
    }

    const fsSafe = Path.truncateIfLongerThan(Path.replaceFsBadChars(str), max);
    const dotsHandled = leadingDotsForbidden ? Path.replaceLeadingDots(fsSafe) : fsSafe;
    const trimmed = Path.trimTrailingDotsAndSpaces(dotsHandled);

    return Path.neutralizeReservedDeviceName(trimmed);
  },

  sanitizeBufStrings: (buf) =>
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

  parsePathStr: (pathStr = "") => {
    if (pathStr == null) {
      pathStr = "";
    }

    let split = pathStr.split(Path.SEPARATOR_REGEX_INCLUSIVE);
    if (typeof split === "string") {
      split = [split];
    }

    const tokenized = split.map((c) => c.split(specialDirRegexp).filter((sub) => sub.length > 0));
    const flattened = [].concat.apply([], tokenized); // eslint-disable-line

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

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Path;
}
