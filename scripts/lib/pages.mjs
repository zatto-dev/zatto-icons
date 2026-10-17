// Static pages and Cloudflare Pages config generated at build time.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}code,pre{background:#f3f3f3;border-radius:4px;padding:.1em .3em}pre{padding:.7em;overflow:auto}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.4em;text-align:left}`;

export function renderAttribution({ sources, perSource, generated }) {
  const rows = sources.map((s) => `<tr>
<td><a href="${esc(s.homepage)}">${esc(s.title)}</a><br><small>commit <a href="https://github.com/${esc(s.repo)}/commit/${esc(s.commit)}"><code>${esc(s.commit.slice(0, 12))}</code></a></small></td>
<td>${esc(s.holder)}</td>
<td><a href="${esc(s.licenseUrl)}">${esc(s.licenseName)}</a> (<a href="/licenses/${esc(s.id)}.txt">text</a>)</td>
<td>${perSource[s.id].served}</td></tr>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zatto Icons - attribution</title><style>${STYLE}</style></head><body>
<h1>Attribution</h1>
<p>Zatto Icons redistributes icons from the open collections below. Each icon in <a href="/index.json"><code>/index.json</code></a>
names its <code>source</code> and <code>license</code>. Build generated ${esc(generated)}.</p>
<table><thead><tr><th>Source</th><th>Authors / copyright</th><th>License</th><th>Icons served</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2>Changes</h2>
<p>The files were modified by Zatto Icons (indicated as required by Apache-2.0 section 4 and CC BY 4.0 section 3(a)(1)(B)):
SVG files were <strong>sanitized</strong> (elements and attributes outside a strict allow-list removed, e.g. scripts, foreignObject,
event handlers, external references) and <strong>minified</strong> with SVGO; PNG files had non-rendering metadata chunks removed.
Where an SVG could not be sanitized, the PNG of the same icon is served instead. No other changes were made.
Light/dark variants keep the naming of their source (<code>-light</code>, <code>-dark</code>).</p>
<h2>Trademarks</h2>
<p>Product names, logos and brands are property of their respective owners. Icons are provided for identification only and
do not imply endorsement. The licenses above cover the artwork, not trademark rights.</p>
<h2>Takedown</h2>
<p>Rights holders: open an issue at <a href="https://github.com/zatto-dev/zatto-icons/issues">github.com/zatto-dev/zatto-icons</a>.</p>
</body></html>
`;
}

export function renderLanding({ counts }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zatto Icons</title><style>${STYLE}</style></head><body>
<h1>Zatto Icons</h1>
<p>Static icon API: ${counts.icons} icons (${counts.svg} SVG, ${counts.png} PNG). Free, CORS-enabled, no keys.</p>
<pre>https://icons.zatto.dev/svg/&lt;slug&gt;.svg          e.g. /svg/llama-cpp.svg
https://icons.zatto.dev/svg/&lt;slug&gt;-light.svg    light / dark variants, when listed in the index
https://icons.zatto.dev/png/&lt;slug&gt;.png          only for icons without a usable SVG
https://icons.zatto.dev/index.json               names, aliases, categories, variants, source, license, size</pre>
<p><a href="/attribution.html">Attribution and licenses</a> &middot; <a href="https://github.com/zatto-dev/zatto-icons">Source on GitHub</a></p>
</body></html>
`;
}

// Cloudflare Pages merges every matching rule and joins duplicate header values, so rules must not overlap.
export function renderHeaders() {
  const cors = "  Access-Control-Allow-Origin: *\n  Cross-Origin-Resource-Policy: cross-origin\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n";
  const day = "  Cache-Control: public, max-age=86400, stale-while-revalidate=604800\n";
  return `/svg/*
${cors}  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox
${day}
/png/*
${cors}${day}
/index.json
${cors}  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/licenses/*
${cors}${day}
/attribution.html
${cors}  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/index.html
${cors}  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/
${cors}  Cache-Control: public, max-age=3600, stale-while-revalidate=86400
`;
}
