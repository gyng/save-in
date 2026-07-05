// @ts-check

const segStr = (v) => Path.PathSegment.String(v);

const Variable = {
  // TODO: Move into utils
  withUrl: (str, cb) => {
    try {
      return cb(new URL(str));
    } catch (e) {
      return str;
    }
  },

  padDateComponent: (num) => num.toString().padStart(2, "0"),

  toDateString: (d) =>
    [
      d.getFullYear(),
      Variable.padDateComponent(d.getMonth() + 1),
      Variable.padDateComponent(d.getDate()),
    ].join("-"),

  toISODateString: (d) =>
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

  getFileExtension: (filename) =>
    filename.match(Download.EXTENSION_REGEX)?.[1] ?? "",

  /* prettier-ignore */
  transformers: {
    [SPECIAL_DIRS.FILENAME]:              opts => segStr(opts.filename),
    [SPECIAL_DIRS.FILE_EXTENSION]:        opts => segStr(Variable.getFileExtension(opts.filename)),
    [SPECIAL_DIRS.SOURCE_DOMAIN]:         opts => segStr(Variable.withUrl(opts.url, url => url.hostname)),
    [SPECIAL_DIRS.PAGE_DOMAIN]:           opts => segStr(Variable.withUrl(opts.pageUrl, url => url.hostname)),
    [SPECIAL_DIRS.PAGE_URL]:              opts => segStr(opts.pageUrl),
    [SPECIAL_DIRS.SOURCE_URL]:            opts => segStr(opts.sourceUrl),
    [SPECIAL_DIRS.DATE]:                  opts => segStr(Variable.toDateString(opts.now)),
    [SPECIAL_DIRS.ISO8601_DATE]:          opts => segStr(Variable.toISODateString(opts.now)),
    [SPECIAL_DIRS.UNIX_DATE]:             opts => segStr(Date.parse(opts.now) / 1000),
    [SPECIAL_DIRS.YEAR]:                  opts => segStr(opts.now.getFullYear()),
    [SPECIAL_DIRS.MONTH]:                 opts => segStr(Variable.padDateComponent(opts.now.getMonth() + 1)),
    [SPECIAL_DIRS.DAY]:                   opts => segStr(Variable.padDateComponent(opts.now.getDate())),
    [SPECIAL_DIRS.HOUR]:                  opts => segStr(Variable.padDateComponent(opts.now.getHours())),
    [SPECIAL_DIRS.MINUTE]:                opts => segStr(Variable.padDateComponent(opts.now.getMinutes())),
    [SPECIAL_DIRS.SECOND]:                opts => segStr(Variable.padDateComponent(opts.now.getSeconds())),
    [SPECIAL_DIRS.PAGE_TITLE]:            opts => segStr(opts.currentTab?.title ?? ""),
    [SPECIAL_DIRS.LINK_TEXT]:             opts => segStr(opts.linkText),
    [SPECIAL_DIRS.SELECTION_TEXT]:        opts => segStr(opts.selectionText?.trim() ?? ""),
    [SPECIAL_DIRS.NAIVE_FILENAME]:        opts => segStr(Download.getFilenameFromUrl(opts.url)),
    [SPECIAL_DIRS.NAIVE_FILE_EXTENSION]:  opts => segStr(Variable.getFileExtension(Download.getFilenameFromUrl(opts.url)))
  },

  applyVariables: (path, opts = {}) =>
    Object.assign(path, {
      buf:
        path.buf &&
        path.buf.map((t, i, arr) => {
          if (t.type === PATH_SEGMENT_TYPES.VARIABLE) {
            const transformer = Variable.transformers[t];
            if (transformer) {
              // info, token, index, tokens
              return transformer(opts, t, i, arr);
            }
          }

          return t;
        }),
    }),
};

if (typeof module !== "undefined") {
  module.exports = Variable;
}
