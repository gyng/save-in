/* eslint-disable no-use-before-define */
// @ts-check

const specialDirVariables = Object.values(SPECIAL_DIRS);
const specialDirRegexp = new RegExp(`(${specialDirVariables.join("|")})`);

class PathSegment {
  /**
   * @param {typeof PATH_SEGMENT_TYPES[keyof PATH_SEGMENT_TYPES]} type
   * @param {string} val
   */
  constructor(type, val) {
    this.type = type;
    this.val = val;
  }

  /**
   * @param {string | number | null | undefined} v
   */
  static String(v) {
    return new PathSegment(
      PATH_SEGMENT_TYPES.STRING,
      v == null ? "" : v.toString()
    );
  }

  /**
   * @param {string} v
   */
  static Variable(v) {
    return new PathSegment(PATH_SEGMENT_TYPES.VARIABLE, v);
  }

  static Separator() {
    return new PathSegment(PATH_SEGMENT_TYPES.SEPARATOR, "/");
  }

  toString() {
    return this.val;
  }
}

class _Path {
  /**
   * @param {string | null | undefined} [str]
   */
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
      .map((s) =>
        s.val ? s : Path.PathSegment.String(options.replacementChar || "_")
      );

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
    if (
      this.buf[0].type === PATH_SEGMENT_TYPES.SEPARATOR ||
      this.buf[0].val === ".."
    ) {
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
}

const Path = {
  SPECIAL_CHARACTERS_REGEX: /[<>:"/\\|?*\0]/g,
  BAD_LEADING_CHARACTERS: /^[./\\]/g,
  SEPARATOR_REGEX: /[/\\]/g,
  SEPARATOR_REGEX_INCLUSIVE: /([/\\])/g,

  PathSegment,

  Path: _Path,

  // TODO: Make this OS-aware instead of assuming Windows as LCD
  replaceFsBadChars: (
    /** @type {string} */ s,
    /** @type {string} */ replacement
  ) =>
    s.replace(
      Path.SPECIAL_CHARACTERS_REGEX,
      replacement ||
        (typeof options !== "undefined" &&
          options &&
          options.replacementChar) ||
        ""
    ),

  // Leading dots are considered invalid by both Firefox and Chrome
  replaceLeadingDots: (
    /** @type {string} */ s,
    /** @type {string} */ replacement
  ) =>
    s.replace(
      Path.BAD_LEADING_CHARACTERS,
      replacement ||
        (typeof options !== "undefined" &&
          options &&
          options.replacementChar) ||
        ""
    ),

  truncateIfLongerThan: (
    /** @type {string} */ str,
    /** @type {number} */ max
  ) => (str && max > 0 && str.length > max ? str.substr(0, max) : str),

  sanitizeFilename: (
    /** @type {string} */ str,
    max = 0,
    leadingDotsForbidden = true
  ) => {
    if (!str) {
      return str;
    }

    const fsSafe = Path.truncateIfLongerThan(Path.replaceFsBadChars(str), max);

    if (leadingDotsForbidden) {
      return Path.replaceLeadingDots(fsSafe);
    }

    return fsSafe;
  },

  sanitizeBufStrings: (/** @type {PathSegment[]} */ buf) =>
    buf.map((s, i) => {
      if (i === 0 && s.type === PATH_SEGMENT_TYPES.STRING && s.val === ".") {
        return s;
      }

      // @ts-expect-error existing bug in segment creation?
      if (s.type === PATH_SEGMENT_TYPES.Separator) {
        return Path.PathSegment.String("/");
      } else if (s.type === PATH_SEGMENT_TYPES.STRING) {
        // This allows for Path segments [(STRING, foofilename), (STRING, .bar)]
        // but forbids [(SEPARATOR, /), (STRING, .bar)]
        // STRING followed by a STRING can happen in filename rewrites
        const forbidLeadingDots =
          i === 0 || buf[i - 1].type === PATH_SEGMENT_TYPES.SEPARATOR;
        return Path.PathSegment.String(
          Path.sanitizeFilename(
            s.val,
            options.truncateLength,
            forbidLeadingDots
          )
        );
      } else {
        return s;
      }
    }),

  parsePathStr: (/** @type {string | null | undefined} */ pathStr = "") => {
    if (pathStr == null) {
      pathStr = "";
    }

    let split = pathStr.split(Path.SEPARATOR_REGEX_INCLUSIVE);
    if (typeof split === "string") {
      split = [split];
    }

    const tokenized = split.map((c) =>
      c.split(specialDirRegexp).filter((sub) => sub.length > 0)
    );
    /**
     * @type {string[]}
     */
    // @ts-expect-error type spaghetti
    // eslint-disable-next-line prefer-spread
    const flattened = [].concat.apply([], tokenized);

    const parsed = flattened.map((tok) => {
      if (tok.match(Path.SEPARATOR_REGEX_INCLUSIVE)) {
        // @ts-expect-error existing bug, Separator() does not expect args
        return Path.PathSegment.Separator(tok);
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
  module.exports = {
    Path,
    _Path,
    PathSegment,
  };
}
