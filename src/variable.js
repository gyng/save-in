// @ts-check

const Variable = {
  // TODO: Move into utils
  withUrl: (
    /** @type {string | URL} */ str,
    /** @type {(arg0: URL) => any} */ cb
  ) => {
    try {
      return cb(new URL(str));
    } catch (e) {
      return str;
    }
  },

  padDateComponent: (/** @type {number} */ num) =>
    num.toString().padStart(2, "0"),

  toDateString: (/** @type {Date} */ d) =>
    [
      d.getFullYear(),
      Variable.padDateComponent(d.getMonth() + 1),
      Variable.padDateComponent(d.getDate()),
    ].join("-"),

  toISODateString: (/** @type {Date} */ d) =>
    [
      d.getUTCFullYear(),
      Variable.padDateComponent(d.getUTCMonth() + 1),
      Variable.padDateComponent(d.getUTCDate()),
      "T",
      Variable.padDateComponent(d.getUTCHours()),
      Variable.padDateComponent(d.getUTCMinutes()),
      Variable.padDateComponent(d.getUTCSeconds()),
      "Z",
    ].join(""),

  getFileExtension: (/** @type {string | undefined} */ filename) => {
    if (!filename) {
      return "";
    }

    const fileExtensionMatches = filename.match(Download.EXTENSION_REGEX);
    return (fileExtensionMatches && fileExtensionMatches[1]) || "";
  },

  applyVariables: (/** @type {_Path} */ path, opts = {}) =>
    Object.assign(path, {
      buf:
        path.buf &&
        path.buf.map(
          (
            /** @type {PathSegment} */ t,
            /** @type {number} */ i,
            /** @type {unknown} */ arr
          ) => {
            if (t.type === PATH_SEGMENT_TYPES.VARIABLE) {
              // @ts-ignore
              // eslint-disable-next-line no-use-before-define
              const transformer = transformers[t];
              if (transformer) {
                // info, token, index, tokens
                return transformer(opts, t, i, arr);
              }
            }

            return t;
          }
        ),
    }),

  // @ts-ignore
  // eslint-disable-next-line no-use-before-define
  transformers,
};

/* prettier-ignore */
/** @type {Record<typeof SPECIAL_DIRS[keyof SPECIAL_DIRS], (opts: StateInfo) => PathSegment>} */
const transformers = {
  [SPECIAL_DIRS.FILENAME]:
    opts => Path.PathSegment.String(opts.filename),
  [SPECIAL_DIRS.FILE_EXTENSION]:
    opts => Path.PathSegment.String(Variable.getFileExtension(opts.filename)),
  [SPECIAL_DIRS.SOURCE_DOMAIN]:
    // @ts-ignore
    opts => Path.PathSegment.String(Variable.withUrl(opts.url, url => url.hostname)),
  [SPECIAL_DIRS.PAGE_DOMAIN]:
    // @ts-ignore
    opts => Path.PathSegment.String(Variable.withUrl(opts.pageUrl, url => url.hostname)),
  [SPECIAL_DIRS.PAGE_URL]:
    opts => Path.PathSegment.String(opts.pageUrl),
  [SPECIAL_DIRS.SOURCE_URL]:
    opts => Path.PathSegment.String(opts.sourceUrl),
  [SPECIAL_DIRS.DATE]:
    opts => Path.PathSegment.String(Variable.toDateString(opts.now)),
  [SPECIAL_DIRS.ISO8601_DATE]:
    opts => Path.PathSegment.String(Variable.toISODateString(opts.now)),
  [SPECIAL_DIRS.UNIX_DATE]:
    // @ts-ignore
    opts => Path.PathSegment.String(Date.parse(opts.now) / 1000),
  [SPECIAL_DIRS.YEAR]:
    opts => Path.PathSegment.String(opts.now.getFullYear()),
  [SPECIAL_DIRS.MONTH]:
    opts => Path.PathSegment.String(Variable.padDateComponent(opts.now.getMonth() + 1)),
  [SPECIAL_DIRS.DAY]:
    opts => Path.PathSegment.String(Variable.padDateComponent(opts.now.getDate())),
  [SPECIAL_DIRS.HOUR]:
    opts => Path.PathSegment.String(Variable.padDateComponent(opts.now.getHours())),
  [SPECIAL_DIRS.MINUTE]:
    opts => Path.PathSegment.String(Variable.padDateComponent(opts.now.getMinutes())),
  [SPECIAL_DIRS.SECOND]:
    opts => Path.PathSegment.String(Variable.padDateComponent(opts.now.getSeconds())),
  [SPECIAL_DIRS.PAGE_TITLE]:
    opts => Path.PathSegment.String((opts.currentTab && opts.currentTab.title) || ""),
  [SPECIAL_DIRS.LINK_TEXT]:
    opts => Path.PathSegment.String(opts.linkText),
  [SPECIAL_DIRS.SELECTION_TEXT]:
    opts => Path.PathSegment.String((opts.selectionText && opts.selectionText.trim()) || ""),
  [SPECIAL_DIRS.NAIVE_FILENAME]:
    opts => {
      // @ts-ignore
      const naiveFilename = Download.getFilenameFromUrl(opts.url);
      return Path.PathSegment.String(naiveFilename);
    },
  [SPECIAL_DIRS.NAIVE_FILE_EXTENSION]:
    opts => {
      // @ts-ignore
      const naiveFilename = Download.getFilenameFromUrl(opts.url);
      return Path.PathSegment.String(Variable.getFileExtension(naiveFilename));
    }
};

if (typeof module !== "undefined") {
  module.exports = Variable;
}
