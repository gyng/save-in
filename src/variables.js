// @ts-check

const Variables = {
  // TODO: Move into utils
  withUrl: (str, cb) => {
    try {
      return cb(new URL(str));
    } catch (e) {
      return str;
    }
  },

  padDateComponent: num => num.toString().padStart(2, "0"),

  toDateString: d =>
    [
      d.getFullYear(),
      Variables.padDateComponent(d.getMonth() + 1),
      Variables.padDateComponent(d.getDate())
    ].join("-"),

  toISODateString: d =>
    [
      d.getUTCFullYear(),
      Variables.padDateComponent(d.getUTCMonth() + 1),
      Variables.padDateComponent(d.getUTCDate()),
      "T",
      Variables.padDateComponent(d.getUTCHours()),
      Variables.padDateComponent(d.getUTCMinutes()),
      Variables.padDateComponent(d.getUTCSeconds()),
      "Z"
    ].join(""),

  getFileExtension: filename => {
    const fileExtensionMatches = filename.match(Downloads.EXTENSION_REGEX);
    return (fileExtensionMatches && fileExtensionMatches[1]) || "";
  },

  /* prettier-ignore */
  transformers: {
    [SPECIAL_DIRS.FILENAME]:
      opts => Paths.PathSegment.String(opts.filename),
    [SPECIAL_DIRS.FILE_EXTENSION]:
      opts => Paths.PathSegment.String(Variables.getFileExtension(opts.filename)),
    [SPECIAL_DIRS.SOURCE_DOMAIN]:
      opts => Paths.PathSegment.String(Variables.withUrl(opts.url, url => url.hostname)),
    [SPECIAL_DIRS.PAGE_DOMAIN]:
      opts => Paths.PathSegment.String(Variables.withUrl(opts.pageUrl, url => url.hostname)),
    [SPECIAL_DIRS.PAGE_URL]:
      opts => Paths.PathSegment.String(opts.pageUrl),
    [SPECIAL_DIRS.SOURCE_URL]:
      opts => Paths.PathSegment.String(opts.sourceUrl),
    [SPECIAL_DIRS.DATE]:
      opts => Paths.PathSegment.String(Variables.toDateString(opts.now)),
    [SPECIAL_DIRS.ISO8601_DATE]:
      opts => Paths.PathSegment.String(Variables.toISODateString(opts.now)),
    [SPECIAL_DIRS.UNIX_DATE]:
      opts => Paths.PathSegment.String(Date.parse(opts.now) / 1000),
    [SPECIAL_DIRS.YEAR]:
      opts => Paths.PathSegment.String(opts.now.getFullYear()),
    [SPECIAL_DIRS.MONTH]:
      opts => Paths.PathSegment.String(Variables.padDateComponent(opts.now.getMonth() + 1)),
    [SPECIAL_DIRS.DAY]:
      opts => Paths.PathSegment.String(Variables.padDateComponent(opts.now.getDate())),
    [SPECIAL_DIRS.HOUR]:
      opts => Paths.PathSegment.String(Variables.padDateComponent(opts.now.getHours())),
    [SPECIAL_DIRS.MINUTE]:
      opts => Paths.PathSegment.String(Variables.padDateComponent(opts.now.getMinutes())),
    [SPECIAL_DIRS.SECOND]:
      opts => Paths.PathSegment.String(Variables.padDateComponent(opts.now.getSeconds())),
    [SPECIAL_DIRS.PAGE_TITLE]:
      opts => Paths.PathSegment.String((opts.currentTab && opts.currentTab.title) || ""),
    [SPECIAL_DIRS.LINK_TEXT]:
      opts => Paths.PathSegment.String(opts.linkText),
    [SPECIAL_DIRS.SELECTION_TEXT]:
      opts => Paths.PathSegment.String((opts.selectionText && opts.selectionText.trim()) || ""),
    [SPECIAL_DIRS.NAIVE_FILENAME]:
      opts => {
        const naiveFilename = Downloads.getFilenameFromUrl(opts.url);
        return Paths.PathSegment.String(naiveFilename);
      },
    [SPECIAL_DIRS.NAIVE_FILE_EXTENSION]:
      opts => {
        const naiveFilename = Downloads.getFilenameFromUrl(opts.url);
        return Paths.PathSegment.String(Variables.getFileExtension(naiveFilename));
      }
  },

  applyVariables: (path, opts = {}) =>
    Object.assign(path, {
      buf:
        path.buf &&
        path.buf.map((t, i, arr) => {
          if (t.type === PATH_SEGMENT_TYPES.VARIABLE) {
            const transformer = Variables.transformers[t];
            if (transformer) {
              // info, token, index, tokens
              return transformer(opts, t, i, arr);
            }
          }

          return t;
        })
    })
};

if (typeof module !== "undefined") {
  module.exports = Variables;
}
