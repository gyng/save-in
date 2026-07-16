import * as Variable from "../../src/routing/variable.ts";
import * as Path from "../../src/routing/path.ts";
import { resolveContent } from "../../src/downloads/content-fetch.ts";
import * as Counter from "../../src/background/counter.ts";
import { counterWriteState } from "../../src/background/application-state.ts";
// variable.ts reads options.replacementChar (via path.ts) at call time;
// import the real options bag and mutate it (option.ts seeds
// replacementChar "_" at load, so these just document the expectation).
import { options } from "../../src/config/options-data.ts";
import { configureRoutingPorts, type RoutingPorts } from "../../src/routing/ports.ts";

describe("variables", () => {
  const info = {
    url: "http://www.source.com/foobar/file.jpg",
    pageUrl: "http://www.example.com/foobar/",
    sourceUrl: "http://srcurl.com",
    linkText: "linkfoobar",
    selectionText: "selectionfoobar",
    currentTab: { title: "foobartitle" },
    filename: "lol.jpeg",
    now: new Date(),
  };

  beforeAll(() => {
    options.replacementChar = "_";
    configureRoutingPorts({
      nextCounter: () => Counter.nextCounter(counterWriteState, browser.storage.local),
      peekCounter: () => Counter.peekCounter(browser.storage.local),
      resolveContent,
    });
  });

  describe("standard variables", () => {
    test("interpolates :date:", async () => {
      const input = new Path.Path(":date:/a/b");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(String(info.now.getFullYear())));
      expect(output.split("-")).toHaveLength(3);
    });

    test("interpolates :unixdate:", async () => {
      const timestamp = Math.floor(info.now.getTime() / 1000);
      const input = new Path.Path(":unixdate:/a/b");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe(`${timestamp}/a/b`);
    });

    test("interpolates :isodate:", async () => {
      const now = new Date();
      const input = new Path.Path(":isodate:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(String(now.getUTCFullYear())));
    });

    test("interpolates :pagedomain:", async () => {
      const input = new Path.Path("a/b/:pagedomain:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/www.example.com");
    });

    test("interpolates :sourcedomain:", async () => {
      const input = new Path.Path("a/b/:sourcedomain:/c");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/www.source.com/c");
    });

    test("interpolates multiple :sourcedomain:s", async () => {
      const input = new Path.Path("a/b/:sourcedomain::sourcedomain:/c");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/www.source.comwww.source.com/c");
    });

    test("interpolates multiple :sourceurl:", async () => {
      const input = new Path.Path("a/b/:sourceurl::sourceurl:/c");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/http___srcurl.comhttp___srcurl.com/c");
    });

    test("interpolates :pageurl:", async () => {
      const input = new Path.Path("a/b/:pageurl:/c");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/http___www.example.com_foobar_/c");
    });

    test("interpolates :year:", async () => {
      const now = new Date();
      const input = new Path.Path(":year:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(String(now.getFullYear())));
    });

    test("interpolates :month:", async () => {
      const now = new Date();
      const input = new Path.Path(":month:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(String(now.getMonth() + 1)));
    });

    test("interpolates :day:", async () => {
      const now = new Date();
      const input = new Path.Path(":day:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(String(now.getDay())));
    });

    test("interpolates :hour:", async () => {
      const now = new Date();
      const input = new Path.Path(":hour:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(String(now.getDay())));
    });

    test("interpolates :minute:", async () => {
      const now = new Date();
      const input = new Path.Path(":minute");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(String(now.getMinutes())));
    });

    test("interpolates :selectiontext:", async () => {
      const input = new Path.Path(":selectiontext:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("selectionfoobar");
    });

    test("interpolates the chosen menu directory with :menupath:", async () => {
      const input = new Path.Path("archive/:menupath:/:filename:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          menuItemPath: "Images/Favorites",
        })
      ).finalize();
      expect(output).toBe("archive/Images_Favorites/lol.jpeg");
    });

    test("interpolates :filename:", async () => {
      const input = new Path.Path(":filename::filename:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("lol.jpeglol.jpeg");
    });

    test("supports explicit URL and actual extension aliases", async () => {
      expect(
        (
          await Variable.applyVariables(new Path.Path(":urlfileext:/:actualfileext:"), {
            ...info,
            url: "https://x/source.jpg",
            filename: "server.png",
          })
        ).finalize(),
      ).toBe("jpg/png");
    });

    test("interpolates :fileext:", async () => {
      const input = new Path.Path(":fileext:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("jpeg");
    });

    test("interpolates :linktext:", async () => {
      const input = new Path.Path(":linktext:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("linkfoobar");
    });

    test("interpolates :pagetitle:", async () => {
      const input = new Path.Path(":pagetitle:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("foobartitle");
    });

    test("sanitizes invisible controls from :pagetitle: without losing the clicked tab (#220)", async () => {
      const input = new Path.Path("pages/:pagetitle:/:filename:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          currentTab: {
            title:
              "Current\u00ad\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2060\ufeff\ufe0f page",
          },
        })
      ).finalize();

      expect(output).toBe("pages/Current page/lol.jpeg");
    });
  });

  describe("root domain variables (GH #221)", () => {
    test("interpolates :pagerootdomain: stripped to the last two labels", async () => {
      const input = new Path.Path("a/b/:pagerootdomain:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          pageUrl: "http://sub.cdn.example.com/foobar/",
        })
      ).finalize();
      expect(output).toBe("a/b/example.com");
    });

    test("interpolates :sourcerootdomain: stripped to the last two labels", async () => {
      const input = new Path.Path("a/b/:sourcerootdomain:/c");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          url: "http://sub.cdn.example.com/foobar/file.jpg",
        })
      ).finalize();
      expect(output).toBe("a/b/example.com/c");
    });

    test("leaves a bare two-label domain unchanged", async () => {
      const input = new Path.Path(":pagerootdomain:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          pageUrl: "http://example.com/foobar/",
        })
      ).finalize();
      expect(output).toBe("example.com");
    });

    test("leaves a single-label host (e.g. localhost) unchanged", async () => {
      const input = new Path.Path(":pagerootdomain:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          pageUrl: "http://localhost:8080/foobar/",
        })
      ).finalize();
      expect(output).toBe("localhost");
    });

    test("leaves an IPv4 address unchanged", async () => {
      const input = new Path.Path(":sourcerootdomain:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          url: "http://192.168.1.100/foobar/",
        })
      ).finalize();
      expect(output).toBe("192.168.1.100");
    });

    test("falls back to the raw string for an invalid page URL (withUrl catch)", async () => {
      const input = new Path.Path(":pagerootdomain:");
      const output = (
        await Variable.applyVariables(input, { ...info, pageUrl: "not a url" })
      ).finalize();
      expect(output).toBe("not a url");
    });

    test("falls back to the raw string for an invalid source URL (withUrl catch)", async () => {
      const input = new Path.Path(":sourcerootdomain:");
      const output = (
        await Variable.applyVariables(input, { ...info, url: "not a url" })
      ).finalize();
      expect(output).toBe("not a url");
    });
  });

  describe("Variable.toRootDomain", () => {
    test("strips subdomains to the last two labels", async () => {
      expect(Variable.toRootDomain("sub.cdn.example.com")).toBe("example.com");
    });

    test("leaves bare two-label domains unchanged", async () => {
      expect(Variable.toRootDomain("example.com")).toBe("example.com");
    });

    test("keeps the registrable label for common multi-label public suffixes", async () => {
      expect(Variable.toRootDomain("media.example.co.uk")).toBe("example.co.uk");
      expect(Variable.toRootDomain("cdn.example.com.au")).toBe("example.com.au");
      expect(Variable.toRootDomain("assets.example.co.jp")).toBe("example.co.jp");
    });

    test("leaves single-label hosts unchanged", async () => {
      expect(Variable.toRootDomain("localhost")).toBe("localhost");
    });

    test("leaves IPv4 addresses unchanged", async () => {
      expect(Variable.toRootDomain("127.0.0.1")).toBe("127.0.0.1");
      expect(Variable.toRootDomain("192.168.1.100")).toBe("192.168.1.100");
    });

    test("leaves falsy input unchanged", async () => {
      expect(Variable.toRootDomain("")).toBe("");
      expect(Variable.toRootDomain(undefined)).toBeUndefined();
    });
  });

  describe("remaining variables and edge cases", () => {
    test("withUrl returns the input for invalid URLs", async () => {
      expect(Variable.withUrl("not a url", (url) => url.hostname)).toBe("not a url");
    });

    test("interpolates :minute: and :second:", async () => {
      const input = new Path.Path(":minute:/:second:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      const expected = [
        Variable.padDateComponent(info.now.getMinutes()),
        Variable.padDateComponent(info.now.getSeconds()),
      ].join("/");
      expect(output).toBe(expected);
    });

    test("interpolates :pagetitle: as empty without a tab", async () => {
      const input = new Path.Path(":pagetitle:");
      const output = (
        await Variable.applyVariables(input, { ...info, currentTab: undefined })
      ).finalize();
      expect(output).toBe("_");
    });

    test("interpolates :selectiontext: as empty when nothing is selected", async () => {
      const input = new Path.Path(":selectiontext:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          selectionText: undefined,
        })
      ).finalize();
      expect(output).toBe("_");
    });

    test("trims :selectiontext:", async () => {
      const input = new Path.Path(":selectiontext:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          selectionText: "  padded  ",
        })
      ).finalize();
      expect(output).toBe("padded");
    });

    test("interpolates :naivefilename:", async () => {
      const input = new Path.Path(":naivefilename:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("file.jpg");
    });

    test("interpolates :naivefileext:", async () => {
      const input = new Path.Path(":naivefileext:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("jpg");
    });

    test("interpolates :fileext: as empty for extensionless filenames", async () => {
      const input = new Path.Path(":fileext:");
      const output = (
        await Variable.applyVariables(input, { ...info, filename: "noext" })
      ).finalize();
      expect(output).toBe("_");
    });

    test("passes through variable tokens without a transformer", async () => {
      // "---" (the menu separator) parses as a variable but has no transformer
      const input = new Path.Path("---");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("---");
    });

    test("leaves paths without a parsed buffer alone", async () => {
      const result = await Variable.applyVariables({ buf: undefined }, info);
      expect(result.buf).toBeUndefined();
    });

    test("leaves malformed path buffers alone", async () => {
      const input = { buf: "not-a-path-buffer" };

      await expect(Variable.applyVariables(input, info)).resolves.toBe(input);
      expect(input.buf).toBe("not-a-path-buffer");
    });

    test("normalizes missing inputs for URL and filename-derived variables", async () => {
      const input = new Path.Path(
        ":fileext:/:actualfileext:/:sourcedomain:/:pagedomain:/:sourcerootdomain:/:pagerootdomain:/:sourcepath:/:tld:/:naivefilename:/:naivefileext:/:urlfileext:/:pagetitlesnake:/:menupath:",
      );
      await expect(Variable.applyVariables(input, {})).resolves.toBe(input);
      expect(input.finalize()).toBe("_/_/_/_/_/_/_/_/_/_/_/_/_");
    });
  });
});

describe("date-name variables (:weekday:, :monthname:, :ampm:, :isoyear:, :isoweek:)", () => {
  const interpolate = async (variable: string, now: Date) => {
    const input = new Path.Path(variable);
    return (await Variable.applyVariables(input, { now })).finalize();
  };

  test(":weekday: and :monthname: are English names", async () => {
    // 2026-07-10 is a Friday
    const now = new Date(2026, 6, 10, 9, 30, 0);
    expect(await interpolate(":weekday:", now)).toBe("friday");
    expect(await interpolate(":monthname:", now)).toBe("july");
  });

  test(":ampm: follows local hours", async () => {
    expect(await interpolate(":ampm:", new Date(2026, 6, 10, 0, 0, 0))).toBe("am");
    expect(await interpolate(":ampm:", new Date(2026, 6, 10, 11, 59, 0))).toBe("am");
    expect(await interpolate(":ampm:", new Date(2026, 6, 10, 12, 0, 0))).toBe("pm");
    expect(await interpolate(":ampm:", new Date(2026, 6, 10, 23, 0, 0))).toBe("pm");
  });

  test(":isoweek: and :week: are the zero-padded ISO week number", async () => {
    // 2026-01-01 is a Thursday -> ISO week 1
    expect(await interpolate(":isoweek:", new Date(2026, 0, 1))).toBe("01");
    expect(await interpolate(":week:", new Date(2026, 0, 1))).toBe("01");
    // 2021-01-01 is a Friday -> belongs to 2020's ISO week 53
    expect(await interpolate(":isoweek:", new Date(2021, 0, 1))).toBe("53");
    // 2026-07-10 -> ISO week 28
    expect(await interpolate(":isoweek:", new Date(2026, 6, 10))).toBe("28");
    // 2024-12-30 (Monday) -> ISO week 1 of 2025
    expect(await interpolate(":isoweek:", new Date(2024, 11, 30))).toBe("01");
  });

  test(":isoyear: is the year paired with the ISO week number", async () => {
    expect(await interpolate(":isoyear:", new Date(2021, 0, 1))).toBe("2020");
    expect(await interpolate(":isoyear:", new Date(2026, 6, 10))).toBe("2026");
    expect(await interpolate(":isoyear:", new Date(2024, 11, 30))).toBe("2025");
  });
});

describe("page-title slug variables", () => {
  const interpolate = async (variable: string, title: string) => {
    const input = new Path.Path(variable);
    return (
      await Variable.applyVariables(input, {
        now: new Date(),
        currentTab: { title },
      })
    ).finalize();
  };

  test(":pagetitleslug: lowercases and dashes punctuation runs", async () => {
    expect(await interpolate(":pagetitleslug:", "My Webpage: Title!")).toBe("my-webpage-title");
  });

  test(":pagetitlesnake: uses underscores", async () => {
    expect(await interpolate(":pagetitlesnake:", "My Webpage: Title!")).toBe("my_webpage_title");
  });

  test("keeps unicode letters and digits", async () => {
    expect(await interpolate(":pagetitleslug:", "Ünïcode 123 – Tïtle")).toBe("ünïcode-123-tïtle");
  });

  test("missing title becomes the replacement char", async () => {
    const input = new Path.Path(":pagetitleslug:");
    const result = (await Variable.applyVariables(input, { now: new Date() })).finalize();
    expect(result).toBe("_");
  });
});

describe("URL-part variables", () => {
  const interpolate = async (variable: string, url: string) => {
    const input = new Path.Path(variable);
    return (await Variable.applyVariables(input, { now: new Date(), url })).finalize();
  };

  test(":sourcepath: is the pathname without the leading slash", async () => {
    // Separators inside a variable value are sanitized like any segment
    expect(await interpolate(":sourcepath:", "https://x.com/a/b/pic.jpg")).toBe("a_b_pic.jpg");
  });

  test(":tld: is the last hostname label", async () => {
    expect(await interpolate(":tld:", "https://cdn.example.co.uk/pic.jpg")).toBe("uk");
    expect(await interpolate(":tld:", "https://example.com/pic.jpg")).toBe("com");
  });

  test(":tld: is empty (replacement char) for IPs and single-label hosts", async () => {
    expect(await interpolate(":tld:", "http://192.168.0.1/pic.jpg")).toBe("_");
    expect(await interpolate(":tld:", "http://localhost/pic.jpg")).toBe("_");
  });

  test("invalid URLs fall back to the raw value (withUrl contract)", async () => {
    expect(await interpolate(":tld:", "not a url")).toBe("not a url");
  });
});

describe(":counter: (async, persistent)", () => {
  beforeEach(() => {
    vi.spyOn(Counter, "nextCounter").mockResolvedValue(7);
    vi.spyOn(Counter, "peekCounter").mockResolvedValue(41);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("consumes one value and caches it across the whole download", async () => {
    const shared = { now: new Date() };
    const a = (await Variable.applyVariables(new Path.Path("img-:counter:"), shared)).finalize();
    expect(a).toBe("img-7");
    // The same info bag (path then route in one download) reuses the value
    const b = (await Variable.applyVariables(new Path.Path(":counter:/x"), shared)).finalize();
    expect(b).toBe("7/x");
    expect(Counter.nextCounter).toHaveBeenCalledTimes(1);
  });

  test("preview mode peeks the next value without consuming", async () => {
    const out = (
      await Variable.applyVariables(new Path.Path("n-:counter:"), { preview: true })
    ).finalize();
    expect(out).toBe("n-42"); // peek() 41 + 1
    expect(Counter.nextCounter).not.toHaveBeenCalled();
    expect(Counter.peekCounter).toHaveBeenCalled();
  });

  test("preview mode uses an explicit debugger counter", async () => {
    const out = (
      await Variable.applyVariables(new Path.Path("n-:counter:"), { preview: true, counter: 9 })
    ).finalize();
    expect(out).toBe("n-9");
    expect(Counter.peekCounter).not.toHaveBeenCalled();
  });

  test("private browsing uses the memory-only counter", async () => {
    const nextPrivateCounter = vi.fn(() => Promise.resolve(73));
    configureRoutingPorts({ nextPrivateCounter });

    const out = (
      await Variable.applyVariables(new Path.Path("n-:counter:"), {
        currentTab: { incognito: true },
      })
    ).finalize();

    expect(out).toBe("n-73");
    expect(nextPrivateCounter).toHaveBeenCalledTimes(1);
    expect(Counter.nextCounter).not.toHaveBeenCalled();
  });
});

describe(":uuid:", () => {
  test("interpolates a random v4 UUID", async () => {
    const out = (await Variable.applyVariables(new Path.Path(":uuid:"), {})).finalize();
    expect(out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test("is fresh on each interpolation", async () => {
    const a = (await Variable.applyVariables(new Path.Path(":uuid:"), {})).finalize();
    const b = (await Variable.applyVariables(new Path.Path(":uuid:"), {})).finalize();
    expect(a).not.toBe(b);
  });
});

describe(":mime: / :contenttype: / :mimeext: (async HEAD)", () => {
  const mockHead = (contentType: string) => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        headers: { get: (h: string) => (h === "Content-Type" ? contentType : null) },
      }),
    ) as any;
  };

  beforeEach(() => {
    // path.js sanitizes "/" in the mime value using options.replacementChar
    options.replacementChar = "_";
    options.includeFetchCredentials = false;
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  test(":mime: is the Content-Type with charset stripped (and path-sanitized)", async () => {
    mockHead("image/jpeg; charset=binary");
    const out = (
      await Variable.applyVariables(new Path.Path(":mime:"), { url: "https://x/a" })
    ).finalize();
    expect(out).toBe("image_jpeg"); // the "/" is sanitized like any segment
    expect(global.fetch).toHaveBeenCalledWith(
      "https://x/a",
      expect.objectContaining({ method: "HEAD", credentials: "omit", redirect: "follow" }),
    );
  });

  test("includes credentials in metadata requests only when enabled", async () => {
    options.includeFetchCredentials = true;
    mockHead("image/png");

    await Variable.applyVariables(new Path.Path(":mime:"), { url: "https://x/authenticated" });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://x/authenticated",
      expect.objectContaining({ method: "HEAD", credentials: "include", redirect: "follow" }),
    );
  });

  test("omits credentials from private metadata requests even when enabled", async () => {
    options.includeFetchCredentials = true;
    mockHead("image/png");

    await Variable.applyVariables(new Path.Path(":mime:"), {
      url: "https://x/private",
      currentTab: { incognito: true },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://x/private",
      expect.objectContaining({ method: "HEAD", credentials: "omit", redirect: "follow" }),
    );
  });

  test(":contenttype: is an alias for :mime:", async () => {
    mockHead("application/pdf");
    const out = (
      await Variable.applyVariables(new Path.Path(":contenttype:"), { url: "https://x/a" })
    ).finalize();
    expect(out).toBe("application_pdf");
  });

  test(":mimeext: maps the Content-Type to a file extension", async () => {
    mockHead("image/jpeg");
    // path.js trims a literal dot before a variable, so :mimeext: is used as a
    // directory or right after :filename:; here we assert the raw mapping
    const out = (
      await Variable.applyVariables(new Path.Path("by/:mimeext:"), { url: "https://x/a" })
    ).finalize();
    expect(out).toBe("by/jpg");
  });

  test("shares one HEAD across occurrences in a single download", async () => {
    mockHead("video/mp4");
    await Variable.applyVariables(new Path.Path(":mime:/:mimeext:"), { url: "https://x/a" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("protects lazy metadata requests with the download Referer", async () => {
    mockHead("image/webp");
    const protectedCalls: Array<[string, string, string[] | undefined]> = [];
    const withRequestReferer: RoutingPorts["withRequestReferer"] = async <T>(
      url: string,
      referer: string,
      operation: () => Promise<T>,
      requestMethods?: Array<"get" | "head">,
    ): Promise<T> => {
      protectedCalls.push([url, referer, requestMethods]);
      return operation();
    };
    configureRoutingPorts({ withRequestReferer });

    try {
      const out = (
        await Variable.applyVariables(new Path.Path(":mimeext:"), {
          url: "https://cdn.example/file",
          protectedFetchReferer: "https://gallery.example/view",
        })
      ).finalize();

      expect(out).toBe("webp");
      expect(protectedCalls).toEqual([
        ["https://cdn.example/file", "https://gallery.example/view", ["head", "get"]],
      ]);
    } finally {
      configureRoutingPorts({
        withRequestReferer: async (_url, _referer, operation) => operation(),
      });
    }
  });

  test("a rejected redirect hop extends the Referer rule and refetches (#193)", async () => {
    // First HEAD lands on an unprotected redirected hop and is refused; after
    // the rule extends to the hop URL, the refetch succeeds with metadata.
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        url: "https://s3.example/signed/file",
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://s3.example/signed/file",
        headers: { get: (h: string) => (h === "Content-Type" ? "image/webp" : null) },
      }) as any;
    const extended: string[] = [];
    const withRequestReferer: RoutingPorts["withRequestReferer"] = async <T>(
      _url: string,
      _referer: string,
      operation: (protection?: { extend(url: string): Promise<boolean> }) => Promise<T>,
    ): Promise<T> =>
      operation({
        extend: async (hop) => {
          extended.push(hop);
          return true;
        },
      });
    configureRoutingPorts({ withRequestReferer });

    try {
      const out = (
        await Variable.applyVariables(new Path.Path(":mimeext:"), {
          url: "https://cdn.example/file",
          protectedFetchReferer: "https://gallery.example/view",
        })
      ).finalize();

      expect(out).toBe("webp");
      expect(extended).toEqual(["https://s3.example/signed/file"]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      configureRoutingPorts({
        withRequestReferer: async (_url, _referer, operation) => operation(),
      });
    }
  });

  test("a failed HEAD yields an empty value (-> replacement char)", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("CORS"))) as any;
    const out = (
      await Variable.applyVariables(new Path.Path(":mimeext:"), { url: "https://x/a" })
    ).finalize();
    expect(out).toBe("_"); // an empty variable value becomes the replacement char
  });

  test("preview mode never hits the network", async () => {
    global.fetch = vi.fn() as any;
    const out = (
      await Variable.applyVariables(new Path.Path(":mime:"), {
        url: "https://x/a",
        preview: true,
      })
    ).finalize();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toBe("_"); // empty in preview -> replacement char
  });

  test("preview mode uses debugger-provided content metadata", async () => {
    global.fetch = vi.fn() as any;
    const out = (
      await Variable.applyVariables(new Path.Path(":mime:/:mimeext:"), {
        mime: "IMAGE/PNG; charset=utf-8",
        preview: true,
      })
    ).finalize();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toBe("image_png/png");
  });

  test("preview mode reuses resolved file metadata from the completed download", async () => {
    mockHead("image/jpeg");
    const info = { url: "https://x/a" };
    await Variable.applyVariables(new Path.Path(":mime:"), info);

    (info as { preview?: boolean }).preview = true;
    (info as { headPromise?: unknown }).headPromise = undefined;
    const out = (await Variable.applyVariables(new Path.Path(":mime:/:mimeext:"), info)).finalize();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(out).toBe("image_jpeg/jpg");
  });

  test("uses explicit and disabled metadata without starting a request", async () => {
    global.fetch = vi.fn() as any;
    const resolved = { contentType: "image/webp", finalUrl: "https://cdn.test/file" };
    await expect(Variable.resolveHead({ resolvedHead: resolved })).resolves.toBe(resolved);
    await expect(Variable.resolveHead({ contentFetchDisabled: true })).resolves.toEqual({
      contentType: "",
      finalUrl: "",
    });
    await expect(Variable.resolveMime({ mime: "IMAGE/PNG; charset=utf-8" })).resolves.toBe(
      "image/png",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("normalizes a missing metadata URL at the fetch boundary", async () => {
    mockHead("image/png");
    await expect(Variable.resolveHead({})).resolves.toEqual({
      contentType: "image/png",
      finalUrl: "",
    });
    expect(global.fetch).toHaveBeenCalledWith("", expect.objectContaining({ method: "HEAD" }));
  });

  test("returns disposition metadata and contains response-body cancellation failures", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("already closed")));
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        url: "https://cdn.test/file.jpg",
        headers: {
          get: (name: string) =>
            name === "Content-Disposition"
              ? 'attachment; filename="file.jpg"'
              : name === "Content-Type"
                ? "image/jpeg"
                : null,
        },
        body: { cancel },
      }),
    ) as any;
    await expect(Variable.resolveHead({ url: "https://source.test/file" })).resolves.toEqual({
      contentType: "image/jpeg",
      contentDisposition: 'attachment; filename="file.jpg"',
      finalUrl: "https://cdn.test/file.jpg",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("cancels a rejected HEAD body before falling back to GET", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("already closed")));
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, body: { cancel } })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://cdn.test/file.png",
        headers: { get: (name: string) => (name === "Content-Type" ? "image/png" : null) },
        body: null,
      }) as any;
    await expect(Variable.resolveHead({ url: "https://source.test/file" })).resolves.toEqual({
      contentType: "image/png",
      finalUrl: "https://cdn.test/file.png",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("falls back when a rejected HEAD has no response body", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, body: null })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://cdn.test/file.webp",
        headers: { get: (name: string) => (name === "Content-Type" ? "image/webp" : null) },
        body: null,
      }) as any;
    await expect(Variable.resolveHead({ url: "https://source.test/file" })).resolves.toEqual({
      contentType: "image/webp",
      finalUrl: "https://cdn.test/file.webp",
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("contains metadata timeouts at the lazy-variable boundary", async () => {
    global.fetch = vi.fn(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    ) as any;
    await expect(Variable.resolveHead({ url: "https://source.test/file" })).resolves.toEqual({
      contentType: "",
      finalUrl: "",
    });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  test("preview aliases reuse resolved content type and redirect URL", async () => {
    global.fetch = vi.fn() as any;
    const out = (
      await Variable.applyVariables(new Path.Path(":contenttype:/:redirecturl:"), {
        preview: true,
        resolvedHead: {
          contentType: "image/avif",
          finalUrl: "https://cdn.test/image.avif",
        },
      })
    ).finalize();
    expect(out).toBe("image_avif/https___cdn.test_image.avif");
    expect(global.fetch).not.toHaveBeenCalled();

    const mimeFallback = (
      await Variable.applyVariables(new Path.Path(":contenttype:"), {
        preview: true,
        mime: "text/plain; charset=utf-8",
      })
    ).finalize();
    expect(mimeFallback).toBe("text_plain");
  });

  test("mimeToExtension maps common types and falls back to the subtype", () => {
    expect(Variable.normalizeMimeType(undefined)).toBe("");
    expect(Variable.normalizeMimeType("; charset=utf-8")).toBe("");
    expect(Variable.mimeToExtension("image/jpeg")).toBe("jpg");
    expect(Variable.mimeToExtension("image/png")).toBe("png");
    expect(Variable.mimeToExtension("application/vnd.foobar+json")).toBe("json");
    expect(Variable.mimeToExtension("audio/x-wav")).toBe("wav");
    expect(Variable.mimeToExtension("")).toBe("");
    expect(Variable.mimeToExtension("invalid")).toBe("");
  });

  // The subtype fallback only works where the subtype IS the extension. These
  // are the two families where it is not, and both reach a real filename:
  // appendMimeExtension runs on any save whose name has no extension.
  describe("mimeToExtension refuses to invent an extension", () => {
    // "I don't know what this is" — the likeliest answer for exactly the URLs
    // that have no extension. "foo.octet" is worse than "foo": it looks like a
    // real extension, so the user has to remove it before adding the right one.
    test.each([
      "application/octet-stream",
      "binary/octet-stream",
      "application/octetstream",
      "application/force-download",
      "application/x-download",
      "application/download",
      "application/unknown",
    ])("leaves the name bare for %s", (mime) => {
      expect(Variable.mimeToExtension(mime)).toBe("");
    });

    test.each([
      ["application/x-bittorrent", "torrent"],
      ["application/x-msdownload", "exe"],
      ["application/x-shockwave-flash", "swf"],
    ])("maps %s to %s rather than its subtype", (mime, extension) => {
      expect(Variable.mimeToExtension(mime)).toBe(extension);
    });

    // The fallback's real wins must survive: these are types where the subtype
    // is the extension, including ones added after this table was written.
    test.each([
      ["image/webp", "webp"],
      ["image/avif", "avif"],
      ["video/webm", "webm"],
      ["application/x-7z-compressed", "7z"],
      ["application/vnd.rar", "rar"],
      ["font/woff2", "woff2"],
    ])("still derives %s from its subtype", (mime, extension) => {
      expect(Variable.mimeToExtension(mime)).toBe(extension);
    });
  });
});

describe(":sha256: (async content hash)", () => {
  // resolveContent (jsdom takes the in-context branch: fetch -> blob ->
  // arrayBuffer -> digest -> createObjectURL). Stub createObjectURL so the fake
  // blob is accepted; the test only asserts the hash, not the URL.
  let origCreateObjectURL: typeof URL.createObjectURL;
  const mockBody = (text: string, extraHeaders: Record<string, string> = {}) => {
    const buf = new TextEncoder().encode(text).buffer;
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: (h: string) => extraHeaders[h] ?? null },
        blob: () =>
          Promise.resolve({ size: buf.byteLength, arrayBuffer: () => Promise.resolve(buf) }),
      }),
    ) as any;
  };

  beforeEach(() => {
    options.replacementChar = "_";
    options.includeFetchCredentials = false;
    origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:mock");
  });

  afterEach(() => {
    delete (global as any).fetch;
    URL.createObjectURL = origCreateObjectURL;
  });

  test(":sha256: is the first 12 lowercase hex characters of the SHA-256", async () => {
    mockBody("abc"); // NIST test vector
    const out = (
      await Variable.applyVariables(new Path.Path("h/:sha256:"), { url: "https://x/a" })
    ).finalize();
    expect(out).toBe("h/ba7816bf8f01");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://x/a",
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
  });

  test("omits credentials from private content hashing even when enabled", async () => {
    options.includeFetchCredentials = true;
    mockBody("abc");

    await Variable.applyVariables(new Path.Path(":sha256:"), {
      url: "https://x/private",
      currentTab: { incognito: true },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://x/private",
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
  });

  test("shares one GET across multiple :sha256: occurrences", async () => {
    mockBody("abc");
    await Variable.applyVariables(new Path.Path(":sha256:/:sha256:"), { url: "https://x/a" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("passes the protected Referer to the shared content fetch", async () => {
    const protectedContent = vi.fn(async () => ({
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      downloadUrl: "blob:protected",
    }));
    configureRoutingPorts({ resolveContent: protectedContent });

    try {
      const out = (
        await Variable.applyVariables(new Path.Path(":sha256:"), {
          url: "https://cdn.example/file",
          protectedFetchReferer: "https://gallery.example/view",
        })
      ).finalize();

      expect(out).toBe("ba7816bf8f01");
      expect(protectedContent).toHaveBeenCalledWith(
        "https://cdn.example/file",
        false,
        undefined,
        expect.any(String),
        "https://gallery.example/view",
      );
    } finally {
      configureRoutingPorts({ resolveContent });
    }
  });

  test(":sha256full: returns all 64 characters and shares the :sha256: fetch", async () => {
    mockBody("abc");
    const out = (
      await Variable.applyVariables(new Path.Path(":sha256:/:sha256full:"), {
        url: "https://x/a",
      })
    ).finalize();

    expect(out).toBe(
      "ba7816bf8f01/ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("a failed fetch yields an empty value (-> replacement char)", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network"))) as any;
    const out = (
      await Variable.applyVariables(new Path.Path(":sha256:"), { url: "https://x/a" })
    ).finalize();
    expect(out).toBe("_");
  });

  test("does not impose a hash ceiling from declared Content-Length", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: {
          get: (h: string) => (h === "Content-Length" ? String(10 * 1024 ** 3) : null),
        },
        blob: () =>
          Promise.resolve({ size: 0, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
      }),
    ) as any;
    const out = (
      await Variable.applyVariables(new Path.Path(":sha256:"), { url: "https://x/a" })
    ).finalize();
    expect(out).toBe("e3b0c44298fc");
  });

  test("preview mode never hits the network", async () => {
    global.fetch = vi.fn() as any;
    const out = (
      await Variable.applyVariables(new Path.Path(":sha256:"), {
        url: "https://x/a",
        preview: true,
      })
    ).finalize();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toBe("_");
  });

  test("content fetching is disabled or skipped without a source URL", async () => {
    await expect(Variable.resolveContent({ contentFetchDisabled: true })).resolves.toBeNull();
    await expect(Variable.resolveContent({})).resolves.toBeNull();
  });

  test("preview mode reuses a hash retained from the completed download", async () => {
    mockBody("abc");
    const info = { url: "https://x/a" };
    await Variable.applyVariables(new Path.Path(":sha256:"), info);
    expect((info as { sha256?: string }).sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );

    (info as { preview?: boolean }).preview = true;
    (info as { contentPromise?: unknown }).contentPromise = undefined;
    const out = (await Variable.applyVariables(new Path.Path(":sha256:"), info)).finalize();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(out).toBe("ba7816bf8f01");
  });
});

describe(":finalurl: / :redirecturl: (post-redirect URL)", () => {
  beforeEach(() => {
    options.replacementChar = "_";
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  test(":finalurl: is the response URL after redirects", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        url: "https://cdn.example.com/real/file.jpg",
        headers: { get: () => null },
      }),
    ) as any;
    const out = (
      await Variable.applyVariables(new Path.Path(":finalurl:"), { url: "https://x/a" })
    ).finalize();
    // the full URL is path-sanitized like :sourceurl:, but the host survives intact
    expect(out).toContain("cdn.example.com");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://x/a",
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  test(":redirecturl: is an alias sharing the same HEAD", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ url: "https://final/x", headers: { get: () => null } }),
    ) as any;
    await Variable.applyVariables(new Path.Path(":finalurl:/:redirecturl:"), {
      url: "https://x/a",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("preview mode never hits the network", async () => {
    global.fetch = vi.fn() as any;
    await Variable.applyVariables(new Path.Path(":finalurl:"), {
      url: "https://x/a",
      preview: true,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
