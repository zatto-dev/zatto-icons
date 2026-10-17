# Zatto Icons

A tiny public icon API made of static files on Cloudflare Pages. No keys, no rate limits you need to think about, CORS enabled.

Base URL: **https://icons.zatto.dev**

```
GET /svg/<slug>.svg           e.g. /svg/llama-cpp.svg
GET /svg/<slug>-light.svg     light / dark variants (listed in the index)
GET /svg/<slug>-dark.svg
GET /png/<slug>.png           only for icons that have no usable SVG
GET /index.json               names, aliases, categories, variants, source, license, size
GET /attribution.html         sources, authors, licenses, list of changes
```

```html
<img src="https://icons.zatto.dev/svg/proxmox.svg" width="48" height="48" alt="Proxmox">
```

`index.json` has an `icons` object keyed by slug (`name`, `aliases`, `categories`, `format`, `variants`, `source`, `license`, `size`)
and an `aliasMap` (normalized alias -> canonical slug), so `llamacpp` can be resolved to `llama-cpp` without scanning.
Use `format` to know whether the base file is under `/svg/` or `/png/`; `variants` maps `light`/`dark` to their format.

SVG responses carry `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `X-Content-Type-Options: nosniff`,
so they are safe to open directly and to use in `<img>`. Inline them in your page only if you trust the pipeline as much as you trust us.

## Sources

| Source | License |
|---|---|
| [homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons) | Apache-2.0 |
| [selfhst/icons](https://github.com/selfhst/icons) (selfh.st/icons) | CC BY 4.0 |

Pinned commits are in [`sources.lock`](sources.lock). On a name collision homarr wins. Files are sanitized and minified (changes are
listed in `/attribution.html`). Logos are trademarks of their owners and are served for identification only.

## Build

Needs Node 22+.

```sh
npm ci
npm run fetch        # check out the commits pinned in sources.lock into .cache/
npm run build        # writes dist/ and prints a report (file counts, rejected files)
npm test             # sanitizer corpus + checks of dist/
npx wrangler pages deploy dist --project-name zatto-icons
```

`npm run update-lock` moves `sources.lock` to the newest upstream commits. A GitHub Action does that nightly, builds and deploys
(it does not commit the new lock; the deployed `index.json` records the commits it was built from).
The build fails if `dist/` holds more than 19 000 files (Pages Free allows 20 000).

See [`docs/DESIGN.md`](docs/DESIGN.md) for the design and the sanitization policy.

## License

Code: [MIT](LICENSE). Icons: the license of their source (see above and `/attribution.html`); this repository does not contain icon files.

## One-time setup

`scripts/cf-setup.sh` creates the Pages project, attaches `icons.zatto.dev`, points DNS at it and stores the two GitHub secrets
(`CLOUDFLARE_API_TOKEN` with Pages:Edit, `CLOUDFLARE_ACCOUNT_ID`). It reads credentials from Vault via `zsecret`.
