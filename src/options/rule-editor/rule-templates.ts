import type { RoutingDownloadInfo } from "../../routing/rule-types.ts";

export type RuleTemplate = {
  category:
    | "Media"
    | "File types"
    | "Date and sequence"
    | "Sites and URLs"
    | "Save context"
    | "Site originals"
    | "Site filing";
  name: string;
  description: string;
  example: string;
  rule: string;
  // `fetch` is only present on fetch:-based templates; the proof suite
  // asserts it through matchRulesDetailed alongside the plain destination.
  proof: { info: RoutingDownloadInfo; destination: string; fetch?: string };
};

type GetMessage = (key: string) => string;

export type LocalizedRuleTemplate = Omit<RuleTemplate, "category"> & { category: string };

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    category: "Media",
    name: "Images into per-site folders",
    description: "Sorts every saved image by the site it came from",
    example: "Example: images/example.com/photo.jpg",
    rule: "mediatype: image\ninto: images/:pagedomain:/:filename:",
    proof: {
      info: {
        mediaType: "image",
        pageUrl: "https://example.com/gallery",
        filename: "photo.jpg",
      },
      destination: "images/:pagedomain:/:filename:",
    },
  },
  {
    category: "Media",
    name: "Videos into per-site folders",
    description: "Sorts every saved video by the site it came from",
    example: "Example: videos/example.com/clip.mp4",
    rule: "mediatype: video\ninto: videos/:pagedomain:/:filename:",
    proof: {
      info: {
        mediaType: "video",
        pageUrl: "https://example.com/gallery",
        filename: "clip.mp4",
      },
      destination: "videos/:pagedomain:/:filename:",
    },
  },
  {
    category: "Media",
    name: "Audio into per-site folders",
    description: "Groups saved audio by the page where it was found",
    example: "Example: audio/example.com/podcast.mp3",
    rule: "mediatype: audio\ninto: audio/:pagedomain:/:filename:",
    proof: {
      info: {
        mediaType: "audio",
        pageUrl: "https://example.com/gallery",
        filename: "podcast.mp3",
      },
      destination: "audio/:pagedomain:/:filename:",
    },
  },
  {
    category: "Media",
    name: "Screenshots by month",
    description: "Keeps filenames beginning with screenshot in dated folders",
    example: "Example: screenshots/2026/07/Screenshot 42.png",
    rule: "filename/i: ^screen([ _-]?shot|capture)\ninto: screenshots/:year:/:month:/:filename:",
    proof: {
      info: { filename: "Screenshot 42.png", now: new Date(2026, 6, 12, 12) },
      destination: "screenshots/:year:/:month:/:filename:",
    },
  },
  {
    category: "File types",
    name: "PDFs into a documents folder",
    description: "Collects every PDF in one place",
    example: "Example: documents/report.pdf",
    rule: "actualfileext/i: ^pdf$\ninto: documents/:filename:",
    proof: {
      info: { sourceUrl: "https://example.test/report.pdf", filename: "report.pdf" },
      destination: "documents/:filename:",
    },
  },
  {
    category: "File types",
    name: "PDFs by content type",
    description: "Catches PDFs by their reported content type instead of the filename",
    example: "Example: documents/report",
    rule: "mime: ^application/pdf$\ninto: documents/:filename:",
    proof: {
      info: {
        url: "https://files.example/download/42",
        filename: "report",
        mime: "application/pdf",
      },
      destination: "documents/:filename:",
    },
  },
  {
    category: "File types",
    name: "Archives into one folder",
    description: "Collects zip, rar, 7z, tar, and compressed archives",
    example: "Example: archives/project.zip",
    rule: "actualfileext/i: ^(zip|rar|7z|tar|gz|tgz|bz2|xz)$\ninto: archives/:filename:",
    proof: {
      info: { sourceUrl: "https://example.test/project.zip", filename: "project.zip" },
      destination: "archives/:filename:",
    },
  },
  {
    category: "File types",
    name: "Documents into one folder",
    description: "Collects common office and text documents",
    example: "Example: documents/notes.docx",
    rule: "actualfileext/i: ^(pdf|docx?|xlsx?|pptx?|odt|ods|rtf|txt|csv)$\ninto: documents/:filename:",
    proof: {
      info: { sourceUrl: "https://example.test/notes.docx", filename: "notes.docx" },
      destination: "documents/:filename:",
    },
  },
  {
    category: "File types",
    name: "E-books and comics",
    description: "Collects common e-book and digital comic formats",
    example: "Example: books/novel.epub",
    rule: "actualfileext/i: ^(epub|mobi|azw3?|pdf|cbz|cbr)$\ninto: books/:filename:",
    proof: {
      info: { sourceUrl: "https://example.test/novel.epub", filename: "novel.epub" },
      destination: "books/:filename:",
    },
  },
  {
    category: "File types",
    name: "Apps and installers",
    description: "Keeps desktop and mobile installation packages together",
    example: "Example: installers/setup.msi",
    rule: "actualfileext/i: ^(exe|msi|dmg|pkg|deb|rpm|appimage|apk)$\ninto: installers/:filename:",
    proof: {
      info: { sourceUrl: "https://example.test/setup.msi", filename: "setup.msi" },
      destination: "installers/:filename:",
    },
  },
  {
    category: "File types",
    name: "Fonts into one folder",
    description: "Collects desktop and web font files",
    example: "Example: fonts/inter.woff2",
    rule: "actualfileext/i: ^(ttf|otf|woff2?|eot)$\ninto: fonts/:filename:",
    proof: {
      info: { sourceUrl: "https://example.test/inter.woff2", filename: "inter.woff2" },
      destination: "fonts/:filename:",
    },
  },
  {
    category: "File types",
    name: "One folder per file extension",
    description: "Captures the extension and uses it as a folder name",
    example: "Example: files/png/screenshot.png",
    rule: "actualfileext: ^(.+)$\ncapturegroups: actualfileext\ninto: files/:$1:/:filename:",
    proof: {
      info: { sourceUrl: "https://example.test/screenshot.png", filename: "screenshot.png" },
      destination: "files/png/:filename:",
    },
  },
  {
    category: "Date and sequence",
    name: "Date-stamp every download",
    description: "Prefixes the original filename with the save date",
    example: "Example: 2026-07-12-report.pdf",
    rule: "filename: .*\ninto: :date:-:filename:",
    proof: {
      info: {
        sourceUrl: "https://example.test/report.pdf",
        filename: "report.pdf",
        now: new Date(2026, 6, 12, 12),
      },
      destination: ":date:-:filename:",
    },
  },
  {
    category: "Date and sequence",
    name: "Daily inbox",
    description: "Creates one folder for each calendar day",
    example: "Example: inbox/2026/07/12/report.pdf",
    rule: "filename: .*\ninto: inbox/:year:/:month:/:day:/:filename:",
    proof: {
      info: {
        sourceUrl: "https://example.test/report.pdf",
        filename: "report.pdf",
        now: new Date(2026, 6, 12, 12),
      },
      destination: "inbox/:year:/:month:/:day:/:filename:",
    },
  },
  {
    category: "Date and sequence",
    name: "Downloads by month",
    description: "Creates year and month folders while keeping the original filename",
    example: "Example: archive/2026/07/report.pdf",
    rule: "filename: .*\ninto: archive/:year:/:month:/:filename:",
    proof: {
      info: {
        sourceUrl: "https://example.test/report.pdf",
        filename: "report.pdf",
        now: new Date(2026, 6, 12, 12),
      },
      destination: "archive/:year:/:month:/:filename:",
    },
  },
  {
    category: "Date and sequence",
    name: "Weekly inbox",
    description: "Creates one inbox folder for each ISO week",
    example: "Example: inbox/2026-w28/report.pdf",
    rule: "filename: .*\ninto: inbox/:year:-w:isoweek:/:filename:",
    proof: {
      info: {
        sourceUrl: "https://example.test/report.pdf",
        filename: "report.pdf",
        now: new Date(2026, 6, 12, 12),
      },
      destination: "inbox/:year:-w:isoweek:/:filename:",
    },
  },
  {
    category: "Date and sequence",
    name: "Sequential archive",
    description: "Prefixes files with Save In's persistent download counter",
    example: "Example: archive/42-report.pdf",
    rule: "filename: .*\ninto: archive/:counter:-:filename:",
    proof: {
      info: {
        sourceUrl: "https://example.test/report.pdf",
        filename: "report.pdf",
        counter: 42,
      },
      destination: "archive/:counter:-:filename:",
    },
  },
  {
    category: "Sites and URLs",
    name: "One site, one folder",
    description: "Routes one chosen website into its own folder",
    example: "Example: example/an-interesting-page/report.pdf",
    rule: "pagerootdomain: ^example\\.com$\ninto: example/:pagetitleslug:/:filename:",
    proof: {
      info: {
        pageUrl: "https://news.example.com/an-interesting-page",
        filename: "report.pdf",
        currentTab: { title: "An Interesting Page" },
      },
      destination: "example/:pagetitleslug:/:filename:",
    },
  },
  {
    category: "Sites and URLs",
    name: "One folder per source site",
    description: "Groups downloads by the hostname serving the file",
    example: "Example: sites/cdn.example.com/photo.jpg",
    rule: "sourceurl: .*\ninto: sites/:sourcedomain:/:filename:",
    proof: {
      info: {
        sourceUrl: "https://cdn.example.com/photo.jpg",
        url: "https://cdn.example.com/photo.jpg",
        filename: "photo.jpg",
      },
      destination: "sites/:sourcedomain:/:filename:",
    },
  },
  {
    category: "Sites and URLs",
    name: "One folder per source root domain",
    description: "Combines downloads from subdomains of the same source site",
    example: "Example: sites/example.com/photo.jpg",
    rule: "sourcerootdomain: .+\ninto: sites/:sourcerootdomain:/:filename:",
    proof: {
      info: {
        sourceUrl: "https://media.cdn.example.com/photo.jpg",
        url: "https://media.cdn.example.com/photo.jpg",
        filename: "photo.jpg",
      },
      destination: "sites/:sourcerootdomain:/:filename:",
    },
  },
  {
    category: "Sites and URLs",
    name: "One folder per page site",
    description: "Groups files by the website you were browsing rather than the file host",
    example: "Example: sites/example.com/photo.jpg",
    rule: "pageurl: .*\ninto: sites/:pagedomain:/:filename:",
    proof: {
      info: { pageUrl: "https://example.com/gallery", filename: "photo.jpg" },
      destination: "sites/:pagedomain:/:filename:",
    },
  },
  {
    category: "Sites and URLs",
    name: "Page-title prefix",
    description: "Adds a filesystem-safe page title before the original filename",
    example: "Example: pages/an-interesting-page-report.pdf",
    rule: "pagetitle: .+\ninto: pages/:pagetitleslug:-:filename:",
    proof: {
      info: {
        sourceUrl: "https://example.test/report.pdf",
        filename: "report.pdf",
        currentTab: { title: "An Interesting Page" },
      },
      destination: "pages/:pagetitleslug:-:filename:",
    },
  },
  {
    category: "Sites and URLs",
    name: "Capture part of the URL",
    description: "Uses a regex capture group in the saved filename",
    example: "Example: imgur/abc123-photo.jpg",
    rule: "sourceurl: imgur\\.com/(\\w+)\ncapturegroups: sourceurl\ninto: imgur/:$1:-:filename:",
    proof: {
      info: { sourceUrl: "https://imgur.com/abc123", filename: "photo.jpg" },
      destination: "imgur/abc123-:filename:",
    },
  },
  {
    category: "Sites and URLs",
    name: "Downloads from a site section",
    description: "Routes downloads referred from one URL section into its own folder",
    example: "Example: projects/report.pdf",
    rule: "referrerurl: ^https://example\\.com/projects/\ninto: projects/:filename:",
    proof: {
      info: {
        referrerUrl: "https://example.com/projects/quarterly/report",
        filename: "report.pdf",
      },
      destination: "projects/:filename:",
    },
  },
  {
    category: "Save context",
    name: "Browser downloads inbox",
    description: "Keeps tracked browser-owned downloads in a separate folder",
    example: "Example: browser-downloads/archive.zip",
    rule: "context: browser\ninto: browser-downloads/:filename:",
    proof: {
      info: { context: "browser", filename: "archive.zip" },
      destination: "browser-downloads/:filename:",
    },
  },
  {
    category: "Save context",
    name: "Link downloads inbox",
    description: "Separates files saved from links from embedded media",
    example: "Example: links/report.pdf",
    rule: "context: link\ninto: links/:filename:",
    proof: { info: { context: "link", filename: "report.pdf" }, destination: "links/:filename:" },
  },
  {
    category: "Save context",
    name: "Selected text inbox",
    description: "Keeps files created from selected page text together",
    example: "Example: selections/2026-07-12-selection.txt",
    rule: "context: selection\ninto: selections/:date:-:filename:",
    proof: {
      info: {
        context: "selection",
        filename: "selection.txt",
        now: new Date(2026, 6, 12, 12),
      },
      destination: "selections/:date:-:filename:",
    },
  },
  {
    category: "Save context",
    name: "Tab saves inbox",
    description: "Keeps files saved from tab actions together",
    example: "Example: tabs/page.html",
    rule: "context: tab\ninto: tabs/:filename:",
    proof: { info: { context: "tab", filename: "page.html" }, destination: "tabs/:filename:" },
  },
  {
    category: "Site originals",
    name: "Twitter/X image originals",
    description: "Rewrites Twitter and X image links to the original, full-resolution file",
    example: "Example: twitter/EQEN6n3U.jpg",
    rule: "sourceurl: ^https://pbs\\.twimg\\.com/media/([\\w-]+)\\?format=(\\w+)\ncapturegroups: sourceurl\nfetch: https://pbs.twimg.com/media/:$1:.:$2:?name=orig\ninto: twitter/:$1:.:$2:",
    proof: {
      info: { sourceUrl: "https://pbs.twimg.com/media/EQEN6n3U?format=jpg&name=small" },
      destination: "twitter/EQEN6n3U.jpg",
      fetch: "https://pbs.twimg.com/media/EQEN6n3U.jpg?name=orig",
    },
  },
  {
    category: "Site originals",
    name: "Reddit image originals",
    description: "Rewrites Reddit preview image links to the original file on i.redd.it",
    example: "Example: reddit/8k2eq6z6z6ib1.jpg",
    rule: "sourceurl: ^https://preview\\.redd\\.it/([\\w-]+\\.\\w+)\\?\ncapturegroups: sourceurl\nfetch: https://i.redd.it/:$1:\ninto: reddit/:$1:",
    proof: {
      info: {
        sourceUrl:
          "https://preview.redd.it/8k2eq6z6z6ib1.jpg?width=960&crop=smart&auto=webp&s=abc123",
      },
      destination: "reddit/8k2eq6z6z6ib1.jpg",
      fetch: "https://i.redd.it/8k2eq6z6z6ib1.jpg",
    },
  },
  {
    category: "Site originals",
    name: "Wikimedia full-size image",
    description: "Rewrites Wikimedia Commons thumbnail links to the original full-size file",
    example: "Example: wikimedia/Example.jpg",
    rule: "sourceurl: ^https://upload\\.wikimedia\\.org/(wikipedia/\\w+)/thumb/(\\w+/\\w+)/([^/]+)/\\d+px-[^/]+$\ncapturegroups: sourceurl\nfetch: https://upload.wikimedia.org/:$1:/:$2:/:$3:\ninto: wikimedia/:$3:",
    proof: {
      info: {
        sourceUrl:
          "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/250px-Example.jpg",
      },
      destination: "wikimedia/Example.jpg",
      fetch: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
    },
  },
  {
    category: "Site originals",
    name: "YouTube thumbnail max resolution",
    description: "Rewrites YouTube thumbnail links to the maximum-resolution image",
    example: "Example: youtube/dQw4w9WgXcQ-maxresdefault.jpg",
    rule: "sourceurl: ^https://i\\.ytimg\\.com/vi/([\\w-]+)/\\w+\\.(\\w+)$\ncapturegroups: sourceurl\nfetch: https://i.ytimg.com/vi/:$1:/maxresdefault.:$2:\ninto: youtube/:$1:-maxresdefault.:$2:",
    proof: {
      info: { sourceUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
      destination: "youtube/dQw4w9WgXcQ-maxresdefault.jpg",
      fetch: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    },
  },
  {
    category: "Site originals",
    name: "Pixiv original-quality image",
    description:
      "Rewrites a Pixiv preview image to the full-resolution original file (needs the Referer option on for i.pximg.net)",
    example: "Example: pixiv/74391008_p0.jpg",
    // Pixiv's img-master preview is always JPEG, but the original keeps its
    // uploaded extension, so the fetch line assumes .jpg — change it for a PNG
    // or GIF work. i.pximg.net serves nothing without a pixiv.net Referer, so
    // this needs the Referer option enabled for *://i.pximg.net/* (#66).
    rule: "sourceurl: ^https://i\\.pximg\\.net/img-master/img/(.+)/(\\d+_p\\d+)_master1200\\.(\\w+)\ncapturegroups: sourceurl\nfetch: https://i.pximg.net/img-original/img/:$1:/:$2:.jpg\ninto: pixiv/:$2:.:$3:",
    proof: {
      info: {
        sourceUrl:
          "https://i.pximg.net/img-master/img/2019/04/26/22/08/07/74391008_p0_master1200.jpg",
      },
      destination: "pixiv/74391008_p0.jpg",
      fetch: "https://i.pximg.net/img-original/img/2019/04/26/22/08/07/74391008_p0.jpg",
    },
  },
  {
    category: "Site filing",
    name: "Twitter/X handle prefix",
    description: "Prefixes saved files with the Twitter or X handle from the page URL",
    example: "Example: twitter/exampleuser-photo.jpg",
    rule: "pageurl: ^https://(?:x|twitter)\\.com/(\\w+)/\ncapturegroups: pageurl\ninto: twitter/:$1:-:filename:",
    proof: {
      info: { pageUrl: "https://x.com/exampleuser/status/123456789", filename: "photo.jpg" },
      destination: "twitter/exampleuser-:filename:",
    },
  },
  {
    category: "Site filing",
    name: "Instagram username prefix",
    description: "Prefixes saved files with the Instagram username from the page title",
    example: "Example: instagram/janedoe-photo.jpg",
    rule: "pagerootdomain: ^instagram\\.com$\npagetitle: @(\\w+)\ncapturegroups: pagetitle\ninto: instagram/:$1:-:filename:",
    proof: {
      info: {
        pageUrl: "https://www.instagram.com/p/Cx1234567/",
        filename: "photo.jpg",
        currentTab: { title: "Jane Doe (@janedoe) • Instagram photos and videos" },
      },
      destination: "instagram/janedoe-:filename:",
    },
  },
  {
    category: "Site filing",
    name: "DeviantArt hashed-filename rename",
    description:
      "Renames DeviantArt's hashed download filename to the artwork title and short code",
    example: "Example: deviantart/Sunset over the lake-dcror1m.png",
    rule: "filename: ^([a-z0-9]+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(\\w+)$\npagetitle: (.+) on DeviantArt\ncapturegroups: filename,pagetitle\ninto: deviantart/:$3:-:$1:.:$2:",
    proof: {
      info: {
        filename: "dcror1m-bd1fe78d-cf2b-4c0f-ab93-08eaadfc4e88.png",
        currentTab: { title: "Sunset over the lake on DeviantArt" },
      },
      destination: "deviantart/Sunset over the lake-dcror1m.png",
    },
  },
  {
    category: "Site filing",
    name: "Page path without the scheme",
    description:
      "Builds folders from the page URL's host and path while dropping the https:// scheme that otherwise corrupts filenames",
    example: "Example: pages/example.com/articles/great-article/photo.jpg",
    rule: "pageurl: ^https?://([^?]+)\ncapturegroups: pageurl\ninto: pages/:$1:/:filename:",
    proof: {
      info: {
        pageUrl: "https://example.com/articles/great-article?utm_source=x",
        filename: "photo.jpg",
      },
      destination: "pages/example.com/articles/great-article/:filename:",
    },
  },
  {
    category: "Site filing",
    name: "Slugged title rename",
    description:
      "Replaces the filename with a lowercase, hyphenated slug of the page title, keeping the original extension (a general find-and-replace on filenames isn't supported)",
    example: "Example: my-great-article.jpg",
    rule: "pagetitle: .+\nfilename: \\.(\\w+)$\ncapturegroups: filename\ninto: :pagetitleslug:.:$1:",
    proof: {
      info: {
        filename: "My-Great-Article.jpg",
        currentTab: { title: "My Great, Article!" },
      },
      destination: ":pagetitleslug:.jpg",
    },
  },
];

export const localizeRuleTemplates = (getMessage: GetMessage): LocalizedRuleTemplate[] => {
  const categories: Record<RuleTemplate["category"], string> = {
    Media: getMessage("ruleTemplateCategoryMedia") || "Media",
    "File types": getMessage("ruleTemplateCategoryFileTypes") || "File types",
    "Date and sequence": getMessage("ruleTemplateCategoryDateAndSequence") || "Date and sequence",
    "Sites and URLs": getMessage("ruleTemplateCategorySitesAndUrls") || "Sites and URLs",
    "Save context": getMessage("ruleTemplateCategorySaveContext") || "Save context",
    "Site originals": getMessage("ruleTemplateCategorySiteOriginals") || "Site originals",
    "Site filing": getMessage("ruleTemplateCategorySiteFiling") || "Site filing",
  };
  const copy = new Map<string, { name: string; description: string }>([
    [
      "Images into per-site folders",
      {
        name: getMessage("ruleTemplateImagesPerSiteName") || "Images into per-site folders",
        description:
          getMessage("ruleTemplateImagesPerSiteDescription") ||
          "Sorts every saved image by the site it came from",
      },
    ],
    [
      "Videos into per-site folders",
      {
        name: getMessage("ruleTemplateVideosPerSiteName") || "Videos into per-site folders",
        description:
          getMessage("ruleTemplateVideosPerSiteDescription") ||
          "Sorts every saved video by the site it came from",
      },
    ],
    [
      "Audio into per-site folders",
      {
        name: getMessage("ruleTemplateAudioPerSiteName") || "Audio into per-site folders",
        description:
          getMessage("ruleTemplateAudioPerSiteDescription") ||
          "Groups saved audio by the page where it was found",
      },
    ],
    [
      "Screenshots by month",
      {
        name: getMessage("ruleTemplateScreenshotsByMonthName") || "Screenshots by month",
        description:
          getMessage("ruleTemplateScreenshotsByMonthDescription") ||
          "Keeps filenames beginning with screenshot in dated folders",
      },
    ],
    [
      "PDFs into a documents folder",
      {
        name: getMessage("ruleTemplatePdfsName") || "PDFs into a documents folder",
        description: getMessage("ruleTemplatePdfsDescription") || "Collects every PDF in one place",
      },
    ],
    [
      "PDFs by content type",
      {
        name: getMessage("ruleTemplatePdfsByContentTypeName") || "PDFs by content type",
        description:
          getMessage("ruleTemplatePdfsByContentTypeDescription") ||
          "Catches PDFs by their reported content type instead of the filename",
      },
    ],
    [
      "Archives into one folder",
      {
        name: getMessage("ruleTemplateArchivesName") || "Archives into one folder",
        description:
          getMessage("ruleTemplateArchivesDescription") ||
          "Collects zip, rar, 7z, tar, and compressed archives",
      },
    ],
    [
      "Documents into one folder",
      {
        name: getMessage("ruleTemplateDocumentsName") || "Documents into one folder",
        description:
          getMessage("ruleTemplateDocumentsDescription") ||
          "Collects common office and text documents",
      },
    ],
    [
      "E-books and comics",
      {
        name: getMessage("ruleTemplateEbooksName") || "E-books and comics",
        description:
          getMessage("ruleTemplateEbooksDescription") ||
          "Collects common e-book and digital comic formats",
      },
    ],
    [
      "Apps and installers",
      {
        name: getMessage("ruleTemplateInstallersName") || "Apps and installers",
        description:
          getMessage("ruleTemplateInstallersDescription") ||
          "Keeps desktop and mobile installation packages together",
      },
    ],
    [
      "Fonts into one folder",
      {
        name: getMessage("ruleTemplateFontsName") || "Fonts into one folder",
        description:
          getMessage("ruleTemplateFontsDescription") || "Collects desktop and web font files",
      },
    ],
    [
      "One folder per file extension",
      {
        name: getMessage("ruleTemplatePerExtensionName") || "One folder per file extension",
        description:
          getMessage("ruleTemplatePerExtensionDescription") ||
          "Captures the extension and uses it as a folder name",
      },
    ],
    [
      "Date-stamp every download",
      {
        name: getMessage("ruleTemplateDateStampName") || "Date-stamp every download",
        description:
          getMessage("ruleTemplateDateStampDescription") ||
          "Prefixes the original filename with the save date",
      },
    ],
    [
      "Daily inbox",
      {
        name: getMessage("ruleTemplateDailyInboxName") || "Daily inbox",
        description:
          getMessage("ruleTemplateDailyInboxDescription") ||
          "Creates one folder for each calendar day",
      },
    ],
    [
      "Downloads by month",
      {
        name: getMessage("ruleTemplateDownloadsByMonthName") || "Downloads by month",
        description:
          getMessage("ruleTemplateDownloadsByMonthDescription") ||
          "Creates year and month folders while keeping the original filename",
      },
    ],
    [
      "Weekly inbox",
      {
        name: getMessage("ruleTemplateWeeklyInboxName") || "Weekly inbox",
        description:
          getMessage("ruleTemplateWeeklyInboxDescription") ||
          "Creates one inbox folder for each ISO week",
      },
    ],
    [
      "Sequential archive",
      {
        name: getMessage("ruleTemplateSequentialArchiveName") || "Sequential archive",
        description:
          getMessage("ruleTemplateSequentialArchiveDescription") ||
          "Prefixes files with Save In's persistent download counter",
      },
    ],
    [
      "One site, one folder",
      {
        name: getMessage("ruleTemplateOneSiteName") || "One site, one folder",
        description:
          getMessage("ruleTemplateOneSiteDescription") ||
          "Routes one chosen website into its own folder",
      },
    ],
    [
      "One folder per source site",
      {
        name: getMessage("ruleTemplatePerSourceSiteName") || "One folder per source site",
        description:
          getMessage("ruleTemplatePerSourceSiteDescription") ||
          "Groups downloads by the hostname serving the file",
      },
    ],
    [
      "One folder per source root domain",
      {
        name:
          getMessage("ruleTemplatePerSourceRootDomainName") || "One folder per source root domain",
        description:
          getMessage("ruleTemplatePerSourceRootDomainDescription") ||
          "Combines downloads from subdomains of the same source site",
      },
    ],
    [
      "One folder per page site",
      {
        name: getMessage("ruleTemplatePerPageSiteName") || "One folder per page site",
        description:
          getMessage("ruleTemplatePerPageSiteDescription") ||
          "Groups files by the website you were browsing rather than the file host",
      },
    ],
    [
      "Page-title prefix",
      {
        name: getMessage("ruleTemplatePageTitlePrefixName") || "Page-title prefix",
        description:
          getMessage("ruleTemplatePageTitlePrefixDescription") ||
          "Adds a filesystem-safe page title before the original filename",
      },
    ],
    [
      "Capture part of the URL",
      {
        name: getMessage("ruleTemplateCaptureUrlName") || "Capture part of the URL",
        description:
          getMessage("ruleTemplateCaptureUrlDescription") ||
          "Uses a regex capture group in the saved filename",
      },
    ],
    [
      "Downloads from a site section",
      {
        name:
          getMessage("ruleTemplateDownloadsFromSiteSectionName") || "Downloads from a site section",
        description:
          getMessage("ruleTemplateDownloadsFromSiteSectionDescription") ||
          "Routes downloads referred from one URL section into its own folder",
      },
    ],
    [
      "Browser downloads inbox",
      {
        name: getMessage("ruleTemplateBrowserInboxName") || "Browser downloads inbox",
        description:
          getMessage("ruleTemplateBrowserInboxDescription") ||
          "Keeps tracked browser-owned downloads in a separate folder",
      },
    ],
    [
      "Link downloads inbox",
      {
        name: getMessage("ruleTemplateLinkInboxName") || "Link downloads inbox",
        description:
          getMessage("ruleTemplateLinkInboxDescription") ||
          "Separates files saved from links from embedded media",
      },
    ],
    [
      "Selected text inbox",
      {
        name: getMessage("ruleTemplateSelectionInboxName") || "Selected text inbox",
        description:
          getMessage("ruleTemplateSelectionInboxDescription") ||
          "Keeps files created from selected page text together",
      },
    ],
    [
      "Tab saves inbox",
      {
        name: getMessage("ruleTemplateTabInboxName") || "Tab saves inbox",
        description:
          getMessage("ruleTemplateTabInboxDescription") ||
          "Keeps files saved from tab actions together",
      },
    ],
    [
      "Twitter/X image originals",
      {
        name: getMessage("ruleTemplateTwitterOriginalsName") || "Twitter/X image originals",
        description:
          getMessage("ruleTemplateTwitterOriginalsDescription") ||
          "Rewrites Twitter and X image links to the original, full-resolution file",
      },
    ],
    [
      "Reddit image originals",
      {
        name: getMessage("ruleTemplateRedditOriginalsName") || "Reddit image originals",
        description:
          getMessage("ruleTemplateRedditOriginalsDescription") ||
          "Rewrites Reddit preview image links to the original file on i.redd.it",
      },
    ],
    [
      "Wikimedia full-size image",
      {
        name: getMessage("ruleTemplateWikimediaOriginalName") || "Wikimedia full-size image",
        description:
          getMessage("ruleTemplateWikimediaOriginalDescription") ||
          "Rewrites Wikimedia Commons thumbnail links to the original full-size file",
      },
    ],
    [
      "YouTube thumbnail max resolution",
      {
        name: getMessage("ruleTemplateYoutubeMaxResName") || "YouTube thumbnail max resolution",
        description:
          getMessage("ruleTemplateYoutubeMaxResDescription") ||
          "Rewrites YouTube thumbnail links to the maximum-resolution image",
      },
    ],
    [
      "Pixiv original-quality image",
      {
        name: getMessage("ruleTemplatePixivOriginalName") || "Pixiv original-quality image",
        description:
          getMessage("ruleTemplatePixivOriginalDescription") ||
          "Rewrites a Pixiv preview image to the full-resolution original file (needs the Referer option on for i.pximg.net)",
      },
    ],
    [
      "Twitter/X handle prefix",
      {
        name: getMessage("ruleTemplateTwitterHandlePrefixName") || "Twitter/X handle prefix",
        description:
          getMessage("ruleTemplateTwitterHandlePrefixDescription") ||
          "Prefixes saved files with the Twitter or X handle from the page URL",
      },
    ],
    [
      "Instagram username prefix",
      {
        name: getMessage("ruleTemplateInstagramUsernamePrefixName") || "Instagram username prefix",
        description:
          getMessage("ruleTemplateInstagramUsernamePrefixDescription") ||
          "Prefixes saved files with the Instagram username from the page title",
      },
    ],
    [
      "DeviantArt hashed-filename rename",
      {
        name: getMessage("ruleTemplateDeviantArtRenameName") || "DeviantArt hashed-filename rename",
        description:
          getMessage("ruleTemplateDeviantArtRenameDescription") ||
          "Renames DeviantArt's hashed download filename to the artwork title and short code",
      },
    ],
    [
      "Page path without the scheme",
      {
        name: getMessage("ruleTemplatePagePathNoSchemeName") || "Page path without the scheme",
        description:
          getMessage("ruleTemplatePagePathNoSchemeDescription") ||
          "Builds folders from the page URL's host and path while dropping the https:// scheme that otherwise corrupts filenames",
      },
    ],
    [
      "Slugged title rename",
      {
        name: getMessage("ruleTemplateSluggedTitleRenameName") || "Slugged title rename",
        description:
          getMessage("ruleTemplateSluggedTitleRenameDescription") ||
          "Replaces the filename with a lowercase, hyphenated slug of the page title, keeping the original extension (a general find-and-replace on filenames isn't supported)",
      },
    ],
  ]);

  return RULE_TEMPLATES.map((template) => ({
    ...template,
    category: categories[template.category],
    ...copy.get(template.name),
  }));
};
