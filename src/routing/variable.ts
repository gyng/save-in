import { withUrl as parseUrl } from "../shared/util.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "./filename.ts";
import { SPECIAL_DIRS, PATH_SEGMENT_TYPES } from "../shared/constants.ts";
import { stringSegment, type PathSegment } from "./path.ts";
import type { RoutingDownloadInfo } from "./rule-types.ts";
import { routingPorts } from "./ports.ts";
import { getExtensionFetchCredentials } from "../config/fetch-credentials.ts";
import { fetchFollowingRedirects } from "../shared/redirect-fetch.ts";
import type { HeadMetadata } from "../shared/lazy-download-metadata.ts";
import { toRootDomain } from "../shared/domain.ts";

export { toRootDomain } from "../shared/domain.ts";

type HeadResult = HeadMetadata;
type VariablePath = { buf?: PathSegment[] | null };
type Transformer = (
  opts: RoutingDownloadInfo,
  token?: PathSegment,
  index?: number,
  tokens?: PathSegment[],
) => PathSegment | Promise<PathSegment>;

export const normalizeMimeType = (value: string | null | undefined): string =>
  ((value || "").split(";")[0] || "").trim().toLocaleLowerCase();

const metadataFromResponse = async (res: Response): Promise<HeadResult> => {
  try {
    const contentDisposition = res.headers.get("Content-Disposition") || "";
    return {
      contentType: normalizeMimeType(res.headers.get("Content-Type")),
      finalUrl: res.url || "",
      ...(contentDisposition ? { contentDisposition } : {}),
    };
  } finally {
    if (res.body) await res.body.cancel().catch(() => {});
  }
};

const fetchHeadMetadata = async (
  url: string,
  privateContext = false,
  protectedReferer?: string,
): Promise<HeadResult> => {
  const credentials = getExtensionFetchCredentials(privateContext);
  const fetchMetadata = async (): Promise<HeadResult> => {
    try {
      const headResponse = await fetchFollowingRedirects(
        url,
        { method: "HEAD", credentials },
        5000,
      );
      if (headResponse.ok !== false) return metadataFromResponse(headResponse);
      if (headResponse.body) await headResponse.body.cancel().catch(() => {});
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") throw error;
    }

    // Some download servers reject HEAD even though GET works. Fetch resolves as
    // soon as the GET headers arrive, and metadataFromResponse deliberately
    // cancels the body instead of retaining it for acquisition: routing may still
    // reject this candidate, so consuming the body here could turn a metadata
    // lookup into a speculative full download of a large file. If routing accepts
    // it, the acquisition stage performs the actual download later.
    return metadataFromResponse(
      await fetchFollowingRedirects(url, { method: "GET", credentials }, 5000),
    );
  };

  return protectedReferer
    ? routingPorts.withRequestReferer(url, protectedReferer, fetchMetadata, ["head", "get"])
    : fetchMetadata();
};

// Thin wrapper over withUrl that keeps this call site's historical behavior of
// returning the original string on a parse failure.
export const withUrl = <T>(str: string, cb: (url: URL) => T) => parseUrl(str, cb, str);

export const padDateComponent = (num: number) => num.toString().padStart(2, "0");

export const toDateString = (d: Date) =>
  [d.getFullYear(), padDateComponent(d.getMonth() + 1), padDateComponent(d.getDate())].join("-");

export const toISODateString = (d: Date) =>
  [
    d.getUTCFullYear(),
    padDateComponent(d.getUTCMonth() + 1),
    padDateComponent(d.getUTCDate()),
    "T",
    padDateComponent(d.getUTCHours()),
    padDateComponent(d.getUTCMinutes()),
    padDateComponent(d.getUTCSeconds()),
    "Z",
  ].join("");

export const getFileExtension = (filename: string) => {
  const fileExtensionMatches = filename.match(EXTENSION_REGEX);
  return (fileExtensionMatches && fileExtensionMatches[1]) || "";
};

export const IPV4_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/;

// English on purpose: locale-dependent names would make the same rule
// produce different paths on different machines
export const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
export const MONTH_NAMES = [
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
];

// ISO-8601 week number (week 1 contains the year's first Thursday),
// computed from local date parts like :year:/:month:/:day:
export const toISOWeek = (d: Date) => {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7) + 3); // nearest Thursday
  const firstThursday = new Date(day.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  return 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
};

// "My Webpage: Title!" -> "my-webpage-title" (slug) / "my_webpage_title"
// (snake); keeps unicode letters/digits so non-latin titles survive
export const toDelimited = (str: string | null | undefined, delimiter: string) =>
  (str || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, delimiter)
    .replace(new RegExp(`^\\${delimiter}+|\\${delimiter}+$`, "g"), "");

// Last hostname label; empty for IPs and single-label hosts (localhost)
export const toTld = (hostname: string | null | undefined) => {
  if (!hostname || IPV4_REGEX.test(hostname)) {
    return "";
  }

  const labels = hostname.split(".");
  return labels.length >= 2 ? labels[labels.length - 1] : "";
};

// Common Content-Type -> file extension. The subtype fallback in
// mimeToExtension covers the long tail, so this only needs the cases where
// the subtype is not the extension people expect.
export const MIME_EXTENSIONS: Record<string, string> = {
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
};

// "image/jpeg" -> "jpg". Falls back to the subtype with vendor/x- prefixes
// and +suffixes stripped ("application/vnd.foo+json" -> "json") for the tail.
export const mimeToExtension = (mime: string | null | undefined) => {
  if (!mime) {
    return "";
  }
  if (MIME_EXTENSIONS[mime]) {
    return MIME_EXTENSIONS[mime];
  }
  const sub = mime.split("/")[1];
  if (!sub) {
    return "";
  }
  return sub
    .replace(/^(x-|vnd\.)/, "")
    .replace(/^.*\+/, "")
    .replace(/[^0-9a-z].*$/i, "");
};

// Lazily HEAD the URL once per download (cached as a promise on the info bag,
// so every :mime:/:mimeext:/:finalurl: occurrence — path and route — shares
// one request) and read its Content-Type and post-redirect URL. Times out so
// a slow/hanging HEAD can't block the download, and resolves to blanks on any
// failure (CORS, 405, network).
export const resolveHead = (opts: RoutingDownloadInfo): Promise<HeadResult> => {
  if (opts.contentFetchDisabled) return Promise.resolve({ contentType: "", finalUrl: "" });
  if (opts.resolvedHead) {
    return Promise.resolve(opts.resolvedHead);
  }
  if (opts.headPromise) {
    return opts.headPromise;
  }
  opts.headPromise = (async () => {
    try {
      const result = await fetchHeadMetadata(
        opts.url ?? "",
        opts.currentTab?.incognito === true,
        opts.protectedFetchReferer,
      );
      opts.resolvedHead = result;
      return result;
    } catch {
      return { contentType: "", finalUrl: "" };
    }
  })();
  return opts.headPromise;
};

export const resolveMime = async (opts: RoutingDownloadInfo) =>
  opts.mime ? normalizeMimeType(opts.mime) : (await resolveHead(opts)).contentType;

const resolvedHeadPreview = (opts: RoutingDownloadInfo): HeadResult | null =>
  opts.resolvedHead || null;

// Fetch the file's content once per download (cached on the info bag so every
// :sha256: shares it — and the download reuses the same fetch rather than
// pulling the file down a second time, see content-fetch.ts). Resolves
// to { sha256, downloadUrl } or null on failure. The response is hashed
// incrementally, without a file-size ceiling, and reused for the download.
export const resolveContent = (opts: RoutingDownloadInfo) => {
  if (opts.contentPromise) {
    return opts.contentPromise;
  }
  if (opts.contentFetchDisabled) return Promise.resolve(null);
  const requestId = crypto.randomUUID();
  opts.contentPromise = opts.url
    ? Promise.resolve(opts.onContentFetchStart?.(requestId)).then(() =>
        routingPorts.resolveContent(
          opts.url!,
          opts.currentTab?.incognito === true,
          opts.abortSignal,
          requestId,
          opts.protectedFetchReferer,
        ),
      )
    : Promise.resolve(null);
  return opts.contentPromise;
};

const resolveSha256 = async (opts: RoutingDownloadInfo): Promise<string> => {
  if (opts.preview) return opts.sha256 ?? "";
  const content = await resolveContent(opts);
  opts.sha256 = content ? content.sha256 : "";
  return opts.sha256;
};

// Transformers are called as (info, token, index, tokens); most only
// need the info bag, hence the cast to the full signature
/* prettier-ignore */
export const transformers = ({
    [SPECIAL_DIRS.FILENAME]:
      opts => stringSegment(opts.filename),
    [SPECIAL_DIRS.FILE_EXTENSION]:
      opts => stringSegment(getFileExtension(opts.filename ?? "")),
    [SPECIAL_DIRS.ACTUAL_FILE_EXTENSION]:
      opts => stringSegment(getFileExtension(opts.filename ?? "")),
    [SPECIAL_DIRS.SOURCE_DOMAIN]:
      opts => stringSegment(withUrl(opts.url ?? "", url => url.hostname)),
    [SPECIAL_DIRS.PAGE_DOMAIN]:
      opts => stringSegment(withUrl(opts.pageUrl ?? "", url => url.hostname)),
    [SPECIAL_DIRS.SOURCE_ROOT_DOMAIN]:
      opts => stringSegment(withUrl(opts.url ?? "", url => toRootDomain(url.hostname))),
    [SPECIAL_DIRS.PAGE_ROOT_DOMAIN]:
      opts => stringSegment(withUrl(opts.pageUrl ?? "", url => toRootDomain(url.hostname))),
    [SPECIAL_DIRS.PAGE_URL]:
      opts => stringSegment(opts.pageUrl),
    [SPECIAL_DIRS.SOURCE_URL]:
      opts => stringSegment(opts.sourceUrl),
    [SPECIAL_DIRS.DATE]:
      opts => stringSegment(toDateString(opts.now!)),
    [SPECIAL_DIRS.ISO8601_DATE]:
      opts => stringSegment(toISODateString(opts.now!)),
    [SPECIAL_DIRS.UNIX_DATE]:
      opts => stringSegment(Math.floor(opts.now!.getTime() / 1000)),
    [SPECIAL_DIRS.YEAR]:
      opts => stringSegment(opts.now!.getFullYear()),
    [SPECIAL_DIRS.MONTH]:
      opts => stringSegment(padDateComponent(opts.now!.getMonth() + 1)),
    [SPECIAL_DIRS.DAY]:
      opts => stringSegment(padDateComponent(opts.now!.getDate())),
    [SPECIAL_DIRS.HOUR]:
      opts => stringSegment(padDateComponent(opts.now!.getHours())),
    [SPECIAL_DIRS.MINUTE]:
      opts => stringSegment(padDateComponent(opts.now!.getMinutes())),
    [SPECIAL_DIRS.SECOND]:
      opts => stringSegment(padDateComponent(opts.now!.getSeconds())),
    [SPECIAL_DIRS.WEEKDAY]:
      opts => stringSegment(WEEKDAY_NAMES[opts.now!.getDay()]),
    [SPECIAL_DIRS.MONTH_NAME]:
      opts => stringSegment(MONTH_NAMES[opts.now!.getMonth()]),
    [SPECIAL_DIRS.AM_PM]:
      opts => stringSegment(opts.now!.getHours() < 12 ? "am" : "pm"),
    [SPECIAL_DIRS.ISO_WEEK]:
      opts => stringSegment(padDateComponent(toISOWeek(opts.now!))),
    [SPECIAL_DIRS.WEEK]:
      opts => stringSegment(padDateComponent(toISOWeek(opts.now!))),
    [SPECIAL_DIRS.PAGE_TITLE]:
      opts => stringSegment((opts.currentTab && opts.currentTab.title) || ""),
    [SPECIAL_DIRS.PAGE_TITLE_SLUG]:
      opts => stringSegment(toDelimited((opts.currentTab && opts.currentTab.title) || "", "-")),
    [SPECIAL_DIRS.PAGE_TITLE_SNAKE]:
      opts => stringSegment(toDelimited((opts.currentTab && opts.currentTab.title) || "", "_")),
    [SPECIAL_DIRS.SOURCE_PATH]:
      opts => stringSegment(withUrl(opts.url ?? "", url => url.pathname.replace(/^\//, ""))),
    [SPECIAL_DIRS.TLD]:
      opts => stringSegment(withUrl(opts.url ?? "", url => toTld(url.hostname))),
    [SPECIAL_DIRS.LINK_TEXT]:
      opts => stringSegment(opts.linkText),
    [SPECIAL_DIRS.SELECTION_TEXT]:
      opts => stringSegment((opts.selectionText && opts.selectionText.trim()) || ""),
    [SPECIAL_DIRS.NAIVE_FILENAME]:
      opts => {
        const naiveFilename = getFilenameFromUrl(opts.url ?? "");
        return stringSegment(naiveFilename);
      },
    [SPECIAL_DIRS.NAIVE_FILE_EXTENSION]:
      opts => {
        const naiveFilename = getFilenameFromUrl(opts.url ?? "");
        return stringSegment(getFileExtension(naiveFilename));
      },
    [SPECIAL_DIRS.URL_FILE_EXTENSION]:
      opts => {
        const naiveFilename = getFilenameFromUrl(opts.url ?? "");
        return stringSegment(getFileExtension(naiveFilename));
      },
    // Async: an atomic, persistent counter (needs storage). Cached on the info
    // bag so every :counter: in one download shares a value and the stored
    // counter advances exactly once; the options-page preview peeks instead.
    [SPECIAL_DIRS.COUNTER]:
      async opts => {
        if (opts.preview) {
          return stringSegment((await routingPorts.peekCounter()) + 1);
        }
        if (opts.counter == null) {
          opts.counter = (opts.currentTab as { incognito?: boolean } | null | undefined)?.incognito
            ? await routingPorts.nextPrivateCounter()
            : await routingPorts.nextCounter();
        }
        return stringSegment(opts.counter);
      },
    // A fresh random v4 UUID (crypto.randomUUID is available in the SW, the
    // event page, and Node/vitest — all secure contexts)
    [SPECIAL_DIRS.UUID]:
      () => stringSegment(crypto.randomUUID()),
    // Async: the server's Content-Type from a HEAD request (see resolveMime).
    // The options-page preview skips the network and shows nothing.
    [SPECIAL_DIRS.MIME]:
      async opts => stringSegment(opts.preview ? resolvedHeadPreview(opts)?.contentType : await resolveMime(opts)),
    [SPECIAL_DIRS.CONTENT_TYPE]:
      async opts => stringSegment(opts.preview ? resolvedHeadPreview(opts)?.contentType : await resolveMime(opts)),
    // The extension derived from that Content-Type ("image/jpeg" -> "jpg") —
    // useful for naming extensionless CDN/query-suffix URLs (#126/#135/#43)
    [SPECIAL_DIRS.MIME_EXT]:
      async opts =>
        stringSegment(
          opts.preview ? mimeToExtension(resolvedHeadPreview(opts)?.contentType) : mimeToExtension(await resolveMime(opts)),
        ),
    // Async: SHA-256 of the file's content (fetches the bytes once — see
    // resolveContent). The short form is convenient for filenames; the full
    // form is available when the complete digest is required. Blank in preview.
    [SPECIAL_DIRS.SHA256]:
      async opts => stringSegment((await resolveSha256(opts)).slice(0, 12)),
    [SPECIAL_DIRS.SHA256_FULL]:
      async opts => stringSegment(await resolveSha256(opts)),
    // Async: the URL after following redirects, from the same HEAD as :mime:.
    [SPECIAL_DIRS.FINAL_URL]:
      async opts => stringSegment(opts.preview ? resolvedHeadPreview(opts)?.finalUrl : (await resolveHead(opts)).finalUrl),
    [SPECIAL_DIRS.REDIRECT_URL]:
      async opts => stringSegment(opts.preview ? resolvedHeadPreview(opts)?.finalUrl : (await resolveHead(opts)).finalUrl)
  }) as Record<string, Transformer>;

// Async so a transformer may await (e.g. a :counter: read-modify-write or a
// :mime: HEAD request). Sync transformers resolve instantly through
// Promise.all, so paths built only from today's variables are byte-identical.
export const applyVariables = async <P extends object>(path: P, opts: RoutingDownloadInfo = {}) => {
  const variablePath = path as P & VariablePath;
  return Object.assign(path, {
    buf:
      variablePath.buf &&
      (await Promise.all(
        variablePath.buf.map((t, i, arr) => {
          if (t.type === PATH_SEGMENT_TYPES.VARIABLE) {
            const transformer = transformers[t.val];
            if (transformer) {
              // info, token, index, tokens
              return transformer(opts, t, i, arr);
            }
          }

          return t;
        }),
      )),
  });
};
