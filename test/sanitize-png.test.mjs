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
test("large but valid png (wide banner, >4096 px, >1 MiB) is accepted; absurd dimensions are not", () => {
  assert.equal(sanitizePng(Buffer.concat([SIG, ihdr(5088, 512), chunk("IDAT", zlib.deflateSync(Buffer.alloc(5))), chunk("IEND")])).ok, true);
  assert.equal(sanitizePng(Buffer.concat([SIG, ihdr(8000, 8000), chunk("IDAT", zlib.deflateSync(Buffer.alloc(5))), chunk("IEND")])).ok, false);
  const big = Buffer.concat([SIG, ihdr(1, 1), chunk("IDAT", Buffer.alloc(3 * 1024 * 1024, 7)), chunk("IEND")]);
  assert.equal(sanitizePng(big).ok, true);
});
