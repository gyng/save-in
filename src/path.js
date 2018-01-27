const specialDirVariables = Object.values(SPECIAL_DIRS);
const specialDirRegexp = new RegExp(`(${specialDirVariables.join("|")})`);

const Paths = {
  SPECIAL_CHARACTERS_REGEX: /[<>:"/\\|?*\0]/g,
  BAD_LEADING_CHARACTERS: /^[./\\]/g,
  SEPARATOR_REGEX: /[/\\]/g,
  SEPARATOR_REGEX_INCLUSIVE: /([/\\])/g,

  PathSegment: class PathSegment {
    constructor(type, val) {
      this.type = type;
      this.val = val;
    }

    static String(v) {
      return new PathSegment(
        PATH_SEGMENT_TYPES.STRING,
        v == null ? "" : v.toString()
      );
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

  Path: class Path {
    constructor(str) {
      const buf = Paths.parsePathStr(str);
      this.raw = str;
      this.rawbuf = buf;
      this.buf = buf;
    }

    toString() {
      return this.buf.join("");
    }

    finalize() {
      const stringifiedBuf = this.buf
        .map(s => {
          if (s.type !== PATH_SEGMENT_TYPES.SEPARATOR) {
            return Paths.PathSegment.String(s.val);
          } else {
            return s;
          }
        })
        .map(
          s =>
            s.val ? s : Paths.PathSegment.String(options.replacementChar || "_")
        );

      const sanitizedStringifiedBuf = Paths.sanitizeBufStrings(stringifiedBuf);

      const finalizedPath = Object.assign(new Path(), this, {
        buf: sanitizedStringifiedBuf
      });

      return finalizedPath.toString();
    }

    validate() {
      // Special cases
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
          message: "Path cannot start with .. or /"
        };
      }

      for (let i = 0; i < this.buf.length; i += 1) {
        // Sanitisation failure
        const segment = this.buf[i];
        if (
          segment.type === PATH_SEGMENT_TYPES.STRING &&
          Paths.sanitizeFilename(segment.val) !== segment.val
        ) {
          return { valid: false, message: "Path contains invalid characters" };
        }
      }
      return { valid: true };
    }
  },

  // TODO: Make this OS-aware instead of assuming Windows as LCD
  replaceFsBadChars: (s, replacement) =>
    s.replace(
      Paths.SPECIAL_CHARACTERS_REGEX,
      replacement ||
        (typeof options !== "undefined" &&
          options &&
          options.replacementChar) ||
        "_"
    ),

  // Leading dots are considered invalid by both Firefox and Chrome
  replaceLeadingDots: (s, replacement) =>
    s.replace(
      Paths.BAD_LEADING_CHARACTERS,
      replacement ||
        (typeof options !== "undefined" &&
          options &&
          options.replacementChar) ||
        "_"
    ),

  truncateIfLongerThan: (str, max) =>
    str && max > 0 && str.length > max ? str.substr(0, max) : str,

  sanitizeFilename: (str, max = 0, leadingDotsForbidden = true) => {
    if (!str) {
      return str;
    }

    const fsSafe = Paths.truncateIfLongerThan(
      Paths.replaceFsBadChars(str),
      max
    );

    if (leadingDotsForbidden) {
      return Paths.replaceLeadingDots(fsSafe);
    }

    return fsSafe;
  },

  sanitizeBufStrings: buf =>
    buf.map((s, i) => {
      if (i === 0 && s.type === PATH_SEGMENT_TYPES.STRING && s.val === ".") {
        return s;
      }

      if (s.type === PATH_SEGMENT_TYPES.Separator) {
        return Paths.PathSegment.String("/");
      } else if (s.type === PATH_SEGMENT_TYPES.STRING) {
        return Paths.PathSegment.String(
          Paths.sanitizeFilename(s.val, options.truncateLength, i === 0)
        );
      } else {
        return s;
      }
    }),

  parsePathStr: (pathStr = "") => {
    let split = pathStr.split(Paths.SEPARATOR_REGEX_INCLUSIVE);
    if (typeof split === "string") {
      split = [split];
    }

    const tokenized = split.map(c =>
      c.split(specialDirRegexp).filter(sub => sub.length > 0)
    );
    const flattened = [].concat.apply([], tokenized); // eslint-disable-line

    const parsed = flattened.map(tok => {
      if (tok.match(Paths.SEPARATOR_REGEX_INCLUSIVE)) {
        return Paths.PathSegment.Separator(tok);
      } else if (tok.match(specialDirRegexp)) {
        return Paths.PathSegment.Variable(tok);
      }
      return Paths.PathSegment.String(tok);
    });

    return parsed;
  }
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Paths;
}
