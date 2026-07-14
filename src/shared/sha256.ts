const INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

const uint32At = (values: Uint32Array, index: number): number => {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing 32-bit word at index ${index}`);
  return value;
};

export class Sha256 {
  readonly #state = new Uint32Array(INITIAL_STATE);
  readonly #buffer = new Uint8Array(64);
  readonly #words = new Uint32Array(64);
  #bufferLength = 0;
  #bytesHashed = 0;
  #finalized = false;
  #hex: string | undefined;

  update(data: Uint8Array): this {
    if (this.#finalized) throw new Error("SHA-256 has already been finalized");
    this.#bytesHashed += data.byteLength;
    let offset = 0;

    if (this.#bufferLength > 0) {
      const length = Math.min(64 - this.#bufferLength, data.byteLength);
      this.#buffer.set(data.subarray(0, length), this.#bufferLength);
      this.#bufferLength += length;
      offset += length;
      if (this.#bufferLength === 64) {
        this.#transform(this.#buffer, 0);
        this.#bufferLength = 0;
      }
    }

    while (offset + 64 <= data.byteLength) {
      this.#transform(data, offset);
      offset += 64;
    }
    if (offset < data.byteLength) {
      this.#buffer.set(data.subarray(offset));
      this.#bufferLength = data.byteLength - offset;
    }
    return this;
  }

  hex(): string {
    if (this.#hex) return this.#hex;
    this.#finalized = true;
    const finalLength = this.#bufferLength < 56 ? 64 : 128;
    const finalBlock = new Uint8Array(finalLength);
    finalBlock.set(this.#buffer.subarray(0, this.#bufferLength));
    finalBlock[this.#bufferLength] = 0x80;

    const bitHigh = Math.floor(this.#bytesHashed / 0x20000000) >>> 0;
    const bitLow = (this.#bytesHashed * 8) >>> 0;
    const lengthView = new DataView(finalBlock.buffer);
    lengthView.setUint32(finalLength - 8, bitHigh);
    lengthView.setUint32(finalLength - 4, bitLow);
    this.#transform(finalBlock, 0);
    if (finalLength === 128) this.#transform(finalBlock, 64);

    this.#hex = [...this.#state].map((word) => word.toString(16).padStart(8, "0")).join("");
    return this.#hex;
  }

  #transform(chunk: Uint8Array, offset: number): void {
    const words = this.#words;
    const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = chunkView.getUint32(position);
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = uint32At(words, index - 15);
      const before2 = uint32At(words, index - 2);
      const sigma0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const sigma1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      words[index] =
        (uint32At(words, index - 16) + sigma0 + uint32At(words, index - 7) + sigma1) >>> 0;
    }

    let a = uint32At(this.#state, 0);
    let b = uint32At(this.#state, 1);
    let c = uint32At(this.#state, 2);
    let d = uint32At(this.#state, 3);
    let e = uint32At(this.#state, 4);
    let f = uint32At(this.#state, 5);
    let g = uint32At(this.#state, 6);
    let h = uint32At(this.#state, 7);
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + sum1 + choice + uint32At(ROUND_CONSTANTS, index) + uint32At(words, index)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.#state[0] = (uint32At(this.#state, 0) + a) >>> 0;
    this.#state[1] = (uint32At(this.#state, 1) + b) >>> 0;
    this.#state[2] = (uint32At(this.#state, 2) + c) >>> 0;
    this.#state[3] = (uint32At(this.#state, 3) + d) >>> 0;
    this.#state[4] = (uint32At(this.#state, 4) + e) >>> 0;
    this.#state[5] = (uint32At(this.#state, 5) + f) >>> 0;
    this.#state[6] = (uint32At(this.#state, 6) + g) >>> 0;
    this.#state[7] = (uint32At(this.#state, 7) + h) >>> 0;
  }
}
