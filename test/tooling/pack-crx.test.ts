import { beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { packCrx, packRelease, extensionId } = require("../../scripts/pack-crx.js");

// One 2048-bit keypair for the whole file: generating RSA keys is the only
// slow thing here, and none of these cases need a distinct identity.
let privateKeyPem: string;
let publicKeyDer: Buffer;

beforeAll(() => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  publicKeyDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
});

const zip = Buffer.from("PK\x03\x04 pretend archive");

describe("pack-crx", () => {
  it("wraps the archive in a CRX3 container", () => {
    const { crx } = packCrx({ zip, privateKeyPem });

    expect(crx.subarray(0, 4).toString("ascii")).toBe("Cr24");
    expect(crx.readUInt32LE(4)).toBe(3);
  });

  it("leaves the packaged archive byte-identical", () => {
    const { crx } = packCrx({ zip, privateKeyPem });

    // The point of prepending a header to the built ZIP rather than rebuilding
    // one: what the stores review and what a CRX installs are the same bytes.
    const header = crx.readUInt32LE(8);
    expect(crx.subarray(12 + header)).toEqual(zip);
  });

  it("signs over the archive, so a swapped payload no longer verifies", () => {
    const { crx } = packCrx({ zip, privateKeyPem });
    const header = crx.readUInt32LE(8);
    const signedHeaderData = Buffer.concat([
      Buffer.from([0x0a, 0x10]),
      crypto.createHash("sha256").update(publicKeyDer).digest().subarray(0, 16),
    ]);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(signedHeaderData.length, 0);
    // Recover the signature from the proof rather than re-deriving it, so this
    // checks the bytes a browser would read.
    const proof = crx.subarray(12, 12 + header);
    const marker = proof.indexOf(Buffer.from([0x12, 0x80, 0x02]));
    const signature = proof.subarray(marker + 3, marker + 3 + 256);

    const verify = (payload: Buffer) =>
      crypto
        .createVerify("sha256")
        .update(Buffer.from("CRX3 SignedData\x00", "binary"))
        .update(length)
        .update(signedHeaderData)
        .update(payload)
        .verify(crypto.createPublicKey(privateKeyPem), signature);

    expect(verify(zip)).toBe(true);
    expect(verify(Buffer.from("PK\x03\x04 tampered archive"))).toBe(false);
  });

  it("derives the same id Chromium shows, and the same one every build", () => {
    const first = packCrx({ zip, privateKeyPem });
    const second = packCrx({ zip: Buffer.from("PK\x03\x04 a later version"), privateKeyPem });

    // Chromium maps the leading 16 digest bytes from hex onto a-p. The id must
    // follow the key and nothing else: it is the installed extension's
    // identity, and settings are stored against it, so a release that changed
    // it would read as a different extension and lose every stored value.
    const expected = crypto
      .createHash("sha256")
      .update(publicKeyDer)
      .digest()
      .subarray(0, 16)
      .toString("hex")
      .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));

    expect(first.id).toBe(expected);
    expect(first.id).toMatch(/^[a-p]{32}$/);
    expect(second.id).toBe(first.id);
  });

  it("is reproducible for one key and archive", () => {
    expect(packCrx({ zip, privateKeyPem }).crx).toEqual(packCrx({ zip, privateKeyPem }).crx);
  });

  it("refuses to pack a runtime package that was never built", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "save-in-crx-"));
    try {
      fs.mkdirSync(path.join(root, "web-ext-artifacts"));
      expect(() => packRelease(root, "4.0.0", privateKeyPem)).toThrow("Missing runtime package");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("names the packed file for the browsers that can install it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "save-in-crx-"));
    try {
      fs.mkdirSync(path.join(root, "web-ext-artifacts"));
      fs.writeFileSync(path.join(root, "web-ext-artifacts", "save-in-4.0.0.zip"), zip);

      const { output, id } = packRelease(root, "4.0.0", privateKeyPem);

      expect(path.basename(output)).toBe("save-in-4.0.0-chromium.crx");
      expect(extensionId(publicKeyDer)).toBe(id);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
