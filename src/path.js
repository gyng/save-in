// const DISPOSITION_FILENAME_REGEX = /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i;
// const EXTENSION_REGEX = /\.([0-9a-z]{1,8})$/i;
// const SPECIAL_CHARACTERS_REGEX = /[<>:"/\\|?*\0]/g;
// const BAD_LEADING_CHARACTERS = /^[./\\]/g;
// const SEPARATOR_REGEX = /[/\\]/g;

// TODO: Make this OS-aware instead of assuming Windows
const replaceFsBadChars = (s, replacement) =>
  s.replace(
    SPECIAL_CHARACTERS_REGEX,
    replacement ||
      (typeof options !== "undefined" && options && options.replacementChar) ||
      "_"
  );

// Leading dots are considered invalid by both Firefox and Chrome
const replaceLeadingDots = (s, replacement) =>
  s.replace(
    BAD_LEADING_CHARACTERS,
    replacement ||
      (typeof options !== "undefined" && options && options.replacementChar) ||
      "_"
  );

const truncateIfLongerThan = (str, max) =>
  str && max > 0 && str.length > max ? str.substr(0, max) : str;

const sanitizeFilename = (str, max = 0) =>
  str && replaceLeadingDots(truncateIfLongerThan(replaceFsBadChars(str), max));

const sanitizeBufStrings = buf =>
  buf.map(s => {
    if (s.type === PATH_SEGMENT_TYPES.SEPARATOR) {
      return PATH_SEGMENT.STRING("/");
    } else if (s.type === PATH_SEGMENT_TYPES.STRING) {
      return PATH_SEGMENT.STRING(
        sanitizeFilename(s.val, options.truncateLength)
      );
    } else {
      return s;
    }
  });

const finalizeToString = path => {
  if (!path) {
    return null;
  }

  const stringifiedBuf = path.buf
    .map(s => {
      if (s.type !== PATH_SEGMENT_TYPES.SEPARATOR) {
        return PATH_SEGMENT.STRING(s.val);
      } else {
        return s;
      }
    })
    .map(
      s => (s.val ? s : PATH_SEGMENT.STRING(options.replacementChar || "_"))
    );

  const sanitizedStringifiedBuf = sanitizeBufStrings(stringifiedBuf);

  const finalizedPath = Object.assign(new Path(), path, {
    buf: sanitizedStringifiedBuf
  });

  return finalizedPath.toString();
};

function PathSegment(type, val) {
  this.type = type;
  this.val = val;
}

PathSegment.prototype.toString = function toString() {
  return this.val;
};

const PATH_SEGMENT = {
  [PATH_SEGMENT_TYPES.STRING]: v =>
    new PathSegment(PATH_SEGMENT_TYPES.STRING, v),
  [PATH_SEGMENT_TYPES.VARIABLE]: v =>
    new PathSegment(PATH_SEGMENT_TYPES.VARIABLE, v),
  [PATH_SEGMENT_TYPES.SEPARATOR]: v =>
    new PathSegment(PATH_SEGMENT_TYPES.SEPARATOR, v)
};

const fixmedirs = Object.values(SDN);
const fixmeregex = `(${fixmedirs.join("|")})`;
const parsePathStr = (pathStr = "") => {
  let split = pathStr.split(/([/\\])/);
  if (typeof split === "string") {
    split = [split];
  }

  const tokenized = split.map(c =>
    c.split(new RegExp(fixmeregex)).filter(sub => sub.length > 0)
  );
  const flattened = [].concat.apply([], tokenized); // eslint-disable-line

  const parsed = flattened.map(tok => {
    if (tok.match(/[/\\]/)) {
      return PATH_SEGMENT.SEPARATOR(tok);
    } else if (tok.match(fixmeregex)) {
      return PATH_SEGMENT.VARIABLE(tok);
    }
    return PATH_SEGMENT.STRING(tok);
  });

  return parsed;
};

function Path(str) {
  const buf = parsePathStr(str);
  this.raw = str;
  this.rawbuf = buf;
  this.buf = buf;
}
Path.prototype.toString = function pathToString() {
  return this.buf.map(b => b.toString()).join("");
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    parsePathStr,
    Path,
    PathSegment,
    PATH_SEGMENT,
    PATH_SEGMENT_TYPES
  };
}
