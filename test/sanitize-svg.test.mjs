import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSvg, validateSvg } from "../scripts/lib/sanitize-svg.mjs";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const wrap = (inner, attrs = "") => `<svg ${NS} ${XL} viewBox="0 0 10 10" ${attrs}>${inner}</svg>`;
const OK_PATH = '<path d="M0 0h10v10H0z" fill="red"/>';

// Malicious corpus. `mode: "reject"` = whole file refused; `"clean"` = file kept but dangerous parts removed.
const CORPUS = {
  "script element": { svg: wrap(`${OK_PATH}<script>alert(1)</script>`), mode: "clean" },
  "script with CDATA": { svg: wrap(`${OK_PATH}<script><![CDATA[alert(1)]]></script>`), mode: "clean" },
  "script in SVG namespace with prefix": { svg: wrap(`${OK_PATH}<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>`), mode: "clean" },
  "foreignObject with html": { svg: wrap(`${OK_PATH}<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="javascript:alert(1)"></iframe></body></foreignObject>`), mode: "clean" },
  "onload on root": { svg: wrap(OK_PATH, 'onload="alert(1)"'), mode: "clean" },
  "onclick on path": { svg: wrap('<path d="M0 0h10v10H0z" onclick="alert(1)" onmouseover="x()"/>'), mode: "clean" },
  "external xlink:href on use": { svg: wrap(`${OK_PATH}<use xlink:href="https://evil.example/x.svg#a"/>`), mode: "clean" },
  "external href on image": { svg: wrap(`${OK_PATH}<image href="https://evil.example/track.png" width="1" height="1"/>`), mode: "clean" },
  "javascript: href on a": { svg: wrap(`<a xlink:href="javascript:alert(1)">${OK_PATH}</a>`), mode: "clean" },
  "data:text/html href": { svg: wrap(`${OK_PATH}<image href="data:text/html;base64,PHNjcmlwdD4=" width="1" height="1"/>`), mode: "clean" },
  "data:image/svg+xml href": { svg: wrap(`${OK_PATH}<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" width="1" height="1"/>`), mode: "clean" },
  "animate href to javascript:": { svg: wrap(`<a><path d="M0 0h10v10H0z"/></a><set attributeName="href" to="javascript:alert(1)"/>${OK_PATH}`), mode: "clean" },
  "style @import": { svg: wrap(`<style>@import url(https://evil.example/a.css); path{fill:red}</style>${OK_PATH}`), mode: "clean" },
  "style external url()": { svg: wrap(`<style>.a{fill:url(https://evil.example/p.svg#x)} .b{fill:blue}</style>${OK_PATH}`), mode: "clean" },
  "style background url()": { svg: wrap(`<style>path{background:url("//evil.example/x.png")}</style>${OK_PATH}`), mode: "clean" },
  "style attr url()": { svg: wrap('<path d="M0 0h10v10H0z" style="fill:red;filter:url(https://evil.example/f.svg#x)"/>'), mode: "clean" },
  "style css escape": { svg: wrap(`<style>.a{fill:\\75rl(https://evil.example/x)}</style>${OK_PATH}`), mode: "clean" },
  "style comment-split url": { svg: wrap(`<style>.a{fill:url(/**/https://evil.example/x)}</style>${OK_PATH}`), mode: "clean" },
  "presentation attr external url()": { svg: wrap('<path d="M0 0h10v10H0z" fill="url(https://evil.example/x#a)"/>'), mode: "clean" },
  "style expression()": { svg: wrap('<path d="M0 0h10v10H0z" style="width:expression(alert(1))"/>'), mode: "clean" },
  "DOCTYPE with ENTITY": { svg: `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg ${NS}><text>&x;</text>${OK_PATH}</svg>`, mode: "reject" },
  "billion laughs": { svg: `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><svg ${NS}><text>&lol2;</text>${OK_PATH}</svg>`, mode: "reject" },
  "external entity (XXE)": { svg: `<?xml version="1.0"?><!DOCTYPE svg SYSTEM "http://evil.example/x.dtd" [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg ${NS}><text>&xxe;</text></svg>`, mode: "reject" },
  "internal subset without ENTITY": { svg: `<!DOCTYPE svg [ ]><svg ${NS}>${OK_PATH}</svg>`, mode: "reject" },
  "non-W3C DOCTYPE": { svg: `<!DOCTYPE svg SYSTEM "http://evil.example/x.dtd"><svg ${NS}>${OK_PATH}</svg>`, mode: "reject" },
  "xml-stylesheet": { svg: `<?xml version="1.0"?><?xml-stylesheet href="http://evil.example/s.css" type="text/css"?><svg ${NS}>${OK_PATH}</svg>`, mode: "reject" },
  "not well-formed": { svg: `<svg ${NS}><path d="M0 0"></svg>`, mode: "reject" },
  "not svg root": { svg: `<html xmlns="http://www.w3.org/1999/xhtml"><body>hi</body></html>`, mode: "reject" },
  "nothing drawable left": { svg: wrap("<script>alert(1)</script><foreignObject/>"), mode: "reject" },
  "oversized input": { svg: wrap(`<path d="${"M0 0 ".repeat(600_000)}"/>`), mode: "reject" },
  "use bomb": { svg: wrap(`<defs><path id="a" d="M0 0h1"/></defs>${'<use href="#a"/>'.repeat(600)}`), mode: "reject" },
  "deep nesting": { svg: wrap("<g>".repeat(60) + OK_PATH + "</g>".repeat(60)), mode: "reject" },
};

const FORBIDDEN_IN_OUTPUT = [/<script/i, /foreignObject/i, /\son[a-z]+\s*=/i, /javascript:/i, /evil\.example/i, /<!DOCTYPE/i, /<!ENTITY/i, /xml-stylesheet/i, /@import/i, /expression\s*\(/i];

for (const [name, { svg, mode }] of Object.entries(CORPUS)) {
  test(`malicious: ${name} -> ${mode}`, () => {
    const r = sanitizeSvg(svg);
    if (mode === "reject") {
      assert.equal(r.ok, false, "expected the file to be rejected");
      return;
    }
    assert.equal(r.ok, true, `expected sanitized output, got reject: ${r.reason}`);
    for (const re of FORBIDDEN_IN_OUTPUT) assert.doesNotMatch(r.svg, re);
    assert.deepEqual(validateSvg(r.svg), [], "final output must pass the independent validator");
  });
}

test("validator flags dirty input (independent of the sanitizer)", () => {
  for (const dirty of [
    wrap(`${OK_PATH}<script>1</script>`),
    wrap('<path d="M0 0" onload="x()"/>'),
    wrap('<use href="https://evil.example/a#b"/>'),
    wrap('<path d="M0 0" fill="url(https://evil.example/a)"/>'),
    wrap(`<style>@import url(x);</style>${OK_PATH}`),
  ]) assert.notDeepEqual(validateSvg(dirty), []);
});

test("benign icon keeps its drawing, gradients and local references", () => {
  const svg = wrap(`<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><title>Icon</title>`);
  const r = sanitizeSvg(svg);
  assert.equal(r.ok, true);
  assert.match(r.svg, /linearGradient/);
  assert.match(r.svg, /url\(#/);
  assert.match(r.svg, /viewBox="0 0 10 10"/);
  assert.deepEqual(r.removed.elements, []);
});

test("editor metadata and unknown namespaces are stripped, drawing kept", () => {
  const svg = `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" viewBox="0 0 10 10"><sodipodi:namedview inkscape:zoom="1"/><metadata>x</metadata><path inkscape:label="p" d="M0 0h10v10H0z"/></svg>`;
  const r = sanitizeSvg(svg);
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.svg, /inkscape|sodipodi|metadata/);
  assert.match(r.svg, /<path/);
});

test("plain W3C public DOCTYPE (Illustrator exports) is stripped, not rejected", () => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg ${NS} viewBox="0 0 10 10">${OK_PATH}</svg>`;
  const r = sanitizeSvg(svg);
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.svg, /DOCTYPE/);
});

test("UTF-16 input with BOM is decoded", () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`<?xml version="1.0" encoding="UTF-16"?><svg ${NS} viewBox="0 0 10 10">${OK_PATH}</svg>`, "utf16le")]);
  assert.equal(sanitizeSvg(buf).ok, true);
});

test("embedded raster data:image/png on <image> is allowed", () => {
  const svg = wrap('<image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>');
  const r = sanitizeSvg(svg);
  assert.equal(r.ok, true);
  assert.match(r.svg, /data:image\/png/);
});
