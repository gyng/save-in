// @ts-check

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

  getFileExtension: (filename) => {
    const fileExtensionMatches = filename.match(Download.EXTENSION_REGEX);
    return (fileExtensionMatches && fileExtensionMatches[1]) || "";
  },

  IPV4_REGEX: /^\d{1,3}(\.\d{1,3}){3}$/,

  // Strips a hostname down to its registrable domain using a simple
  // last-two-labels heuristic (no public suffix list): "sub.cdn.example.com"
  // -> "example.com". This mishandles multi-part public suffixes (e.g.
  // "example.co.uk" -> "co.uk" instead of "example.co.uk"). IPv4 addresses
  // and single-label hosts (e.g. "localhost") are left unchanged since they
  // have no subdomain to strip.
  toRootDomain: (hostname) => {
    if (!hostname || Variable.IPV4_REGEX.test(hostname)) {
      return hostname;
    }

    const labels = hostname.split(".");
    return labels.length <= 2 ? hostname : labels.slice(-2).join(".");
  },

  // Transformers are called as (info, token, index, tokens); most only
  // need the info bag, hence the cast to the full signature
  /* prettier-ignore */
  transformers: /** @type {Record<string, (opts: StateInfo, token?: any, index?: number, tokens?: any[]) => any>} */ ({
    [SPECIAL_DIRS.FILENAME]:
      opts => Path.PathSegment.String(opts.filename),
    [SPECIAL_DIRS.FILE_EXTENSION]:
      opts => Path.PathSegment.String(Variable.getFileExtension(opts.filename)),
    [SPECIAL_DIRS.SOURCE_DOMAIN]:
      opts => Path.PathSegment.String(Variable.withUrl(opts.url, url => url.hostname)),
    [SPECIAL_DIRS.PAGE_DOMAIN]:
      opts => Path.PathSegment.String(Variable.withUrl(opts.pageUrl, url => url.hostname)),
    [SPECIAL_DIRS.SOURCE_ROOT_DOMAIN]:
      opts => Path.PathSegment.String(Variable.withUrl(opts.url, url => Variable.toRootDomain(url.hostname))),
    [SPECIAL_DIRS.PAGE_ROOT_DOMAIN]:
      opts => Path.PathSegment.String(Variable.withUrl(opts.pageUrl, url => Variable.toRootDomain(url.hostname))),
    [SPECIAL_DIRS.PAGE_URL]:
      opts => Path.PathSegment.String(opts.pageUrl),
    [SPECIAL_DIRS.SOURCE_URL]:
      opts => Path.PathSegment.String(opts.sourceUrl),
    [SPECIAL_DIRS.DATE]:
      opts => Path.PathSegment.String(Variable.toDateString(opts.now)),
    [SPECIAL_DIRS.ISO8601_DATE]:
      opts => Path.PathSegment.String(Variable.toISODateString(opts.now)),
    [SPECIAL_DIRS.UNIX_DATE]:
      opts => Path.PathSegment.String(Math.floor(opts.now.getTime() / 1000)),
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
        const naiveFilename = Download.getFilenameFromUrl(opts.url);
        return Path.PathSegment.String(naiveFilename);
      },
    [SPECIAL_DIRS.NAIVE_FILE_EXTENSION]:
      opts => {
        const naiveFilename = Download.getFilenameFromUrl(opts.url);
        return Path.PathSegment.String(Variable.getFileExtension(naiveFilename));
      }
  }),

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
