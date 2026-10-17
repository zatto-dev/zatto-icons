# Zatto Icons - design

Decision (CEO, 2026-10-17): as simple and fast as possible, free of charge. The earlier specification (R2, circuit breaker,
signatures, Merkle trees, GitHub App) is kept in `docs/archive/` for reference only and is **not** implemented.

## Shape

```
upstream repos (pinned in sources.lock)
   -> scripts/fetch.mjs   shallow checkout of the pinned commits into .cache/
   -> scripts/build.mjs   merge + sanitize -> dist/
   -> wrangler pages deploy dist   (GitHub Action, nightly)
```

Everything is a static file on Cloudflare Pages Free (limit 20 000 files per deployment, 25 MiB per file). The build fails above 19 000 files.

## Merge rules

- Canonical slug = lowercase `[a-z0-9-]` form of the upstream file name / `Reference`.
- `<slug>-light` / `<slug>-dark` are variants of `<slug>` when `<slug>` exists; they keep the upstream naming.
- Same slug in both sources: **homarr wins** (files, variants, categories). If homarr's file cannot be sanitized, selfh.st is used.
  Display name and aliases are merged (homarr has no display names, so the selfh.st name is used when both exist).
  No "pick the smaller SVG" logic: not worth the complexity.
- PNG is served only when the icon has no SVG, or its SVG was rejected.
- `aliasMap` maps normalized aliases to slugs and never shadows a real slug.

## Sanitization (scripts/lib/sanitize-svg.mjs)

Rejected (whole file): input > 2 MiB, not well-formed, root is not `svg`, `xml-stylesheet`, any `ENTITY`/`ELEMENT`/`ATTLIST`,
any DOCTYPE other than the plain W3C public one, nothing drawable left, > 10 000 nodes, depth > 32, > 500 `<use>`, output > 512 KiB.
The plain W3C public DOCTYPE (written by Illustrator, 55 files in homarr) is stripped instead of rejected: it declares nothing.

Stripped (file kept): every element and attribute outside the allow-list (script, foreignObject, animation, `a` is unwrapped, editor metadata,
foreign namespaces, `on*`), every `href` that is not `#id` (on `<image>` also `data:image/png|jpeg|webp|gif;base64`), every `url()` that is not `#id`,
CSS `@import`, `@font-face`, `expression()`, `javascript:`, backslash escapes.

Pipeline: allow-list pass on the DOM (`@xmldom/xmldom`) -> SVGO -> **independent re-validation of the final bytes** (same rules, re-parsed).
`test/dist.test.mjs` runs that validator over every file in `dist/`.

PNG: signature, chunk CRCs, dimensions <= 4096 px, size <= 1 MiB; only rendering chunks are kept (text/EXIF/ICC/APNG chunks dropped).

## Legal

Apache-2.0 (homarr): license text shipped in `/licenses/homarr.txt`, changes indicated. CC BY 4.0 (selfh.st): creator, license link,
source link and indication of changes on `/attribution.html`. Per-icon `source` and `license` in `index.json`.
Brand marks stay trademarks of their owners; takedown requests go to GitHub issues.

## Known limits

- Upstream is pulled nightly without review; the sanitizer is the defense. A bad upstream commit can drop icons but not inject active content.
- About 0.1% of icons render slightly differently after minification (checked by rasterizing original vs. output).
- Attribution is per source, not per icon author (homarr metadata contains personal e-mail addresses, which are deliberately not published).
