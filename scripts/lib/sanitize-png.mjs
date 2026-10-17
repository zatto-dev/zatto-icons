// PNG sanitizer: verifies structure and CRCs, keeps only rendering chunks (drops text/EXIF/ICC/APNG metadata).
import zlib from "node:zlib";

export const PNG_LIMITS = { maxBytes: 1024 * 1024, maxDim: 4096 };
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KEEP = new Set(["IHDR", "PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "IDAT", "IEND"]);

/** @returns {{ok: true, png: Buffer, width: number, height: number} | {ok: false, reason: string}} */
export function sanitizePng(buf) {
  if (buf.length > PNG_LIMITS.maxBytes * 4) return { ok: false, reason: "input-too-large" };
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return { ok: false, reason: "not-png" };
  const out = [SIGNATURE];
  let pos = 8, width = 0, height = 0, sawIdat = false, sawEnd = false, first = true;
  while (pos + 12 <= buf.length && !sawEnd) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (len > 0x7fffffff || end > buf.length) return { ok: false, reason: "truncated" };
    const body = buf.subarray(pos + 8, pos + 8 + len);
    const crc = buf.readUInt32BE(pos + 8 + len);
    if (zlib.crc32(buf.subarray(pos + 4, pos + 8 + len)) !== crc) return { ok: false, reason: "bad-crc" };
    if (first) {
      if (type !== "IHDR" || len !== 13) return { ok: false, reason: "no-ihdr" };
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (!width || !height || width > PNG_LIMITS.maxDim || height > PNG_LIMITS.maxDim) return { ok: false, reason: "bad-dimensions" };
      first = false;
    }
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") sawEnd = true;
    if (KEEP.has(type)) out.push(buf.subarray(pos, end));
    pos = end;
  }
  if (!sawIdat || !sawEnd) return { ok: false, reason: "incomplete" };
  const png = Buffer.concat(out);
  if (png.length > PNG_LIMITS.maxBytes) return { ok: false, reason: "too-large" };
  return { ok: true, png, width, height };
}
