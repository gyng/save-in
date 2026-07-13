import { Sha256 } from "../src/shared/sha256.ts";

const encode = (value: string) => new TextEncoder().encode(value);

test("incrementally hashes the NIST abc vector across arbitrary chunks", () => {
  const hash = new Sha256();
  hash.update(encode("a"));
  hash.update(encode("b"));
  hash.update(encode("c"));

  expect(hash.hex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("hashes data spanning multiple SHA-256 blocks", () => {
  const hash = new Sha256();
  const chunk = encode("a".repeat(1000));
  for (let index = 0; index < 1000; index += 1) hash.update(chunk);

  expect(hash.hex()).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});

test("does not allow updates after finalization", () => {
  const hash = new Sha256();
  hash.update(encode("abc"));
  hash.hex();

  expect(() => hash.update(encode("d"))).toThrow("finalized");
});
