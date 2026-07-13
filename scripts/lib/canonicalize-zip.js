const fs = require("fs");
const JSZip = require("jszip");

// ZIP timestamps are presentation metadata, not part of the extension. A
// constant local date avoids timezone conversion changing the DOS date fields.
const ARCHIVE_DATE = new Date(1980, 0, 1, 0, 0, 0, 0);

/** @param {string} archive */
async function canonicalizeZip(archive) {
  const source = await JSZip.loadAsync(fs.readFileSync(archive));
  const output = new JSZip();
  for (const name of Object.keys(source.files).toSorted()) {
    const entry = source.files[name];
    if (!entry) continue;
    const contents = entry.dir ? Buffer.alloc(0) : await entry.async("nodebuffer");
    output.file(name, contents, {
      createFolders: false,
      date: ARCHIVE_DATE,
      dir: entry.dir,
    });
  }
  const contents = await output.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "DOS",
    streamFiles: false,
    type: "nodebuffer",
  });
  fs.writeFileSync(archive, contents);
}

module.exports = { canonicalizeZip };
