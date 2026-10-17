// Build dist/ from the pinned upstream sources (see sources.lock). Run `npm run fetch` first.
//   node scripts/build.mjs [--out dist]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeSvg } from "./lib/sanitize-svg.mjs";
import { sanitizePng } from "./lib/sanitize-png.mjs";
import { renderAttribution, renderLanding, renderHeaders } from "./lib/pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "dist");
const MAX_FILES = 19_000; // Cloudflare Pages Free hard limit is 20 000 files per deployment

/** Source order = precedence on name collisions: homarr wins. */
const SOURCES = {
  homarr: {
    title: "homarr-labs/dashboard-icons",
    license: "Apache-2.0",
    licenseName: "Apache License 2.0",
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
    holder: "Copyright (c) 2024 Bjorn Lammers, Meier Lukas, Thomas Camlong and Homarr Labs, and icon contributors",
    homepage: "https://github.com/homarr-labs/dashboard-icons",
  },
  selfhst: {
    title: "selfhst/icons (selfh.st/icons)",
    license: "CC-BY-4.0",
    licenseName: "Creative Commons Attribution 4.0 International",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    holder: "selfh.st/icons by Ethan Sholly (selfh.st) and contributors",
    homepage: "https://selfh.st/icons",
  },
};

const lock = JSON.parse(fs.readFileSync(path.join(root, "sources.lock"), "utf8"));
for (const id of Object.keys(SOURCES)) Object.assign(SOURCES[id], { id, repo: lock[id].repo, commit: lock[id].commit, dir: path.join(root, ".cache", id) });

export const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const kebab = (s) => slugify(s);
const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const prettify = (slug) => slug.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

function checkPinned(src) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: src.dir, encoding: "utf8" }).trim();
  if (head !== src.commit) throw new Error(`${src.id}: checkout is at ${head.slice(0, 7)}, sources.lock pins ${src.commit.slice(0, 7)} - run "npm run fetch"`);
}

const dirList = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)) : []);

/** Group raw file stems into base icons + light/dark variants. Returns Map<rawStem, {variants:{light?,dark?}}>. */
function groupVariants(stems) {
  const all = new Set(stems);
  const bases = new Map();
  const variantOf = new Map();
  for (const s of stems) {
    const m = /^(.+)-(light|dark)$/.exec(s);
    if (m && all.has(m[1])) variantOf.set(s, [m[1], m[2]]);
  }
  for (const s of stems) if (!variantOf.has(s)) bases.set(s, { variants: {} });
  for (const [s, [base, kind]] of variantOf) bases.get(base).variants[kind] = s;
  return bases;
}

/** @returns Map<slug, entry>; entry.files = {base, light?, dark?} each {svg?, png?} absolute paths */
function loadHomarr(src) {
  const meta = JSON.parse(fs.readFileSync(path.join(src.dir, "metadata.json"), "utf8"));
  const svgDir = path.join(src.dir, "svg"), pngDir = path.join(src.dir, "png");
  const svgs = new Set(dirList(svgDir, ".svg")), pngs = new Set(dirList(pngDir, ".png"));
  const stems = [...new Set([...Object.keys(meta), ...svgs, ...pngs])].filter((s) => svgs.has(s) || pngs.has(s));
  const files = (stem) => ({ ...(svgs.has(stem) && { svg: path.join(svgDir, `${stem}.svg`) }), ...(pngs.has(stem) && { png: path.join(pngDir, `${stem}.png`) }) });
  const out = new Map();
  for (const [stem, g] of groupVariants(stems)) {
    const slug = slugify(stem);
    if (!slug || out.has(slug)) continue;
    const m = meta[stem] || {};
    out.set(slug, {
      slug, source: src.id, name: prettify(slug),
      aliases: m.aliases || [], categories: (m.categories || []).map(kebab),
      files: { base: files(stem), ...Object.fromEntries(Object.entries(g.variants).map(([k, vs]) => [k, files(vs)])) },
    });
  }
  return out;
}

function loadSelfhst(src) {
  const index = JSON.parse(fs.readFileSync(path.join(src.dir, "index.json"), "utf8"));
  const svgDir = path.join(src.dir, "svg"), pngDir = path.join(src.dir, "png");
  const svgs = new Set(dirList(svgDir, ".svg")), pngs = new Set(dirList(pngDir, ".png"));
  const files = (stem) => ({ ...(svgs.has(stem) && { svg: path.join(svgDir, `${stem}.svg`) }), ...(pngs.has(stem) && { png: path.join(pngDir, `${stem}.png`) }) });
  const out = new Map();
  for (const row of index) {
    const ref = row.Reference, slug = slugify(ref);
    if (!slug || out.has(slug) || !(svgs.has(ref) || pngs.has(ref))) continue;
    const entry = {
      slug, source: src.id, name: row.Name || prettify(slug), aliases: list(row.Tags),
      categories: [...new Set([...list(row.Category), ...list(row.Tags)].map(kebab))],
      files: { base: files(ref) },
    };
    for (const kind of ["light", "dark"]) {
      const f = files(`${ref}-${kind}`);
      if (f.svg || f.png) entry.files[kind] = f;
    }
    out.set(slug, entry);
  }
  return out;
}

// ---- processing -----------------------------------------------------------------------------------------------

const stats = { rejected: {}, stripped: { elements: {}, attributes: {} }, svgFiles: 0, pngFiles: 0 };
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

/** Sanitize one logical file ({svg?, png?}). Prefers SVG, falls back to PNG when SVG is missing or rejected. */
function processFile(f, srcId) {
  if (f.svg) {
    const r = sanitizeSvg(fs.readFileSync(f.svg));
    if (r.ok) {
      for (const e of r.removed.elements) bump(stats.stripped.elements, e);
      for (const a of r.removed.attributes) bump(stats.stripped.attributes, a);
      return { format: "svg", data: r.svg, bytes: r.bytes };
    }
    bump(stats.rejected, `${srcId}/svg:${r.reason.replace(/^error:.*/, "error")}`);
    rejectedLog.push(`${srcId} ${path.relative(path.join(root, ".cache"), f.svg)} ${r.reason}`);
  }
  if (f.png) {
    const r = sanitizePng(fs.readFileSync(f.png));
    if (r.ok) return { format: "png", data: r.png, bytes: r.png.length };
    bump(stats.rejected, `${srcId}/png:${r.reason}`);
    rejectedLog.push(`${srcId} ${path.relative(path.join(root, ".cache"), f.png)} ${r.reason}`);
  }
  return null;
}
const rejectedLog = [];

function build() {
  for (const src of Object.values(SOURCES)) checkPinned(src);
  const loaded = { homarr: loadHomarr(SOURCES.homarr), selfhst: loadSelfhst(SOURCES.selfhst) };
  const perSource = Object.fromEntries(Object.keys(loaded).map((id) => [id, { listed: loaded[id].size, served: 0, svg: 0, png: 0, variants: 0 }]));
  const slugs = new Set([...loaded.homarr.keys(), ...loaded.selfhst.keys()]);
  // A standalone "<x>-light|dark" entry whose base "<x>" exists in any source is not an icon of its own:
  // its filename belongs to the variant of <x>.
  for (const m of Object.values(loaded)) {
    for (const slug of [...m.keys()]) {
      const v = /^(.+)-(light|dark)$/.exec(slug);
      if (v && slugs.has(v[1])) { m.delete(slug); stats.shadowedVariants = (stats.shadowedVariants || 0) + 1; }
    }
  }
  for (const s of [...slugs]) if (!loaded.homarr.has(s) && !loaded.selfhst.has(s)) slugs.delete(s);
  const collisions = [...loaded.homarr.keys()].filter((s) => loaded.selfhst.has(s));

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const d of ["svg", "png", "licenses"]) fs.mkdirSync(path.join(outDir, d), { recursive: true });

  const icons = {};
  const writtenNames = new Set();
  const aliasCandidates = []; // [aliasSlug, canonicalSlug]
  for (const slug of [...slugs].sort()) {
    const candidates = ["homarr", "selfhst"].map((id) => loaded[id].get(slug)).filter(Boolean);
    for (const entry of candidates) {
      const base = processFile(entry.files.base, entry.source);
      if (!base) continue; // try the next source for this slug
      const written = [];
      const write = (name, r) => { if (writtenNames.has(`${r.format}/${name}`)) throw new Error(`duplicate output ${r.format}/${name}`); writtenNames.add(`${r.format}/${name}`); fs.writeFileSync(path.join(outDir, r.format, `${name}.${r.format}`), r.data); written.push(r.format); stats[r.format === "svg" ? "svgFiles" : "pngFiles"]++; perSource[entry.source][r.format]++; };
      write(slug, base);
      const variants = {};
      for (const kind of ["light", "dark"]) {
        if (!entry.files[kind]) continue;
        const v = processFile(entry.files[kind], entry.source);
        if (!v) continue;
        write(`${slug}-${kind}`, v);
        variants[kind] = v.format;
        perSource[entry.source].variants++;
      }
      const others = candidates.filter((c) => c !== entry);
      const aliasSet = new Set([...entry.aliases, ...others.flatMap((o) => [o.name, ...o.aliases])]);
      const name = others.length && others[0].source === "selfhst" ? others[0].name : entry.name; // homarr has no display names
      aliasSet.delete(name);
      const categories = [...new Set([...entry.categories, ...others.flatMap((o) => o.categories)])];
      icons[slug] = {
        name,
        aliases: [...aliasSet].filter((a) => a && slugify(a) !== slug),
        categories,
        format: base.format,
        variants,
        source: entry.source,
        license: SOURCES[entry.source].license,
        size: base.bytes,
      };
      perSource[entry.source].served++;
      for (const a of icons[slug].aliases) aliasCandidates.push([slugify(a), slug]);
      break;
    }
  }

  // alias slug -> canonical slug (never shadows a real slug; first (alphabetical) icon wins on conflicts)
  const aliasMap = {};
  for (const [a, canonical] of aliasCandidates) if (a && !icons[a] && !aliasMap[a]) aliasMap[a] = canonical;

  const sourcesInfo = Object.fromEntries(Object.values(SOURCES).map((s) => [s.id, { repo: s.repo, commit: s.commit, license: s.license, homepage: s.homepage, icons: perSource[s.id].served }]));
  const nIcons = Object.keys(icons).length;
  const generated = new Date().toISOString();
  const index = {
    schema: 1, generated,
    note: "Names are search labels. Slugs are canonical: /svg/<slug>.svg, /png/<slug>.png (png only when the icon has no usable svg).",
    sources: sourcesInfo,
    counts: { icons: nIcons, svg: stats.svgFiles, png: stats.pngFiles },
    icons, aliasMap,
  };

  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index));
  fs.writeFileSync(path.join(outDir, "attribution.html"), renderAttribution({ sources: Object.values(SOURCES), perSource, generated }));
  fs.writeFileSync(path.join(outDir, "index.html"), renderLanding({ counts: index.counts }));
  fs.writeFileSync(path.join(outDir, "_headers"), renderHeaders());
  for (const s of Object.values(SOURCES)) fs.copyFileSync(path.join(s.dir, "LICENSE"), path.join(outDir, "licenses", `${s.id}.txt`));

  const total = countFiles(outDir);
  const report = {
    sources: Object.fromEntries(Object.keys(perSource).map((id) => [id, { commit: SOURCES[id].commit.slice(0, 7), ...perSource[id] }])),
    collisions: collisions.length, shadowedVariants: stats.shadowedVariants || 0, uniqueSlugs: slugs.size, iconsServed: nIcons, aliasMap: Object.keys(aliasMap).length,
    svgFiles: stats.svgFiles, pngFiles: stats.pngFiles, totalFiles: total, maxFiles: MAX_FILES,
    rejected: stats.rejected, strippedElements: stats.stripped.elements, strippedAttributes: topN(stats.stripped.attributes, 15),
    distBytes: dirBytes(outDir),
  };
  fs.writeFileSync(path.join(root, ".cache", "build-report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, ".cache", "rejected.log"), rejectedLog.join("\n") + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (total > MAX_FILES) { console.error(`FAIL: ${total} files in dist exceeds ${MAX_FILES} (Pages Free limit is 20000)`); process.exit(1); }
}

function topN(obj, n) { return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)); }
function countFiles(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1; return n; }
function dirBytes(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? dirBytes(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size; return n; }

build();
