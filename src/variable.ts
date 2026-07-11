import { Util } from "./util.ts";
import { resolveContent } from "./content-fetch.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "./filename.ts";
import { SPECIAL_DIRS, PATH_SEGMENT_TYPES } from "./constants.ts";
import { Path } from "./path.ts";
import { Counter } from "./background-state.ts";

export const Variable = {
  // Thin wrapper over Util.withUrl that keeps this call site's historical
  // behavior of returning the original string on a parse failure
  withUrl: (str, cb) => Util.withUrl(str, cb, str),

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
    const fileExtensionMatches = filename.match(EXTENSION_REGEX);
    return (fileExtensionMatches && fileExtensionMatches[1]) || "";
  },

  IPV4_REGEX: /^\d{1,3}(\.\d{1,3}){3}$/,

  // English on purpose: locale-dependent names would make the same rule
  // produce different paths on different machines
  WEEKDAY_NAMES: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
  MONTH_NAMES: [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ],

  // ISO-8601 week number (week 1 contains the year's first Thursday),
  // computed from local date parts like :year:/:month:/:day:
  toISOWeek: (d) => {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7) + 3); // nearest Thursday
    const firstThursday = new Date(day.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
    return 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  },

  // "My Webpage: Title!" -> "my-webpage-title" (slug) / "my_webpage_title"
  // (snake); keeps unicode letters/digits so non-latin titles survive
  toDelimited: (str, delimiter) =>
    (str || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, delimiter)
      .replace(new RegExp(`^\\${delimiter}+|\\${delimiter}+$`, "g"), ""),

  // Last hostname label; empty for IPs and single-label hosts (localhost)
  toTld: (hostname) => {
    if (!hostname || Variable.IPV4_REGEX.test(hostname)) {
      return "";
    }

    const labels = hostname.split(".");
    return labels.length >= 2 ? labels[labels.length - 1] : "";
  },

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

  // Common Content-Type -> file extension. The subtype fallback in
  // mimeToExtension covers the long tail, so this only needs the cases where
  // the subtype is not the extension people expect.
  MIME_EXTENSIONS: {
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "image/tiff": "tif",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
    "video/mpeg": "mpg",
    "audio/mpeg": "mp3",
    "audio/x-wav": "wav",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/gzip": "gz",
    "application/javascript": "js",
    "application/xml": "xml",
    "text/plain": "txt",
    "text/html": "html",
    "text/markdown": "md",
    "text/javascript": "js",
  },

  // "image/jpeg" -> "jpg". Falls back to the subtype with vendor/x- prefixes
  // and +suffixes stripped ("application/vnd.foo+json" -> "json") for the tail.
  mimeToExtension: (mime) => {
    if (!mime) {
      return "";
    }
    if (Variable.MIME_EXTENSIONS[mime]) {
      return Variable.MIME_EXTENSIONS[mime];
    }
    const sub = mime.split("/")[1];
    if (!sub) {
      return "";
    }
    return sub
      .replace(/^(x-|vnd\.)/, "")
      .replace(/^.*\+/, "")
      .replace(/[^0-9a-z].*$/i, "");
  },

  // Lazily HEAD the URL once per download (cached as a promise on the info bag,
  // so every :mime:/:mimeext:/:finalurl: occurrence — path and route — shares
  // one request) and read its Content-Type and post-redirect URL. Times out so
  // a slow/hanging HEAD can't block the download, and resolves to blanks on any
  // failure (CORS, 405, network).
  resolveHead: (opts) => {
    if (opts.headPromise) {
      return opts.headPromise;
    }
    opts.headPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(opts.url, {
          method: "HEAD",
          credentials: "include",
          signal: controller.signal,
        });
        return {
          contentType: (res.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase(),
          // res.url is the URL after redirects (fetch follows them by default)
          finalUrl: res.url || "",
        };
      } catch {
        return { contentType: "", finalUrl: "" };
      } finally {
        clearTimeout(timer);
      }
    })();
    return opts.headPromise;
  },

  resolveMime: async (opts) => (await Variable.resolveHead(opts)).contentType,

  // Fetch the file's content once per download (cached on the info bag so every
  // :sha256: shares it — and the download reuses the same fetch rather than
  // pulling the file down a second time, see content-fetch.ts). Resolves
  // to { sha256, downloadUrl } or null on failure/over-cap so a hash can never
  // block a save.
  resolveContent: (opts) => {
    if (opts.contentPromise) {
      return opts.contentPromise;
    }
    opts.contentPromise = opts.url ? resolveContent(opts.url) : Promise.resolve(null);
    return opts.contentPromise;
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
    [SPECIAL_DIRS.WEEKDAY]:
      opts => Path.PathSegment.String(Variable.WEEKDAY_NAMES[opts.now.getDay()]),
    [SPECIAL_DIRS.MONTH_NAME]:
      opts => Path.PathSegment.String(Variable.MONTH_NAMES[opts.now.getMonth()]),
    [SPECIAL_DIRS.AM_PM]:
      opts => Path.PathSegment.String(opts.now.getHours() < 12 ? "am" : "pm"),
    [SPECIAL_DIRS.ISO_WEEK]:
      opts => Path.PathSegment.String(Variable.padDateComponent(Variable.toISOWeek(opts.now))),
    [SPECIAL_DIRS.WEEK]:
      opts => Path.PathSegment.String(Variable.padDateComponent(Variable.toISOWeek(opts.now))),
    [SPECIAL_DIRS.PAGE_TITLE]:
      opts => Path.PathSegment.String((opts.currentTab && opts.currentTab.title) || ""),
    [SPECIAL_DIRS.PAGE_TITLE_SLUG]:
      opts => Path.PathSegment.String(Variable.toDelimited((opts.currentTab && opts.currentTab.title) || "", "-")),
    [SPECIAL_DIRS.PAGE_TITLE_SNAKE]:
      opts => Path.PathSegment.String(Variable.toDelimited((opts.currentTab && opts.currentTab.title) || "", "_")),
    [SPECIAL_DIRS.SOURCE_PATH]:
      opts => Path.PathSegment.String(Variable.withUrl(opts.url, url => url.pathname.replace(/^\//, ""))),
    [SPECIAL_DIRS.TLD]:
      opts => Path.PathSegment.String(Variable.withUrl(opts.url, url => Variable.toTld(url.hostname))),
    [SPECIAL_DIRS.LINK_TEXT]:
      opts => Path.PathSegment.String(opts.linkText),
    [SPECIAL_DIRS.SELECTION_TEXT]:
      opts => Path.PathSegment.String((opts.selectionText && opts.selectionText.trim()) || ""),
    [SPECIAL_DIRS.NAIVE_FILENAME]:
      opts => {
        const naiveFilename = getFilenameFromUrl(opts.url);
        return Path.PathSegment.String(naiveFilename);
      },
    [SPECIAL_DIRS.NAIVE_FILE_EXTENSION]:
      opts => {
        const naiveFilename = getFilenameFromUrl(opts.url);
        return Path.PathSegment.String(Variable.getFileExtension(naiveFilename));
      },
    // Async: an atomic, persistent counter (needs storage). Cached on the info
    // bag so every :counter: in one download shares a value and the stored
    // counter advances exactly once; the options-page preview peeks instead.
    [SPECIAL_DIRS.COUNTER]:
      async opts => {
        if (opts.preview) {
          return Path.PathSegment.String((await Counter.peek()) + 1);
        }
        if (opts.counter == null) {
          opts.counter = await Counter.next();
        }
        return Path.PathSegment.String(opts.counter);
      },
    // A fresh random v4 UUID (crypto.randomUUID is available in the SW, the
    // event page, and Node/vitest — all secure contexts)
    [SPECIAL_DIRS.UUID]:
      () => Path.PathSegment.String(crypto.randomUUID()),
    // Async: the server's Content-Type from a HEAD request (see resolveMime).
    // The options-page preview skips the network and shows nothing.
    [SPECIAL_DIRS.MIME]:
      async opts => Path.PathSegment.String(opts.preview ? "" : await Variable.resolveMime(opts)),
    [SPECIAL_DIRS.CONTENT_TYPE]:
      async opts => Path.PathSegment.String(opts.preview ? "" : await Variable.resolveMime(opts)),
    // The extension derived from that Content-Type ("image/jpeg" -> "jpg") —
    // useful for naming extensionless CDN/query-suffix URLs (#126/#135/#43)
    [SPECIAL_DIRS.MIME_EXT]:
      async opts =>
        Path.PathSegment.String(
          opts.preview ? "" : Variable.mimeToExtension(await Variable.resolveMime(opts)),
        ),
    // Async: SHA-256 of the file's content (fetches the bytes once — see
    // resolveContent). Useful for content-addressed / dedup names. Blank in preview.
    [SPECIAL_DIRS.SHA256]:
      async opts => {
        if (opts.preview) {
          return Path.PathSegment.String("");
        }
        const content = await Variable.resolveContent(opts);
        return Path.PathSegment.String(content ? content.sha256 : "");
      },
    // Async: the URL after following redirects, from the same HEAD as :mime:.
    [SPECIAL_DIRS.FINAL_URL]:
      async opts => Path.PathSegment.String(opts.preview ? "" : (await Variable.resolveHead(opts)).finalUrl),
    [SPECIAL_DIRS.REDIRECT_URL]:
      async opts => Path.PathSegment.String(opts.preview ? "" : (await Variable.resolveHead(opts)).finalUrl)
  }),

  // Async so a transformer may await (e.g. a :counter: read-modify-write or a
  // :mime: HEAD request). Sync transformers resolve instantly through
  // Promise.all, so paths built only from today's variables are byte-identical.
  applyVariables: async (path, opts = {}) =>
    Object.assign(path, {
      buf:
        path.buf &&
        (await Promise.all(
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
        )),
    }),
};
