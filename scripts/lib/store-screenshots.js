// @ts-check

const { deflateSync, inflateSync } = require("zlib");

const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;

const SCREENSHOTS = Object.freeze([
  Object.freeze({
    filename: "01-downloads-menu.png",
    description: "Configured directories and the live menu preview",
  }),
  Object.freeze({
    filename: "02-routing-rules.png",
    description: "Pattern-based routing and renaming rules",
  }),
  Object.freeze({
    filename: "03-page-sources.png",
    description: "Page Sources open on a representative media page",
  }),
  Object.freeze({
    filename: "04-history.png",
    description: "Searchable download history with routed results",
  }),
  Object.freeze({
    filename: "05-rule-debugger.png",
    description: "Route debugger showing why a rule matched and the final filename",
  }),
]);

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

/** @param {Buffer} png @param {string} [filename] */
const assertPngDimensions = (png, filename = "Screenshot") => {
  if (
    !Buffer.isBuffer(png) ||
    png.length < 24 ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    png.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error(`${filename} is not a PNG`);
  }

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== SCREENSHOT_WIDTH || height !== SCREENSHOT_HEIGHT) {
    throw new Error(
      `${filename} is ${width}x${height}; expected ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}`,
    );
  }
};

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  return current >>> 0;
});

/** @param {Buffer} buffer */
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** @param {string} type @param {Buffer} data */
const pngChunk = (type, data) => {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
};

/** @param {Buffer} png */
const optimizePngLosslessly = (png) => {
  if (
    !Buffer.isBuffer(png) ||
    png.length < 24 ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("Image is not a PNG");
  }

  const chunks = [];
  for (let offset = PNG_SIGNATURE.length; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error("PNG has a truncated chunk");
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error("PNG has a truncated chunk");
    chunks.push({
      type: png.toString("ascii", offset + 4, offset + 8),
      data: png.subarray(offset + 8, offset + 8 + length),
      raw: png.subarray(offset, end),
    });
    offset = end;
  }

  const imageData = Buffer.concat(
    chunks.filter(({ type }) => type === "IDAT").map(({ data }) => data),
  );
  if (imageData.length === 0) throw new Error("PNG has no image data");
  const recompressed = deflateSync(inflateSync(imageData), { level: 9 });
  let wroteImageData = false;
  const optimizedChunks = chunks.flatMap(({ type, raw }) => {
    if (type !== "IDAT") return [raw];
    if (wroteImageData) return [];
    wroteImageData = true;
    return [pngChunk("IDAT", recompressed)];
  });
  const optimized = Buffer.concat([PNG_SIGNATURE, ...optimizedChunks]);
  const output = optimized.length < png.length ? optimized : png;
  return { png: output, savedBytes: png.length - output.length };
};

module.exports = {
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
  SCREENSHOTS,
  assertPngDimensions,
  optimizePngLosslessly,
};
