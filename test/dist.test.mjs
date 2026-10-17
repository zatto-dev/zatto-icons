// Checks the built dist/ (run `npm run build` first). Skipped when dist/ does not exist.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateSvg } from "../scripts/lib/sanitize-svg.mjs";

const dist = path.resolve(import.meta.dirname, "..", "dist");
const has = fs.existsSync(path.join(dist, "index.json"));
const opts = { skip: has ? false : "dist/ not built" };
const index = has ? JSON.parse(fs.readFileSync(path.join(dist, "index.json"), "utf8")) : null;

const countFiles = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(d, e.name)) : 1), 0);

test("index contains llama-cpp and proxmox with files on disk", opts, () => {
  for (const slug of ["llama-cpp", "proxmox"]) {
    const e = index.icons[slug];
    assert.ok(e, `${slug} missing from index`);
    assert.ok(e.license && e.source && e.size > 0);
    assert.ok(fs.existsSync(path.join(dist, e.format, `${slug}.${e.format}`)));
  }
});

test("every indexed file exists and every file is indexed", opts, () => {
  const expected = new Set();
  for (const [slug, e] of Object.entries(index.icons)) {
    expected.add(`${e.format}/${slug}.${e.format}`);
    for (const [k, fmt] of Object.entries(e.variants)) expected.add(`${fmt}/${slug}-${k}.${fmt}`);
  }
  const actual = new Set();
  for (const dir of ["svg", "png"]) for (const f of fs.readdirSync(path.join(dist, dir))) actual.add(`${dir}/${f}`);
  assert.deepEqual([...expected].filter((f) => !actual.has(f)), []);
  assert.deepEqual([...actual].filter((f) => !expected.has(f)), []);
});

test("alias map points at real icons and never shadows one", opts, () => {
  for (const [alias, slug] of Object.entries(index.aliasMap)) {
    assert.ok(index.icons[slug], `${alias} -> missing ${slug}`);
    assert.ok(!index.icons[alias], `${alias} shadows a real icon`);
  }
});

test("every served SVG passes the validator", opts, () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(dist, "svg"))) {
    const v = validateSvg(fs.readFileSync(path.join(dist, "svg", f), "utf8"));
    if (v.length) bad.push(`${f}: ${v[0]}`);
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test("file count is under the Pages Free limit (19 000 guard)", opts, () => {
  assert.ok(countFiles(dist) <= 19_000);
});

test("_headers carries CSP sandbox, nosniff and CORS for /svg/*", opts, () => {
  const h = fs.readFileSync(path.join(dist, "_headers"), "utf8");
  const svg = h.split(/\n\n/).find((b) => b.startsWith("/svg/*"));
  assert.match(svg, /Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox/);
  assert.match(svg, /X-Content-Type-Options: nosniff/);
  assert.match(svg, /Access-Control-Allow-Origin: \*/);
});

test("attribution page names both sources and the changes", opts, () => {
  const a = fs.readFileSync(path.join(dist, "attribution.html"), "utf8");
  for (const s of ["homarr-labs/dashboard-icons", "selfhst/icons", "Apache License 2.0", "Attribution 4.0", "sanitized", "minified"]) assert.match(a, new RegExp(s));
});
