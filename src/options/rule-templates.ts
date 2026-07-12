export type RuleTemplate = {
  category: "Media" | "File types" | "Date and sequence" | "Sites and URLs" | "Save context";
  name: string;
  description: string;
  example: string;
  rule: string;
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    category: "Media",
    name: "Images into per-site folders",
    description: "Sorts every saved image by the site it came from",
    example: "Example: images/example.com/photo.jpg",
    rule: "mediatype: image\ninto: images/:pagedomain:/:filename:",
  },
  {
    category: "Media",
    name: "Videos into per-site folders",
    description: "Does the same for video files",
    example: "Example: videos/example.com/clip.mp4",
    rule: "mediatype: video\ninto: videos/:pagedomain:/:filename:",
  },
  {
    category: "Media",
    name: "Audio into per-site folders",
    description: "Groups saved audio by the page where it was found",
    example: "Example: audio/example.com/podcast.mp3",
    rule: "mediatype: audio\ninto: audio/:pagedomain:/:filename:",
  },
  {
    category: "File types",
    name: "PDFs into a documents folder",
    description: "Collects every PDF in one place",
    example: "Example: documents/report.pdf",
    rule: "fileext: pdf\ninto: documents/:filename:",
  },
  {
    category: "File types",
    name: "Archives into one folder",
    description: "Collects zip, rar, 7z, and tar archives",
    example: "Example: archives/project.zip",
    rule: "fileext: (zip|rar|7z|gz|tgz)\ninto: archives/:filename:",
  },
  {
    category: "File types",
    name: "Documents into one folder",
    description: "Collects common office and text documents",
    example: "Example: documents/notes.txt",
    rule: "fileext: (pdf|docx?|odt|rtf|txt)\ninto: documents/:filename:",
  },
  {
    category: "File types",
    name: "One folder per file extension",
    description: "Captures the extension and uses it as a folder name",
    example: "Example: files/png/screenshot.png",
    rule: "fileext: (.+)\ncapture: fileext\ninto: files/:$1:/:filename:",
  },
  {
    category: "Date and sequence",
    name: "Date-stamp every download",
    description: "Prefixes the original filename with the save date",
    example: "Example: 2026-07-12-report.pdf",
    rule: "sourceurl: .*\ninto: :date:-:filename:",
  },
  {
    category: "Date and sequence",
    name: "Daily inbox",
    description: "Creates one folder for each calendar day",
    example: "Example: inbox/2026/07/12/report.pdf",
    rule: "sourceurl: .*\ninto: inbox/:year:/:month:/:day:/:filename:",
  },
  {
    category: "Date and sequence",
    name: "Downloads by month",
    description: "Creates year and month folders while keeping the original filename",
    example: "Example: archive/2026/07/report.pdf",
    rule: "sourceurl: .*\ninto: archive/:year:/:month:/:filename:",
  },
  {
    category: "Date and sequence",
    name: "Weekly inbox",
    description: "Creates one inbox folder for each ISO week",
    example: "Example: inbox/2026-w28/report.pdf",
    rule: "sourceurl: .*\ninto: inbox/:year:-w:isoweek:/:filename:",
  },
  {
    category: "Date and sequence",
    name: "Sequential archive",
    description: "Prefixes files with Save In's persistent download counter",
    example: "Example: archive/42-report.pdf",
    rule: "sourceurl: .*\ninto: archive/:counter:-:filename:",
  },
  {
    category: "Sites and URLs",
    name: "One site, one folder",
    description: "Routes one chosen website into its own folder",
    example: "Example: example/an-interesting-page/report.pdf",
    rule: "pagedomain: example\\.com\ninto: example/:pagetitleslug:/:filename:",
  },
  {
    category: "Sites and URLs",
    name: "One folder per source site",
    description: "Groups downloads by the hostname serving the file",
    example: "Example: sites/cdn.example.com/photo.jpg",
    rule: "sourceurl: .*\ninto: sites/:sourcedomain:/:filename:",
  },
  {
    category: "Sites and URLs",
    name: "Page-title prefix",
    description: "Adds a filesystem-safe page title before the original filename",
    example: "Example: pages/an-interesting-page-report.pdf",
    rule: "sourceurl: .*\ninto: pages/:pagetitleslug:-:filename:",
  },
  {
    category: "Sites and URLs",
    name: "Capture part of the URL",
    description: "Uses a regex capture group in the saved filename",
    example: "Example: imgur/abc123-photo.jpg",
    rule: "sourceurl: imgur\\.com/(\\w+)\ncapture: sourceurl\ninto: imgur/:$1:-:filename:",
  },
  {
    category: "Save context",
    name: "Browser downloads inbox",
    description: "Keeps tracked browser-owned downloads in a separate folder",
    example: "Example: browser-downloads/archive.zip",
    rule: "context: browser\ninto: browser-downloads/:filename:",
  },
  {
    category: "Save context",
    name: "Link downloads inbox",
    description: "Separates files saved from links from embedded media",
    example: "Example: links/report.pdf",
    rule: "context: link\ninto: links/:filename:",
  },
  {
    category: "Save context",
    name: "Tab saves inbox",
    description: "Keeps files saved from tab actions together",
    example: "Example: tabs/page.html",
    rule: "context: tab\ninto: tabs/:filename:",
  },
];
