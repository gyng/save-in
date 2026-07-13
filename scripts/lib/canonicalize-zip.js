const fs = require("fs");
const JSZip = require("jszip");

const UNIX_EPOCH = new Date(0);
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0, 0));

/** @param {Date} date */
function zipDateFor(date) {
  // JSZip writes a mandatory DOS date. Passing 1970 directly underflows its
  // seven-bit year field to 2098, so clamp only at this format boundary.
  return new Date(Math.max(date.getTime(), ZIP_EPOCH.getTime()));
}

const ARCHIVE_DATE = zipDateFor(UNIX_EPOCH);

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
  fs.utimesSync(archive, UNIX_EPOCH, UNIX_EPOCH);
}

module.exports = { canonicalizeZip, zipDateFor };
