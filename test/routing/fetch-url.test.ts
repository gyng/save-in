import {
  expandFetchUrl,
  isUsableFetchRewrite,
  isUsableFetchTemplate,
} from "../../src/routing/fetch-url.ts";

test("substitutes variables verbatim without path sanitization", async () => {
  const now = new Date(2026, 6, 15, 9, 30, 5);

  await expect(
    expandFetchUrl("https://cdn.example/:pagedomain:/:year:-:month:/file.jpg", {
      pageUrl: "https://gallery.example/view?a=1",
      now,
    }),
  ).resolves.toBe("https://cdn.example/gallery.example/2026-07/file.jpg");
});

test("keeps literal text, query syntax, and capture references untouched", async () => {
  const template = "https://x.example/a?b=c&d=:$1:&e=%20f";

  await expect(expandFetchUrl(template, {})).resolves.toBe(template);
});

test("substitutes values raw even when they contain URL-hostile characters", async () => {
  await expect(
    expandFetchUrl("https://x.example/:pagetitle:", {
      currentTab: { title: "a b/c&d" },
    }),
  ).resolves.toBe("https://x.example/a b/c&d");
});

test("URL-derived variables read the download URL, not the page", async () => {
  await expect(
    expandFetchUrl("https://mirror.example/:sourcedomain:/:naivefilename:", {
      url: "https://files.example/dir/photo.png?sig=1",
      pageUrl: "https://gallery.example/view",
    }),
  ).resolves.toBe("https://mirror.example/files.example/photo.png");
});

test("keeps banned lazy-fetch tokens literal instead of fetching", async () => {
  await expect(
    expandFetchUrl("https://x.example/:sha256:/:mime:/:finalurl:", {
      url: "https://files.example/a",
    }),
  ).resolves.toBe("https://x.example/:sha256:/:mime:/:finalurl:");
});

test("distinguishes overlapping variable names longest-first", async () => {
  // :sha256full: must never be consumed as :sha256: + "full:".
  await expect(
    expandFetchUrl("https://x.example/:sha256full:/:week:", {
      now: new Date(2026, 0, 8),
    }),
  ).resolves.toBe("https://x.example/:sha256full:/02");
});

test("unknown-looking tokens pass through untouched", async () => {
  await expect(expandFetchUrl("https://x.example/:notavariable:/end", {})).resolves.toBe(
    "https://x.example/:notavariable:/end",
  );
});

test("accepts exactly the expansions whose HTTP(S) authority is literally present", () => {
  expect(isUsableFetchRewrite("https://mirror.example/orig.png")).toBe(true);
  // Plain-HTTP mirrors are legitimate rewrite targets; tightening this to
  // HTTPS-only would silently drop their rewrites.
  expect(isUsableFetchRewrite("http://mirror.example/orig.png")).toBe(true);
  // An empty substitution collapsing the authority must fail closed: the
  // WHATWG parser would accept "https:///orig.png" with host "orig.png".
  expect(isUsableFetchRewrite("https:///orig.png")).toBe(false);
  expect(isUsableFetchRewrite("ftp://mirror.example/orig.png")).toBe(false);
  expect(isUsableFetchRewrite("")).toBe(false);
  // Substitution artifacts that break URL parsing fail closed too.
  expect(isUsableFetchRewrite("https://exa mple.com/x")).toBe(false);
});

test("rejects characters the URL parser strips before restructuring", () => {
  // The WHATWG parser removes tab/CR/LF anywhere in the string first, so
  // "https://\t/orig.png" would reparse with host "orig.png" — the same
  // authority collapse as an empty capture, reached through whitespace.
  for (const stripped of ["\t", "\n", "\r"]) {
    expect(isUsableFetchRewrite(`https://${stripped}/orig.png`)).toBe(false);
    expect(isUsableFetchRewrite(`https://mirror.example/${stripped}orig.png`)).toBe(false);
  }
  expect(isUsableFetchRewrite("https://mirror.example/\u0000orig.png")).toBe(false);
  // A space cannot restructure the URL: it fails authority parsing outright
  // and is legitimate, percent-encoded, in a path.
  expect(isUsableFetchRewrite("https://mirror.example/a b.png")).toBe(true);
});

test("rejects a backslash the parser folds into an authority slash", () => {
  // For http(s) the WHATWG parser treats "\\" as "/", so "https://\\/orig.png"
  // reparses with host "orig.png" — the same authority collapse as tab/CR/LF.
  expect(isUsableFetchRewrite("https://\\/orig.png")).toBe(false);
  expect(isUsableFetchRewrite("https:/\\orig.png")).toBe(false);
  expect(isUsableFetchRewrite("https://mirror.example\\@evil.example/x")).toBe(false);
  // A percent-encoded backslash is a normal path character and stays usable.
  expect(isUsableFetchRewrite("https://mirror.example/a%5Cb.png")).toBe(true);
});

test("validates fetch templates with placeholders in structural URL positions", () => {
  expect(isUsableFetchTemplate("https://:$1:/:filename:")).toBe(true);
  expect(isUsableFetchTemplate("https://example.test::$1:/file")).toBe(true);
  expect(isUsableFetchTemplate("https://[2001:db8::1]/file")).toBe(true);
  expect(isUsableFetchTemplate("https:///file")).toBe(false);
  expect(isUsableFetchTemplate("https://example.test:bad/file")).toBe(false);
});
