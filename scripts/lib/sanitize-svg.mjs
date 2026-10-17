// SVG sanitizer: strict allow-list of elements/attributes, then svgo, then an independent re-validation.
//
// Policy (see docs/DESIGN.md):
//  - REJECT the whole file: oversized, unparsable, DOCTYPE other than a plain W3C public DOCTYPE,
//    any ENTITY/ELEMENT/ATTLIST declaration, xml-stylesheet processing instruction, no drawable content left.
//  - STRIP (file kept): elements and attributes outside the allow-list (script, foreignObject, animation,
//    editor metadata, on* handlers, ...), any href other than "#id" (or a data:image raster on <image>),
//    any url() that is not "#id", dangerous CSS.
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { optimize } from "svgo";

export const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export const LIMITS = {
  maxInputBytes: 2 * 1024 * 1024,
  maxOutputBytes: 512 * 1024,
  maxNodes: 10_000,
  maxDepth: 32,
  maxUse: 500,
};

const ELEMENTS = new Set(`svg g defs symbol use switch path rect circle ellipse line polyline polygon text tspan
title desc style image linearGradient radialGradient stop clipPath mask pattern marker filter
feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap
feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode
feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence`.split(/\s+/));

// Elements that are dropped but whose children are kept.
const UNWRAP = new Set(["a"]);
// Elements that draw something (used to detect "nothing left").
const DRAWABLE = new Set("path rect circle ellipse line polyline polygon text image use".split(" "));

const ATTRS = new Set(`d x y width height cx cy r rx ry x1 x2 y1 y2 points dx dy rotate fx fy fr viewBox
preserveAspectRatio transform gradientTransform patternTransform gradientUnits patternUnits patternContentUnits
clipPathUnits maskUnits maskContentUnits primitiveUnits filterUnits offset spreadMethod markerWidth markerHeight
markerUnits refX refY orient id class style version baseProfile xml:space role aria-label aria-hidden
aria-labelledby aria-describedby href xlink:href
fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray
stroke-dashoffset stroke-opacity opacity stop-color stop-opacity clip-path clip-rule mask mask-type filter
flood-color flood-opacity color color-interpolation color-interpolation-filters display visibility overflow
isolation mix-blend-mode shape-rendering text-rendering image-rendering vector-effect paint-order
transform-origin font-family font-size font-style font-weight font-variant letter-spacing word-spacing
text-anchor dominant-baseline baseline-shift text-decoration writing-mode direction marker-start marker-mid
marker-end enable-background lighting-color
in in2 result type values mode operator k1 k2 k3 k4 stdDeviation baseFrequency numOctaves seed slope intercept
amplitude exponent tableValues order kernelMatrix divisor bias targetX targetY edgeMode scale xChannelSelector
yChannelSelector surfaceScale diffuseConstant specularConstant specularExponent kernelUnitLength radius azimuth
elevation z pointsAtX pointsAtY pointsAtZ limitingConeAngle stitchTiles`.split(/\s+/));

const RASTER_DATA_URI = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;
const PLAIN_DOCTYPE = /<!DOCTYPE\s+svg\s+PUBLIC\s+"[^"<>\[\]]*"\s+"[^"<>\[\]]*"\s*>/gi;
const ID_RE = /^[A-Za-z_][\w.:-]*$/;
const BAD_CSS = /@import|@font-face|expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|\\/i;
const URL_CALL = /url\(\s*(["']?)\s*([^)"']*?)\s*\1\s*\)/gi;

/** true if every url(...) in the value points to a local fragment. */
function onlyLocalUrls(value) {
  for (const m of value.matchAll(URL_CALL)) if (!m[2].startsWith("#")) return false;
  // url( that the regex above did not understand (unbalanced quotes etc.)
  const calls = (value.match(/url\s*\(/gi) || []).length;
  return calls === [...value.matchAll(URL_CALL)].length;
}

/** Remove dangerous declarations from a CSS fragment (declaration list or a stylesheet). */
function cleanCss(css) {
  let out = css.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/@import[^;]*;?/gi, "").replace(/@font-face\s*\{[^}]*\}/gi, "");
  // drop each declaration (up to the next ; or { }) that contains something bad
  out = out.replace(/[^{};]+/g, (decl) => (BAD_CSS.test(decl) || !onlyLocalUrls(decl) ? "" : decl));
  return BAD_CSS.test(out) || !onlyLocalUrls(out) ? "" : out;
}

function cleanAttrValue(name, value, elName) {
  if (/javascript:|vbscript:|expression\s*\(/i.test(value)) return null;
  if (name === "href" || name === "xlink:href") {
    if (value.startsWith("#")) return ID_RE.test(value.slice(1)) ? value : null;
    if (elName === "image" && RASTER_DATA_URI.test(value)) return value;
    return null;
  }
  if (name === "id") return ID_RE.test(value) ? value : null;
  if (name === "style") return cleanCss(value) || null;
  if (!onlyLocalUrls(value)) return null;
  return value;
}

/** Walk and rebuild the DOM in place. Returns counters; mutates `node`'s subtree. */
function sanitizeNode(node, stats, depth, counter) {
  if (++counter.n > LIMITS.maxNodes) throw new Reject("too-many-nodes");
  if (depth > LIMITS.maxDepth) throw new Reject("too-deep");
  for (let child = node.firstChild; child; ) {
    const next = child.nextSibling;
    if (child.nodeType === 1) {
      const el = /** @type {Element} */ (child);
      const ok = el.namespaceURI === SVG_NS && el.nodeName === el.localName && ELEMENTS.has(el.localName);
      if (!ok) {
        const unwrap = el.namespaceURI === SVG_NS && el.nodeName === el.localName && UNWRAP.has(el.localName);
        stats.elements.push(el.nodeName);
        if (unwrap) {
          const first = el.firstChild;
          while (el.firstChild) node.insertBefore(el.firstChild, el);
          node.removeChild(el);
          child = first || next; // re-scan the moved children
          continue;
        }
        node.removeChild(el);
      } else {
        if (el.localName === "use" && ++counter.use > LIMITS.maxUse) throw new Reject("too-many-use");
        sanitizeAttributes(el, stats);
        if (el.localName === "style") sanitizeStyleElement(el, stats);
        sanitizeNode(el, stats, depth + 1, counter);
      }
    } else if (child.nodeType === 3 || child.nodeType === 4) {
      // text / CDATA are kept (they are inert); style content is handled by sanitizeStyleElement
    } else {
      // comments, processing instructions, anything else
      node.removeChild(child);
    }
    child = next;
  }
}

function sanitizeAttributes(el, stats) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    if (name === "xmlns") { if (attr.value !== SVG_NS) el.removeAttribute(name); continue; }
    if (name === "xmlns:xlink") { if (attr.value !== XLINK_NS) el.removeAttribute(name); continue; }
    let keep = ATTRS.has(name);
    if (keep && name === "xlink:href" && attr.namespaceURI && attr.namespaceURI !== XLINK_NS) keep = false;
    const value = keep ? cleanAttrValue(name, attr.value, el.localName) : null;
    if (value === null) { stats.attributes.push(name); el.removeAttribute(name); continue; }
    if (value !== attr.value) el.setAttribute(name, value);
  }
  if (el.localName === "use" && !el.getAttribute("href") && !el.getAttribute("xlink:href")) {
    // a <use> without a local target is useless
    stats.attributes.push("use-without-target");
  }
}

function sanitizeStyleElement(el, stats) {
  const type = el.getAttribute("type");
  if (type && type !== "text/css") { el.parentNode.removeChild(el); stats.elements.push("style[type]"); return; }
  const css = cleanCss(el.textContent || "");
  while (el.firstChild) el.removeChild(el.firstChild);
  if (css.trim()) el.appendChild(el.ownerDocument.createTextNode(css));
  else el.parentNode.removeChild(el);
}

class Reject extends Error {}

function parse(text) {
  const problems = [];
  const parser = new DOMParser({
    onError: (level, msg) => { if (level !== "warning") problems.push(msg); },
  });
  const doc = parser.parseFromString(text, "image/svg+xml");
  if (problems.length) throw new Reject("parse-error");
  const root = doc.documentElement;
  if (!root || root.nodeName !== "svg" || root.namespaceURI !== SVG_NS) throw new Reject("not-svg");
  return doc;
}

function hasDrawable(node) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (DRAWABLE.has(c.localName) || hasDrawable(c))) return true;
  }
  return false;
}

/**
 * Independent post-check, run on the FINAL bytes (after svgo). Returns a list of violations (empty = clean).
 * It re-parses the output and applies the same allow-list again, so anything svgo introduced is caught too.
 */
export function validateSvg(text) {
  const v = [];
  if (Buffer.byteLength(text) > LIMITS.maxOutputBytes) v.push("too-large");
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST|<\?xml-stylesheet|<script|<foreignObject|<\/script|<!\[CDATA\[[\s\S]*?<script/i.test(text)) v.push("forbidden-markup");
  if (/\son[a-z]+\s*=/i.test(text)) v.push("event-handler");
  if (/javascript:|vbscript:/i.test(text)) v.push("script-uri");
  let doc;
  try { doc = parse(text); } catch (e) { return [...v, e.message || "parse-error"]; }
  const walk = (el) => {
    if (el.namespaceURI !== SVG_NS || el.nodeName !== el.localName || !ELEMENTS.has(el.localName)) v.push(`element:${el.nodeName}`);
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name;
      if (n === "xmlns") { if (attr.value !== SVG_NS) v.push("attr:xmlns"); continue; }
      if (n === "xmlns:xlink") { if (attr.value !== XLINK_NS) v.push("attr:xmlns:xlink"); continue; }
      if (!ATTRS.has(n)) { v.push(`attr:${n}`); continue; }
      if (cleanAttrValue(n, attr.value, el.localName) !== attr.value) v.push(`attr-value:${n}`);
    }
    if (el.localName === "style" && cleanCss(el.textContent || "") !== (el.textContent || "").replace(/\/\*[\s\S]*?\*\//g, "")) v.push("style-content");
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) walk(c);
      else if (c.nodeType !== 3 && c.nodeType !== 4) v.push(`node:${c.nodeType}`);
    }
  };
  walk(doc.documentElement);
  if (!hasDrawable(doc.documentElement)) v.push("empty");
  return v;
}

const SVGO_CONFIG = {
  multipass: true,
  plugins: [
    "preset-default",
    "removeScripts",
  ],
};

/**
 * @param {Buffer|string} input
 * @returns {{ok: true, svg: string, bytes: number, removed: {elements: string[], attributes: string[]}} | {ok: false, reason: string}}
 */
export function sanitizeSvg(input) {
  try {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
    if (buf.length > LIMITS.maxInputBytes) throw new Reject("input-too-large");
    let text;
    if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString("utf16le"); // UTF-16LE with BOM
    else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString("utf16le"); // UTF-16BE with BOM
    else text = buf.toString("utf8");
    text = text.replace(/^﻿/, "").replace(/^(<\?xml[^>]*?)\s+encoding=["'][^"']*["']/i, "$1");
    if (text.includes("\u0000")) throw new Reject("bad-encoding");
    if (/<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(text)) throw new Reject("dtd-declaration");
    if (/<\?xml-stylesheet/i.test(text)) throw new Reject("xml-stylesheet");
    text = text.replace(PLAIN_DOCTYPE, ""); // plain W3C public DOCTYPE carries no declarations
    if (/<!DOCTYPE/i.test(text)) throw new Reject("doctype");

    const doc = parse(text);
    const stats = { elements: [], attributes: [] };
    sanitizeNode(doc.documentElement, stats, 0, { n: 0, use: 0 });
    sanitizeAttributes(doc.documentElement, stats);
    if (!hasDrawable(doc.documentElement)) throw new Reject("empty");

    const cleaned = new XMLSerializer().serializeToString(doc.documentElement);
    const optimized = optimize(cleaned, SVGO_CONFIG).data;
    const violations = validateSvg(optimized);
    if (violations.length) throw new Reject(`post-check:${violations[0]}`);
    return { ok: true, svg: optimized, bytes: Buffer.byteLength(optimized), removed: stats };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.message };
    return { ok: false, reason: `error:${String(e.message || e).slice(0, 80)}` };
  }
}
