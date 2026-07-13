import type { RoutingDownloadInfo } from "../routing/rule-types.ts";

export type RuleTemplate = {
  category: "Media" | "File types" | "Date and sequence" | "Sites and URLs" | "Save context";
  name: string;
  description: string;
  example: string;
  rule: string;
  proof: { info: RoutingDownloadInfo; destination: string };
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
    rule: "pagedomain: (^|\\.)example\\.com$\ninto: example/:pagetitleslug:/:filename:",
    proof: {
      info: {
        pageUrl: "https://example.com/an-interesting-page",
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
];

export const localizeRuleTemplates = (getMessage: GetMessage): LocalizedRuleTemplate[] => {
  const categories: Record<RuleTemplate["category"], string> = {
    Media: getMessage("ruleTemplateCategoryMedia") || "Media",
    "File types": getMessage("ruleTemplateCategoryFileTypes") || "File types",
    "Date and sequence": getMessage("ruleTemplateCategoryDateAndSequence") || "Date and sequence",
    "Sites and URLs": getMessage("ruleTemplateCategorySitesAndUrls") || "Sites and URLs",
    "Save context": getMessage("ruleTemplateCategorySaveContext") || "Save context",
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
  ]);

  return RULE_TEMPLATES.map((template) => ({
    ...template,
    category: categories[template.category],
    ...copy.get(template.name),
  }));
};
