import {
  canonicalFetchRewrite,
  expandFetchUrl,
  isUsableFetchRewrite,
  isUsableFetchTemplate,
  retargetDownloadInfo,
  substituteFetchCaptures,
} from "../../src/routing/fetch-url.ts";

test("retargets resource metadata without mutating or dropping the save context", () => {
  const context = {
    sourceUrl: "https://cdn.example/preview.png",
    pageUrl: "https://gallery.example/view",
    currentTab: { id: 42, incognito: true },
    suggestedFilename: "chosen.png",
    preview: true,
    counter: 3,
    abortSignal: new AbortController().signal,
  };
  const metadata = {
    resolvedHead: { contentType: "image/png", finalUrl: context.sourceUrl },
    headPromise: Promise.resolve({ contentType: "image/png", finalUrl: context.sourceUrl }),
    contentPromise: Promise.resolve(null),
    loadContent: () => Promise.resolve({ sha256: "", downloadUrl: "blob:old" }),
    sha256: "old-hash",
    mime: "image/png",
    mimeExtension: "png",
    resolvedFilename: "old-name.png",
    protectedFetchReferer: context.pageUrl,
    contentFetchDisabled: true,
  };
  const original = Object.freeze({ ...context, ...metadata, url: context.sourceUrl });

  const retargeted = retargetDownloadInfo(original, "https://mirror.example/original.bin");

  expect(retargeted).toEqual({
    ...context,
    url: "https://mirror.example/original.bin",
    naiveFilename: "original.bin",
    filename: "chosen.png",
    initialFilename: "chosen.png",
  });
  expect(original).toEqual({ ...context, ...metadata, url: context.sourceUrl });
});

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

// A fetch: template pins the host. A capture or variable written inside the
// template's authority may supply host characters and nothing that ends or
// restructures the authority; a loose capture of "evil.example/" must not send
// the request to a host the page chose.
describe("values placed in a fetch template's authority", () => {
  const hostTemplates = [
    "https://:$1:.cdn.example/full/x",
    "https://cdn.example:$1:",
    "https://cdn.example:$1:/full/x",
    "https://:$1:/full/x",
    "HTTP://:$1:.cdn.example",
    "https://user@:$1:.cdn.example/x",
    "https://:$1:@cdn.example/x",
    "https://cdn.example::$1:/x",
  ];
  const hostile = [
    ["a path separator", "evil.example/"],
    ["a query", "evil.example?"],
    ["a fragment", "evil.example#"],
    ["userinfo", "evil.example@"],
    ["userinfo before the host", "user:pass@evil.example"],
    ["a backslash", "evil.example\\"],
    ["a percent-encoded slash", "evil.example%2F"],
    ["a percent-encoded at sign", "evil.example%40"],
    ["a fullwidth solidus", "evil.example\uFF0F"],
    ["a fullwidth question mark", "evil.example\uFF1F"],
    ["a fullwidth number sign", "evil.example\uFF03"],
    ["a fullwidth commercial at", "evil.example\uFF20"],
    ["an ideographic full stop", "evil\u3002example"],
    ["a fullwidth full stop", "evil\uFF0Eexample"],
    ["a halfwidth ideographic full stop", "evil\uFF61example"],
    ["a non-ASCII letter", "\u0435vil.example"],
    ["a space", "evil.example /"],
    ["a tab", "evil.example\t"],
    ["a line break", "evil.example\n"],
    ["a variable's spelling", ":pagetext:"],
    ["a bracketed address", "[::1]"],
    ["a port with trailing text", "evil.example:80/"],
    ["a port that is not a number", "evil.example:8o"],
    ["a port that is too long", "evil.example:123456"],
    ["two ports", "evil.example:80:80"],
    ["an underscore", "evil_example"],
  ] as const;

  test.each(hostile)("refuses a capture holding %s", (_label, value) => {
    for (const template of hostTemplates) {
      const substituted = substituteFetchCaptures(template, ["whole", value]);

      expect(substituted).not.toContain("evil");
      expect(canonicalFetchRewrite(substituted)).toBeNull();
    }
  });

  test.each(hostile)("refuses a variable holding %s", async (_label, value) => {
    for (const template of hostTemplates) {
      const expanded = await expandFetchUrl(template.replace(":$1:", ":pagetitle:"), {
        currentTab: { title: value },
      });

      expect(expanded).not.toContain("evil");
      expect(canonicalFetchRewrite(expanded)).toBeNull();
    }
  });

  test.each([
    ["letters, digits, dots and hyphens", "img-7.EU", "https://img-7.eu.cdn.example/full/x"],
    ["a single label", "static", "https://static.cdn.example/full/x"],
    // The remaining literal host is still the template's own.
    ["nothing", "", "https://.cdn.example/full/x"],
  ])("accepts a host value of %s", async (_label, value, expected) => {
    const template = "https://:$1:.cdn.example/full/x";

    const substituted = substituteFetchCaptures(template, ["whole", value]);
    expect(canonicalFetchRewrite(substituted)).toBe(expected);
    expect(
      canonicalFetchRewrite(
        await expandFetchUrl(template.replace(":$1:", ":pagetitle:"), {
          currentTab: { title: value },
        }),
      ),
    ).toBe(expected);
  });

  test("a capture that is the whole host may carry its port", () => {
    // A capture such as ([^/]+) taken from an address on a non-default port.
    const template = "https://:$1:/full/:$2:";

    expect(substituteFetchCaptures(template, ["whole", "nas.local:5001", "a/b.jpg"])).toBe(
      "https://nas.local:5001/full/a/b.jpg",
    );
    expect(substituteFetchCaptures(template, ["whole", "192.168.1.5:80", "x"])).toBe(
      "https://192.168.1.5:80/full/x",
    );
    // Anywhere but the end of the authority, the port leaves no usable address.
    expect(
      canonicalFetchRewrite(
        substituteFetchCaptures("https://:$1:.cdn.example/x", ["whole", "evil.example:80"]),
      ),
    ).toBeNull();
  });

  test("a capture in a port position must be a port", () => {
    const template = "https://cdn.example::$1:/x";

    expect(canonicalFetchRewrite(substituteFetchCaptures(template, ["whole", "8443"]))).toBe(
      "https://cdn.example:8443/x",
    );
    expect(canonicalFetchRewrite(substituteFetchCaptures(template, ["whole", ""]))).toBe(
      "https://cdn.example/x",
    );
    for (const value of ["80.evil.example", "evil", "80@evil.example", "80/"]) {
      expect(canonicalFetchRewrite(substituteFetchCaptures(template, ["whole", value]))).toBeNull();
    }
  });

  test("an empty value that leaves no host is unusable, as before", () => {
    expect(
      canonicalFetchRewrite(substituteFetchCaptures("https://:$1:/full/x", ["whole", ""])),
    ).toBeNull();
    expect(
      canonicalFetchRewrite(substituteFetchCaptures("https://:$1:/full/x", ["whole", undefined])),
    ).toBeNull();
  });

  test("values in the path, query, and fragment are substituted verbatim, as before", async () => {
    const template = "https://cdn.example/:$1:?q=:$2:#:$3:";
    const values = ["whole", "a/b c@d", "x?y=/\uFF0F", "evil.example/#%2F"];

    expect(substituteFetchCaptures(template, values)).toBe(
      "https://cdn.example/a/b c@d?q=x?y=/\uFF0F#evil.example/#%2F",
    );
    await expect(
      expandFetchUrl("https://cdn.example/:pagetitle:?t=:pagetitle:", {
        currentTab: { title: "a b/c&d@e" },
      }),
    ).resolves.toBe("https://cdn.example/a b/c&d@e?t=a b/c&d@e");
  });

  test("a template with no captures to substitute is returned as written", () => {
    expect(substituteFetchCaptures("https://:$1:.cdn.example/x", null)).toBe(
      "https://:$1:.cdn.example/x",
    );
  });

  test("a template that does not begin with its scheme has no safe position", async () => {
    // The parser rejects such a template; a stored one must still fail closed.
    expect(
      canonicalFetchRewrite(substituteFetchCaptures(":$1:", ["whole", "https://evil.example/x"])),
    ).toBeNull();
    expect(
      canonicalFetchRewrite(
        await expandFetchUrl(":pagetitle:", { currentTab: { title: "https://evil.example/x" } }),
      ),
    ).toBeNull();
  });

  test("a variable after a checked capture is still inside the authority", async () => {
    const substituted = substituteFetchCaptures("https://:$1:.:pagetitle:.cdn.example/x", [
      "whole",
      "img",
    ]);

    expect(
      canonicalFetchRewrite(
        await expandFetchUrl(substituted, { currentTab: { title: "evil.example/" } }),
      ),
    ).toBeNull();
    await expect(expandFetchUrl(substituted, { currentTab: { title: "eu" } })).resolves.toBe(
      "https://img.eu.cdn.example/x",
    );
  });
});
