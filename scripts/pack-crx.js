// @ts-check

// Wraps the canonical runtime ZIP in a CRX3 container for Chromium-based
// browsers that still install extensions from a file.
//
// Chrome's own --pack-extension re-zips the source directory, which would put
// bytes we never built or attested inside the release. A CRX3 is just a signed
// header in front of a ZIP, so this prepends the header to the exact archive
// the stores receive: strip the header and the remainder is that ZIP, byte for
// byte. It also keeps the private key in memory -- --pack-extension-key can
// only read a file, and this key never needs to reach a CI disk.
//
// Format (https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/):
//   "Cr24" | uint32le version=3 | uint32le header length | header | ZIP

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CRX_MAGIC = Buffer.from("Cr24", "ascii");
const CRX_VERSION = 3;
// Signed alongside the payload so a signature cannot be lifted onto a
// different container format.
const SIGNATURE_CONTEXT = Buffer.from("CRX3 SignedData\x00", "binary");

/** @param {number} value */
function varint(value) {
  const bytes = [];
  let rest = value;
  do {
    // Seven bits per byte, high bit marking "more to come".
    const byte = rest & 0x7f;
    rest >>>= 7;
    bytes.push(rest > 0 ? byte | 0x80 : byte);
  } while (rest > 0);
  return Buffer.from(bytes);
}

/** @param {number} fieldNumber @param {Buffer} payload */
function lengthDelimited(fieldNumber, payload) {
  // Wire type 2: length-delimited. Every field this format uses is bytes.
  return Buffer.concat([varint((fieldNumber << 3) | 2), varint(payload.length), payload]);
}

/** @param {Buffer} publicKeyDer */
function crxId(publicKeyDer) {
  return crypto.createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
}

/** @param {Buffer} publicKeyDer */
function extensionId(publicKeyDer) {
  // Chromium renders the id as the first 16 digest bytes in hex with 0-9a-f
  // mapped onto a-p. The same id an unpacked load derives from its directory
  // path, which is why a packed build keeps one identity across machines.
  return [...crxId(publicKeyDer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
}

/** @param {{ zip: Buffer, privateKeyPem: string }} options */
function packCrx({ zip, privateKeyPem }) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  // Derived from the PEM rather than the KeyObject: createPublicKey returns
  // the matching public key for a private one, and it is the same key either
  // way.
  const publicKeyDer = crypto.createPublicKey(privateKeyPem).export({
    type: "spki",
    format: "der",
  });

  const signedHeaderData = lengthDelimited(1, crxId(publicKeyDer));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeaderData.length, 0);
  const signature = crypto
    .createSign("sha256")
    .update(SIGNATURE_CONTEXT)
    .update(length)
    .update(signedHeaderData)
    .update(zip)
    .sign(privateKey);

  const proof = Buffer.concat([lengthDelimited(1, publicKeyDer), lengthDelimited(2, signature)]);
  const header = Buffer.concat([
    lengthDelimited(2, proof), // sha256_with_rsa
    lengthDelimited(10000, signedHeaderData),
  ]);

  const preamble = Buffer.alloc(8);
  preamble.writeUInt32LE(CRX_VERSION, 0);
  preamble.writeUInt32LE(header.length, 4);
  return {
    crx: Buffer.concat([CRX_MAGIC, preamble, header, zip]),
    id: extensionId(publicKeyDer),
  };
}

/** @param {string} root @param {string} version @param {string} privateKeyPem */
function packRelease(root, version, privateKeyPem) {
  const artifacts = path.join(root, "web-ext-artifacts");
  const source = path.join(artifacts, `save-in-${version}.zip`);
  if (!fs.existsSync(source)) throw new Error(`Missing runtime package: ${source}`);

  const { crx, id } = packCrx({ zip: fs.readFileSync(source), privateKeyPem });
  const output = path.join(artifacts, `save-in-${version}-chromium.crx`);
  fs.writeFileSync(output, crx);
  return { output, id };
}

function main() {
  const root = path.join(__dirname, "..");
  const version = process.argv[2];
  if (!version) throw new Error("Missing version");

  const privateKeyPem = process.env.CRX_PRIVATE_KEY;
  if (!privateKeyPem) {
    // Signing is the maintainer's, not the build's. Without the key this is a
    // no-op so contributors and forks still get a complete local release.
    process.stdout.write("CRX_PRIVATE_KEY unset: skipping the Chromium CRX\n");
    return;
  }

  const { output, id } = packRelease(root, version, privateKeyPem);
  process.stdout.write(`Chromium CRX ready: ${output} (extension id ${id})\n`);
}

if (require.main === module) main();

module.exports = { packCrx, packRelease, extensionId };
