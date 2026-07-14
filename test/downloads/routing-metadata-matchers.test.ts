import { createBrowserDownloadState } from "../../src/downloads/browser-downloads.ts";
import { matchRules, parseRules } from "../../src/routing/router.ts";

describe("routing metadata matchers", () => {
  test.each(["mime", "contenttype"])("%s matches the normalized MIME type", (matcher) => {
    const rules = parseRules(`${matcher}: ^image/webp$\ninto: images/:filename:`);

    expect(
      matchRules(rules, {
        filename: "photo.webp",
        mime: "image/webp",
      }),
    ).toBe("images/:filename:");
    expect(matchRules(rules, { filename: "photo.jpg", mime: "image/jpeg" })).toBeNull();
  });

  test("mime matchers can read already-resolved response metadata", () => {
    const rules = parseRules("mime: ^application/pdf$\ninto: documents/:filename:");

    expect(
      matchRules(rules, {
        filename: "report.pdf",
        resolvedHead: {
          contentType: "application/pdf",
          finalUrl: "https://cdn.example.test/report.pdf",
        },
      }),
    ).toBe("documents/:filename:");
  });

  test("referrer matchers use the reported referrer URL and hostname", () => {
    const rules = parseRules(
      [
        "referrerurl: ^https://mail\\.example\\.com/",
        "referrerdomain: ^mail\\.example\\.com$",
        "into: mail/:filename:",
      ].join("\n"),
    );

    expect(
      matchRules(rules, {
        filename: "attachment.pdf",
        referrerUrl: "https://mail.example.com/thread/42",
      }),
    ).toBe("mail/:filename:");
    expect(
      matchRules(rules, {
        filename: "attachment.pdf",
        referrerUrl: "https://chat.example.com/thread/42",
      }),
    ).toBeNull();
  });

  test("referrer matchers fall back to the Save In page URL", () => {
    const rules = parseRules("referrerdomain: ^gallery\\.example$\ninto: gallery/:filename:");

    expect(
      matchRules(rules, {
        filename: "photo.jpg",
        pageUrl: "https://gallery.example/album/42",
      }),
    ).toBe("gallery/:filename:");
  });

  test.each([
    ["pagerootdomain", "pageUrl"],
    ["sourcerootdomain", "sourceUrl"],
  ] as const)("%s removes subdomains before matching", (matcher, field) => {
    const rules = parseRules(`${matcher}: ^example\\.co\\.uk$\ninto: sites/:filename:`);

    expect(
      matchRules(rules, {
        filename: "photo.jpg",
        [field]: "https://media.cdn.example.co.uk/photo.jpg",
      }),
    ).toBe("sites/:filename:");
    expect(
      matchRules(rules, {
        filename: "photo.jpg",
        [field]: "https://media.example.com/photo.jpg",
      }),
    ).toBeNull();
  });

  test("ordinary browser downloads expose MIME and referrer metadata to rules", () => {
    const state = createBrowserDownloadState({
      url: "https://downloads.example.test/id/42",
      finalUrl: "https://cdn.example.test/report.pdf",
      filename: "C:\\Downloads\\report.pdf",
      mime: "Application/PDF; charset=binary",
      referrer: "https://mail.example.test/thread/7",
    });
    const rules = parseRules(
      [
        "mime: ^application/pdf$",
        "referrerdomain: ^mail\\.example\\.test$",
        "into: browser/:filename:",
      ].join("\n"),
    );

    expect(state.info).toMatchObject({
      mime: "application/pdf",
      referrerUrl: "https://mail.example.test/thread/7",
    });
    expect(matchRules(rules, state.info)).toBe("browser/:filename:");
  });
});
