import {
  applyRenameTransform,
  expandRenameTransform,
  isRenameTransform,
  RENAME_SEPARATOR,
  splitRenameValue,
  type RenameTransform,
} from "../../src/routing/rename.ts";

const transform = (find: string, replacement: string, flags = ""): RenameTransform => ({
  find,
  flags,
  replacement,
});

describe("splitRenameValue", () => {
  test("splits on the first raw separator occurrence", () => {
    expect(splitRenameValue("a -> b")).toEqual({ find: "a", replacement: "b" });
    expect(splitRenameValue("a -> b -> c")).toEqual({ find: "a", replacement: "b -> c" });
  });

  test("returns null without the separator", () => {
    expect(splitRenameValue("a->b")).toBeNull();
    expect(splitRenameValue("a - > b")).toBeNull();
    expect(splitRenameValue("")).toBeNull();
  });

  test("keeps empty sides verbatim", () => {
    expect(splitRenameValue(" -> b")).toEqual({ find: "", replacement: "b" });
    expect(splitRenameValue("a -> ")).toEqual({ find: "a", replacement: "" });
  });

  test("a regex-escaped space keeps a literal ' -> ' out of the raw text", () => {
    // The documented escape: `\x20->` matches " ->" without the raw separator.
    const parts = splitRenameValue("\\x20->x -> _");
    expect(parts).toEqual({ find: "\\x20->x", replacement: "_" });
    expect("a ->x".replace(new RegExp(parts!.find), parts!.replacement)).toBe("a_");
  });

  test("separator constant is the documented four characters", () => {
    expect(RENAME_SEPARATOR).toBe(" -> ");
  });
});

describe("applyRenameTransform", () => {
  test("replaces the first match without the g flag", () => {
    expect(applyRenameTransform("aaa.txt", transform("a", "b"))).toBe("baa.txt");
  });

  test("replaces every match with the g flag", () => {
    expect(applyRenameTransform("aaa.txt", transform("a", "b", "g"))).toBe("bbb.txt");
  });

  test("honors case-insensitive flags", () => {
    expect(applyRenameTransform("IMG_123.JPG", transform("img_", "photo-", "i"))).toBe(
      "photo-123.JPG",
    );
    expect(applyRenameTransform("IMG_123.JPG", transform("img_", "photo-"))).toBe("IMG_123.JPG");
  });

  test("an empty replacement deletes matches", () => {
    expect(applyRenameTransform("report-final-final.pdf", transform("-final", "", "g"))).toBe(
      "report.pdf",
    );
  });

  test("deleting the whole component falls back to _", () => {
    expect(applyRenameTransform("name.txt", transform(".*", ""))).toBe("_");
  });

  test("an empty component stays empty", () => {
    expect(applyRenameTransform("", transform("a", "b"))).toBe("");
  });

  test("the replacement is literal: $ sequences are not group references", () => {
    expect(applyRenameTransform("cat.jpg", transform("(cat)", "$1-$&-$$"))).toBe("$1-$&-$$.jpg");
  });

  test("regex capture groups in find are matched, not referenced", () => {
    // The find side is a full regex dialect; only rule capture: placeholders
    // (already substituted into the replacement) carry values across.
    expect(applyRenameTransform("v2.ubuntu.tar", transform("^v(\\d+)\\.", ""))).toBe("ubuntu.tar");
  });

  test("keeps the component when the stored find pattern no longer compiles", () => {
    expect(applyRenameTransform("cat.jpg", transform("(", "x"))).toBe("cat.jpg");
    expect(applyRenameTransform("cat.jpg", transform("a", "x", "??"))).toBe("cat.jpg");
  });

  test("slashes in the replacement stay in the component for later sanitization", () => {
    expect(applyRenameTransform("cat.jpg", transform("cat", "a/b"))).toBe("a/b.jpg");
  });
});

describe("expandRenameTransform", () => {
  test("expands routing variables in the replacement only", async () => {
    const expanded = await expandRenameTransform(
      transform(":filename:", ":sourcedomain:-:naivefilename:", "g"),
      { url: "https://cdn.example/dir/pic.png" },
    );
    expect(expanded).toEqual(transform(":filename:", "cdn.example-pic.png", "g"));
  });

  test("metadata-dependent variables are allowed and resolve from the info bag", async () => {
    const expanded = await expandRenameTransform(transform("x", ":mime:."), {
      mime: "image/png",
    });
    expect(expanded.replacement).toBe("image/png.");
  });

  test("unknown tokens stay literal", async () => {
    const expanded = await expandRenameTransform(transform("x", ":notavariable:"), {});
    expect(expanded.replacement).toBe(":notavariable:");
  });

  // The template splits on a capturing variable pattern, so the literal text
  // between variables is looked up in the transformer table too. That table is
  // an object literal whose own keys are all colon-wrapped, so an
  // Object.prototype name can never be shadowed: a replacement naming one is
  // ordinary literal text that must survive as itself.
  test.each(["constructor", "__proto__", "toString", "valueOf"])(
    "the inherited name %s is literal replacement text",
    async (name) => {
      const expanded = await expandRenameTransform(transform("x", name), {});
      expect(expanded.replacement).toBe(name);
    },
  );

  test("an inherited name next to a real variable stays literal", async () => {
    const expanded = await expandRenameTransform(transform("x", ":naivefilename:constructor"), {
      url: "https://cdn.example/dir/pic.png",
    });
    expect(expanded.replacement).toBe("pic.pngconstructor");
  });
});

describe("isRenameTransform", () => {
  test("accepts the persisted shape and rejects everything else", () => {
    expect(isRenameTransform(transform("a", "b", "gi"))).toBe(true);
    expect(isRenameTransform(null)).toBe(false);
    expect(isRenameTransform("a -> b")).toBe(false);
    expect(isRenameTransform({ find: "a", flags: "g" })).toBe(false);
    expect(isRenameTransform({ find: "a", flags: "g", replacement: 1 })).toBe(false);
  });
});

// A page controls the filename's length (a data: URL link can carry 2 MB), and
// an ordinary find such as `(.*)\.(jpe?g|png)$` backtracks quadratically on
// it, so the find sees at most the matchers' 4,096-character bound.
describe("applyRenameTransform input bound", () => {
  test("runs the find over a page-length name with its stem truncated and extension kept", () => {
    const renamed = applyRenameTransform(
      `${"a".repeat(200_000)}.jpg`,
      transform("(.*)\\.(jpe?g|png)$", "x.png"),
    );
    expect(renamed).toBe("x.png");

    const appended = applyRenameTransform(`${"a".repeat(200_000)}.jpg`, transform("$", "!"));
    expect(appended).toBe(`${"a".repeat(4_092)}.jpg!`);
  });

  test("leaves a name at the bound untouched", () => {
    const name = `${"a".repeat(4_092)}.jpg`;
    expect(applyRenameTransform(name, transform("$", "!"))).toBe(`${name}!`);
  });

  test("truncates a name without an extension and never splits a surrogate pair", () => {
    expect(applyRenameTransform("b".repeat(10_000), transform("$", "!"))).toBe(
      `${"b".repeat(4_096)}!`,
    );
    const emoji = applyRenameTransform(`${"😀".repeat(5_000)}.jpeg`, transform("$", "!"));
    expect(emoji).toBe(`${"😀".repeat(2_045)}.jpeg!`);
  });
});
