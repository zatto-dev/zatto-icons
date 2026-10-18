// PNG sanitizer: verifies structure and CRCs, keeps only rendering chunks (drops text/EXIF/ICC/APNG metadata) and
// keeps icons light: anything larger than OUT_LIMITS (512 px longest side / 256 KiB) is decoded, box-downscaled
// (aspect ratio kept) and re-encoded as plain 8-bit RGB(A). Input limits only guard against decompression bombs.
import zlib from "node:zlib";

export const PNG_LIMITS = { maxBytes: 6 * 1024 * 1024, maxDim: 8192, maxPixels: 40_000_000 }; // input
export const OUT_LIMITS = { maxEdge: 512, maxBytes: 256 * 1024 }; // output
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KEEP = new Set(["IHDR", "PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "IDAT", "IEND"]);
const VALID_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]; // x0,y0,dx,dy

/** @returns {{ok: true, png: Buffer, width: number, height: number} | {ok: false, reason: string}} */
export function sanitizePng(buf) {
  if (buf.length > PNG_LIMITS.maxBytes) return { ok: false, reason: "input-too-large" };
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return { ok: false, reason: "not-png" };
  const out = [SIGNATURE], idat = [], info = { plte: null, trns: null };
  const seen = new Set();
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0, sawIdat = false, idatDone = false, sawEnd = false, first = true;
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
      if (!width || !height || width > PNG_LIMITS.maxDim || height > PNG_LIMITS.maxDim || width * height > PNG_LIMITS.maxPixels) return { ok: false, reason: "bad-dimensions" };
      depth = body[8]; ctype = body[9]; interlace = body[12];
      if (!VALID_DEPTHS[ctype]?.includes(depth) || body[10] !== 0 || body[11] !== 0 || (interlace !== 0 && interlace !== 1)) return { ok: false, reason: "bad-ihdr" };
      first = false;
    } else if (type === "IHDR") return { ok: false, reason: "chunk-order" };
    // Ordering/uniqueness (PNG spec 5.6): KEEP chunks at most once (IDAT: one contiguous run), ancillary/PLTE before IDAT.
    if (KEEP.has(type)) {
      if (type === "IDAT") {
        if (idatDone) return { ok: false, reason: "chunk-order" };
        sawIdat = true;
      } else {
        if (sawIdat && !idatDone) idatDone = true;
        if (seen.has(type)) return { ok: false, reason: "duplicate-chunk" };
        seen.add(type);
        if (type !== "IEND" && type !== "IHDR" && sawIdat) return { ok: false, reason: "chunk-order" };
        if (type === "PLTE" && seen.has("tRNS")) return { ok: false, reason: "chunk-order" };
      }
    } else if (sawIdat) idatDone = true;
    if (type === "IDAT") idat.push(body);
    if (type === "PLTE") {
      if (ctype === 0 || ctype === 4 || len === 0 || len % 3 || len / 3 > 256 || (ctype === 3 && len / 3 > 1 << depth)) return { ok: false, reason: "bad-plte" };
      info.plte = body;
    }
    if (type === "tRNS") {
      const okLen = ctype === 0 ? len === 2 : ctype === 2 ? len === 6 : ctype === 3 ? info.plte && len <= info.plte.length / 3 : false;
      if (!okLen) return { ok: false, reason: "bad-trns" };
      info.trns = body;
    }
    if (type === "IEND") { sawEnd = true; if (len !== 0) return { ok: false, reason: "bad-iend" }; }
    if (KEEP.has(type)) out.push(buf.subarray(pos, end));
    pos = end;
  }
  if (!sawIdat || !sawEnd) return { ok: false, reason: "incomplete" };
  if (ctype === 3 && !info.plte) return { ok: false, reason: "no-plte" };

  // Always verify the zlib stream inflates to exactly the expected size, so corrupt IDAT is rejected even on the fast path.
  const hdr = { width, height, depth, ctype, interlace };
  const need = expectedRawSize(hdr);
  const idatAll = Buffer.concat(idat);
  try {
    const raw = zlib.inflateSync(idatAll, { maxOutputLength: need + 1024 });
    if (raw.length !== need) return { ok: false, reason: "bad-idat-length" };
  } catch (e) { return { ok: false, reason: `bad-idat:${e.code ?? e.message}` }; }

  const kept = Buffer.concat(out);
  if (Math.max(width, height) <= OUT_LIMITS.maxEdge && kept.length <= OUT_LIMITS.maxBytes) return { ok: true, png: kept, width, height };

  let rgba;
  try { rgba = decodeToRgba(hdr, idatAll, info); } catch (e) { return { ok: false, reason: `decode-failed:${e.message}` }; }
  const s = Math.min(1, OUT_LIMITS.maxEdge / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * s)), th = Math.max(1, Math.round(height * s));
  let png;
  try {
    const scaled = s < 1 ? downscale(rgba, width, height, tw, th) : rgba;
    png = encodeUnderLimit(scaled, tw, th);
  } catch (e) { return { ok: false, reason: `resize-failed:${e.message}` }; }
  if (!png) return { ok: false, reason: "too-large-after-resize" };
  return { ok: true, png, width: tw, height: th };
}

function passList({ width, height, interlace }) {
  return interlace ? ADAM7.map(([x0, y0, dx, dy]) => ({ x0, y0, dx, dy, pw: Math.ceil((width - x0) / dx), ph: Math.ceil((height - y0) / dy) })) : [{ x0: 0, y0: 0, dx: 1, dy: 1, pw: width, ph: height }];
}
/** Exact size of the inflated IDAT stream (filter bytes included, Adam7 aware). Exported for tests. */
export function expectedRawSize(h) {
  const ch = CHANNELS[h.ctype];
  let need = 0;
  for (const p of passList(h)) if (p.pw > 0 && p.ph > 0) need += p.ph * (1 + Math.ceil((p.pw * ch * h.depth) / 8));
  return need;
}

/** Decode any non-animated PNG (all colour types/depths, Adam7) to straight-alpha RGBA8. Exported for tests. */
export function decodeToRgba(h, idatData, { plte, trns }) {
  const { width, height, depth, ctype, interlace } = h;
  if (!(ctype in CHANNELS) || ![1, 2, 4, 8, 16].includes(depth)) throw new Error("unsupported-format");
  if (ctype === 3 && !plte) throw new Error("no-plte");
  const ch = CHANNELS[ctype], bpp = Math.max(1, (ch * depth) >> 3);
  const passes = passList(h);
  const need = expectedRawSize(h);
  const raw = zlib.inflateSync(idatData, { maxOutputLength: need + 1024 });
  if (raw.length < need) throw new Error("short-data");

  const rgba = new Uint8Array(width * height * 4);
  const max = (1 << Math.min(depth, 8)) - 1;
  const sample = (row, i) => {
    if (depth === 8) return row[i];
    if (depth === 16) return (row[2 * i] << 8) | row[2 * i + 1];
    const per = 8 / depth, shift = 8 - depth * ((i % per) + 1);
    return (row[Math.floor(i / per)] >> shift) & max;
  };
  const to8 = (v) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max));
  const key = trns && (ctype === 0 ? [trns.readUInt16BE(0)] : ctype === 2 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null);

  let off = 0;
  for (const p of passes) {
    if (p.pw <= 0 || p.ph <= 0) continue;
    const rb = Math.ceil((p.pw * ch * depth) / 8);
    let prev = new Uint8Array(rb);
    for (let y = 0; y < p.ph; y++) {
      const ft = raw[off++];
      const row = raw.subarray(off, off + rb);
      off += rb;
      unfilter(ft, row, prev, bpp);
      const o0 = ((p.y0 + y * p.dy) * width + p.x0) * 4;
      for (let x = 0; x < p.pw; x++) {
        const o = o0 + x * p.dx * 4;
        let r, g, b, a = 255;
        if (ctype === 0) { const v = sample(row, x); r = g = b = to8(v); if (key && v === key[0]) a = 0; }
        else if (ctype === 2) { const v0 = sample(row, 3 * x), v1 = sample(row, 3 * x + 1), v2 = sample(row, 3 * x + 2); r = to8(v0); g = to8(v1); b = to8(v2); if (key && v0 === key[0] && v1 === key[1] && v2 === key[2]) a = 0; }
        else if (ctype === 3) { const i = sample(row, x); r = plte[3 * i] ?? 0; g = plte[3 * i + 1] ?? 0; b = plte[3 * i + 2] ?? 0; if (trns && i < trns.length) a = trns[i]; }
        else if (ctype === 4) { r = g = b = to8(sample(row, 2 * x)); a = to8(sample(row, 2 * x + 1)); }
        else { r = to8(sample(row, 4 * x)); g = to8(sample(row, 4 * x + 1)); b = to8(sample(row, 4 * x + 2)); a = to8(sample(row, 4 * x + 3)); }
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      }
      prev = row;
    }
  }
  return rgba;
}

function unfilter(ft, row, prev, bpp) {
  const n = row.length;
  switch (ft) {
    case 0: break;
    case 1: for (let i = bpp; i < n; i++) row[i] = (row[i] + row[i - bpp]) & 255; break;
    case 2: for (let i = 0; i < n; i++) row[i] = (row[i] + prev[i]) & 255; break;
    case 3: for (let i = 0; i < n; i++) row[i] = (row[i] + (((i >= bpp ? row[i - bpp] : 0) + prev[i]) >> 1)) & 255; break;
    case 4: for (let i = 0; i < n; i++) row[i] = (row[i] + paeth(i >= bpp ? row[i - bpp] : 0, prev[i], i >= bpp ? prev[i - bpp] : 0)) & 255; break;
    default: throw new Error("bad-filter");
  }
}
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** Area-average (box) downscale in premultiplied alpha, streaming over source rows. */
function downscale(src, sw, sh, tw, th) {
  const acc = new Float32Array(tw * th * 4);
  const rowBuf = new Float32Array(tw * 4);
  const xs = sw / tw, ys = sh / th;
  for (let y = 0; y < sh; y++) {
    rowBuf.fill(0);
    for (let tx = 0; tx < tw; tx++) {
      const a0 = tx * xs, a1 = (tx + 1) * xs;
      let w = 0;
      for (let x = Math.floor(a0); x < Math.min(sw, Math.ceil(a1)); x++) {
        const cov = Math.min(a1, x + 1) - Math.max(a0, x);
        const i = (y * sw + x) * 4, al = src[i + 3] / 255;
        rowBuf[tx * 4] += src[i] * al * cov; rowBuf[tx * 4 + 1] += src[i + 1] * al * cov; rowBuf[tx * 4 + 2] += src[i + 2] * al * cov; rowBuf[tx * 4 + 3] += al * cov;
        w += cov;
      }
      for (let k = 0; k < 4; k++) rowBuf[tx * 4 + k] /= w;
    }
    const b0 = y / ys, b1 = (y + 1) / ys; // output rows touched by source row y (unit-height source row)
    for (let ty = Math.floor(b0); ty < Math.min(th, Math.ceil(b1)); ty++) {
      const cov = Math.min(b1, ty + 1) - Math.max(b0, ty);
      if (cov <= 0) continue;
      for (let i = 0; i < tw * 4; i++) acc[ty * tw * 4 + i] += rowBuf[i] * cov;
    }
  }
  const out = new Uint8Array(tw * th * 4);
  // vertical coverage weights (output units) sum to 1 per output row, so acc is already an average
  for (let p = 0; p < tw * th; p++) {
    const a = acc[p * 4 + 3];
    const al = Math.min(1, a);
    out[p * 4 + 3] = Math.round(al * 255);
    if (a > 1e-6) for (let k = 0; k < 3; k++) out[p * 4 + k] = Math.max(0, Math.min(255, Math.round(acc[p * 4 + k] / a)));
  }
  return out;
}

/** Encode RGBA as 8-bit RGB(A) PNG; progressively coarser colour quantization until it fits OUT_LIMITS.maxBytes. */
function encodeUnderLimit(rgba, w, h) {
  const opaque = (() => { for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false; return true; })();
  for (const bits of [8, 6, 5, 4, 3]) {
    const png = encode(bits === 8 ? rgba : quantize(rgba, bits), w, h, opaque);
    if (png.length <= OUT_LIMITS.maxBytes) return png;
  }
  return null;
}
function quantize(rgba, bits) {
  const L = (1 << bits) - 1, out = new Uint8Array(rgba);
  for (let i = 0; i < out.length; i += 4) for (let k = 0; k < 3; k++) out[i + k] = Math.round((Math.round((out[i + k] * L) / 255) * 255) / L);
  return out;
}
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
function encode(rgba, w, h, opaque) {
  const ch = opaque ? 3 : 4, rb = w * ch;
  const raw = Buffer.alloc(h * (rb + 1));
  const cur = new Uint8Array(rb);
  let prev = new Uint8Array(rb);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(rb));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let k = 0; k < ch; k++) cur[x * ch + k] = rgba[(y * w + x) * 4 + k];
    let best = 0, bestScore = Infinity;
    for (let ft = 0; ft < 5; ft++) {
      const c = cand[ft];
      let score = 0;
      for (let i = 0; i < rb; i++) {
        const a = i >= ch ? cur[i - ch] : 0, b = prev[i], cc = i >= ch ? prev[i - ch] : 0;
        const pred = ft === 0 ? 0 : ft === 1 ? a : ft === 2 ? b : ft === 3 ? (a + b) >> 1 : paeth(a, b, cc);
        const v = (cur[i] - pred) & 255;
        c[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = ft; }
    }
    raw[y * (rb + 1)] = best;
    raw.set(cand[best], y * (rb + 1) + 1);
    prev = Uint8Array.from(cur);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
