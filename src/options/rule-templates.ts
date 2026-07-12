export type RuleTemplate = {
  category: "Media" | "File types" | "Date and sequence" | "Sites and URLs" | "Save context";
  name: string;
  description: string;
  rule: string;
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    category: "Media",
    name: "Images into per-site folders",
    description: "Sorts every saved image by the site it came from",
    rule: "mediatype: image\ninto: images/:pagedomain:/:filename:",
  },
  {
    category: "Media",
    name: "Videos into per-site folders",
    description: "Does the same for video files",
    rule: "mediatype: video\ninto: videos/:pagedomain:/:filename:",
  },
  {
    category: "Media",
    name: "Audio into per-site folders",
    description: "Groups saved audio by the page where it was found",
    rule: "mediatype: audio\ninto: audio/:pagedomain:/:filename:",
  },
  {
    category: "File types",
    name: "PDFs into a documents folder",
    description: "Collects every PDF in one place",
    rule: "fileext: pdf\ninto: documents/:filename:",
  },
  {
    category: "File types",
    name: "Archives into one folder",
    description: "Collects zip, rar, 7z, and tar archives",
    rule: "fileext: (zip|rar|7z|gz|tgz)\ninto: archives/:filename:",
  },
  {
    category: "File types",
    name: "Documents into one folder",
    description: "Collects common office and text documents",
    rule: "fileext: (pdf|docx?|odt|rtf|txt)\ninto: documents/:filename:",
  },
  {
    category: "File types",
    name: "One folder per file extension",
    description: "Captures the extension and uses it as a folder name",
    rule: "fileext: (.+)\ncapture: fileext\ninto: files/:$1:/:filename:",
  },
  {
    category: "Date and sequence",
    name: "Date-stamp every download",
    description: "Prefixes the original filename with the save date",
    rule: "sourceurl: .*\ninto: :date:-:filename:",
  },
  {
    category: "Date and sequence",
    name: "Daily inbox",
    description: "Creates one folder for each calendar day",
    rule: "sourceurl: .*\ninto: inbox/:year:/:month:/:day:/:filename:",
  },
  {
    category: "Date and sequence",
    name: "Downloads by month",
    description: "Creates year and month folders while keeping the original filename",
    rule: "sourceurl: .*\ninto: archive/:year:/:month:/:filename:",
  },
  {
    category: "Date and sequence",
    name: "Weekly inbox",
    description: "Creates one inbox folder for each ISO week",
    rule: "sourceurl: .*\ninto: inbox/:year:-w:isoweek:/:filename:",
  },
  {
    category: "Date and sequence",
    name: "Sequential archive",
    description: "Prefixes files with Save In's persistent download counter",
    rule: "sourceurl: .*\ninto: archive/:counter:-:filename:",
  },
  {
    category: "Sites and URLs",
    name: "One site, one folder",
    description: "Routes one chosen website into its own folder",
    rule: "pagedomain: example\\.com\ninto: example/:pagetitleslug:/:filename:",
  },
  {
    category: "Sites and URLs",
    name: "One folder per source site",
    description: "Groups downloads by the hostname serving the file",
    rule: "sourceurl: .*\ninto: sites/:sourcedomain:/:filename:",
  },
  {
    category: "Sites and URLs",
    name: "Page-title prefix",
    description: "Adds a filesystem-safe page title before the original filename",
    rule: "sourceurl: .*\ninto: pages/:pagetitleslug:-:filename:",
  },
  {
    category: "Sites and URLs",
    name: "Capture part of the URL",
    description: "Uses a regex capture group in the saved filename",
    rule: "sourceurl: imgur\\.com/(\\w+)\ncapture: sourceurl\ninto: imgur/:$1:-:filename:",
  },
  {
    category: "Save context",
    name: "Browser downloads inbox",
    description: "Keeps tracked browser-owned downloads in a separate folder",
    rule: "context: browser\ninto: browser-downloads/:filename:",
  },
  {
    category: "Save context",
    name: "Link downloads inbox",
    description: "Separates files saved from links from embedded media",
    rule: "context: link\ninto: links/:filename:",
  },
  {
    category: "Save context",
    name: "Tab saves inbox",
    description: "Keeps files saved from tab actions together",
    rule: "context: tab\ninto: tabs/:filename:",
  },
];
