import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { sanitizePng } from "../scripts/lib/sanitize-png.mjs";

const chunk = (type, body = Buffer.alloc(0)) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(tb));
  return Buffer.concat([len, tb, crc]);
};
const ihdr = (w, h) => { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 6; return chunk("IHDR", b); };
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (...extra) => Buffer.concat([SIG, ihdr(1, 1), ...extra, chunk("IDAT", zlib.deflateSync(Buffer.alloc(5))), chunk("IEND")]);

test("valid png passes and metadata chunks are dropped", () => {
  const r = sanitizePng(png(chunk("tEXt", Buffer.from("Author\0someone@example.com")), chunk("eXIf", Buffer.from("gps"))));
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.png.toString("latin1"), /tEXt|eXIf|someone@example/);
  assert.equal(sanitizePng(r.png).ok, true);
});
test("bad CRC is rejected", () => {
  const b = png(); b[b.length - 1] ^= 0xff;
  assert.equal(sanitizePng(b).ok, false);
});
test("non-png and truncated are rejected", () => {
  assert.equal(sanitizePng(Buffer.from("<svg/>")).ok, false);
  assert.equal(sanitizePng(png().subarray(0, 40)).ok, false);
});
test("oversized dimensions are rejected", () => {
  const b = Buffer.concat([SIG, ihdr(100000, 1), chunk("IDAT", zlib.deflateSync(Buffer.alloc(5))), chunk("IEND")]);
  assert.equal(sanitizePng(b).ok, false);
});
import { decodeToRgba } from "../scripts/lib/sanitize-png.mjs";

/** Build a PNG from RGBA pixels (colour type 6, filter 0). */
const rgbaPng = (w, h, px) => {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a] = px(x, y); raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4); }
  return Buffer.concat([SIG, ihdr(w, h), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND")]);
};
const decode = (b) => { const w = b.readUInt32BE(16), h = b.readUInt32BE(20); const idat = []; for (let p = 8; p < b.length;) { const l = b.readUInt32BE(p); if (b.toString("latin1", p + 4, p + 8) === "IDAT") idat.push(b.subarray(p + 8, p + 8 + l)); p += 12 + l; } return { w, h, ct: b[25], px: decodeToRgba({ width: w, height: h, depth: b[24], ctype: b[25], interlace: b[28] }, Buffer.concat(idat), {}) }; };

test("oversized input (> 6 MiB, > 8192 px, > 40 MP) is rejected as a decompression-bomb guard", () => {
  assert.equal(sanitizePng(Buffer.concat([SIG, ihdr(8000, 8000), chunk("IDAT", zlib.deflateSync(Buffer.alloc(5))), chunk("IEND")])).reason, "bad-dimensions");
  assert.equal(sanitizePng(Buffer.concat([SIG, ihdr(9000, 10), chunk("IEND")])).reason, "bad-dimensions");
  assert.equal(sanitizePng(Buffer.alloc(6 * 1024 * 1024 + 1)).reason, "input-too-large");
});
test("large PNG is downscaled to 512 px longest side, aspect kept, <= 256 KiB, alpha kept", () => {
  const src = rgbaPng(1600, 800, (x, y) => (x < 800 ? [255, 0, 0, 255] : [0, 0, 255, 0]));
  const r = sanitizePng(src);
  assert.equal(r.ok, true);
  assert.deepEqual([r.width, r.height], [512, 256]);
  assert.ok(r.png.length <= 256 * 1024);
  const d = decode(r.png);
  assert.deepEqual([d.w, d.h], [512, 256]);
  assert.deepEqual([...d.px.subarray(0, 4)], [255, 0, 0, 255]);
  const last = (255 * 512 + 511) * 4;
  assert.equal(d.px[last + 3], 0);
});
test("small PNG is passed through untouched (no re-encode)", () => {
  const r = sanitizePng(png());
  assert.equal(r.ok, true);
  assert.deepEqual([r.width, r.height], [1, 1]);
});
test("incompressible noise that cannot fit 256 KiB is rejected, not served", () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
  const noise = rgbaPng(600, 600, () => [rnd(), rnd(), rnd(), 255]);
  assert.equal(sanitizePng(noise).ok, false);
});
test("palette image with tRNS is expanded and scaled", () => {
  const w = 1000, h = 1000, raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = x < 500 ? 0 : 1;
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 3;
  const b = Buffer.concat([SIG, chunk("IHDR", ih), chunk("PLTE", Buffer.from([10, 20, 30, 0, 0, 0])), chunk("tRNS", Buffer.from([255, 0])), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND")]);
  const r = sanitizePng(b);
  assert.equal(r.ok, true);
  const d = decode(r.png);
  assert.deepEqual([d.w, d.h], [512, 512]);
  assert.deepEqual([...d.px.subarray(0, 4)], [10, 20, 30, 255]);
  assert.equal(d.px[(511) * 4 + 3], 0);
});
