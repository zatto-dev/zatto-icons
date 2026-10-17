# Recenzja r1 — skonsolidowana (koordynator)

Oceny: Straż (bezpieczeństwo) 6,5 · Nika (API/produkt/prawo) 6,9 · Sowa (infra/koszty) 7,0. Próg: każda ≥ 8, brak blokujących.

## Decyzje CEO (już podjęte, wpisz jako ustalone)
- Repo `zatto-dev/zatto-icons` publiczne, open source (kod MIT); dokumentacja także na stronie API.
- Garlic domyślnie korzysta z naszego API bez klucza. **Tryb domyślny Garlica = indeks + na żądanie**: `metadata.json`/indeks całego katalogu (wyszukiwarka/picker przeszukuje cały katalog jak dziś), na dysk `/data` trafiają **tylko ikony dodanych usług** (z wariantami), pobierane od razu przy dodaniu usługi; ikony usuniętych usług sprzątane; offline w LAN działa. Miniatury w pickerze ulotne (nie do `/data`). `bundle.zip` = tylko opcja dla instalacji offline/prywatności. Kompromis prywatności (CF widzi nazwy ikon; my nie mamy logów) opisz jawnie.
- Zgodność z licencjami ikon w pełni (atrybucja widoczna, NOTICE, informacja o zmianach).
- Strefa CF zatto.dev = plan **Free** (sprawdzone).

## BLOKUJĄCE (wszystkie do poprawy)
1. **Cache JSON/HTML** — CF nie cache'uje JSON/HTML domyślnie. Cache Rule: host `icons.zatto.dev` → Eligible for cache, Edge TTL wg `Cache-Control` z originu (min Edge TTL Free 2 h — nie nadpisywać dla `latest.json`). R2 custom domain nie ma index document → URL rewrite dla `/`, `/attribution`, `/privacy`, `/terms`; WAF nie może ich blokować (sprzeczność reguły 2 vs 3). AC: drugie żądanie `metadata.json`, `latest.json`, `/attribution` → `cf-cache-status: HIT`, 200.
2. **Bezpiecznik/limity vs Garlic** — rachunek „kilka USD” błędny (600/10 s ≈ 155M/mies./IP ≈ 52 USD, poniżej progu 2). Wyjątki po `Referer`/`If-None-Match` = nagłówki klienta → do usunięcia. Managed Challenge na `/compat/*` łamie Garlica (klient Go). Poprawka: próg ≥ 2× najgorszy przypadek Garlica (np. 1200/10 s), limit współbieżności i backoff 429 po stronie Garlica (≤ 8 równoległych / ≤ 20 req/s, lazy load miniatur), bezpiecznik progi względem bazowego ruchu, akcja bez challenge na `/compat/*` (obniżenie progu RL / Block na `/v1/icons/*`), jawny sufit kosztu przy ataku poniżej progu. Liczniki RL per PoP — dopisać. AC: e2e Garlica przechodzi przy włączonym bezpieczniku.
3. **Sanitizer SVG** — nie round-trip przez Go `encoding/xml` (CVE-2020-29509/10/11, golang/go#43168). Odrzucać plik z DOCTYPE/ENTITY. Normalizacja przez usvg (resvg) lub svg-hush; uwaga `currentColor` dla `mono`. Serializacja z własnego drzewa, zamknięta allow-lista elementów/atrybutów/właściwości CSS; zero `<style>` (style→atrybuty); `id` z prefiksem hasha ikony; obsłużyć PI `<?xml-stylesheet?>`, `<set>`, `xml:base`, obce przestrzenie nazw (`inkscape:*`, `sodipodi:*`, `dc:*`), `url()` tylko `#id`, `use` zewn. href; limity węzłów/głębokości/`use`. Weryfikacja drugim parserem (libxml2 / DOMPurify jsdom). Korpus testów (DOMPurify, svg-hush) + fuzzing.
4. **Izolacja CI** — job `build` bez sekretów (`permissions: {}`/read), artefakt + manifest sha256; job `publish` w environment ograniczonym do `main`, bez recenzenta (cron), tylko upload + weryfikacja hashy. Akcje przypięte po SHA, Dependabot, brak `pull_request_target`, CODEOWNERS dla `.github/`, sanitizera, `overrides.yaml`, `policy/`, 2FA org. Limity renderu: timeout/plik, limit pamięci, max pikseli.
5. **Rastry upstream** — każdy PNG/WebP i `data:image` dekodowany z limitem wymiarów (≤ 4096 px) i kodowany od nowa (usuwa EXIF/tEXt/PII, polyglot, bomby).
6. **CORS** — stały `Access-Control-Allow-Origin: *` regułą Transform (Response Header), nie CORS z R2 (cache bez `Origin`). AC: po rozgrzaniu cache bez Origin, żądanie z Origin ma ACAO.
7. **Regulamin i prywatność** — `/terms` (brak gwarancji/SLA, znaki należą do właścicieli, tylko identyfikacja, prawo usunięcia), `/privacy` (administrator Zatto, CF jako procesor/DPA), `/.well-known/security.txt`. Przed publicznym startem.

## WAŻNE
- Bot Fight Mode/Browser Integrity Check: BFM strefowy, nie da się ominąć regułą — sprawdzić wyłączenie; BIC off dla hosta (Configuration Rule). AC z klientem nie-przeglądarkowym.
- Strony HTML na `icons.zatto.dev`: CSP `script-src 'self'`, bez inline, Trusted Types, `textContent`; brak fontów/skryptów stron trzecich; Web Analytics/Zaraz off.
- `sources.lock`: perceptual hash dla istniejących slugów, zmiana > próg → ręczna akceptacja; limit zmienionych ikon/run; raport diff w PR.
- PII: skan regex (e-mail, `/home/`, `C:\Users`) po wszystkich obiektach (JSON, SVG, chunki PNG, zip).
- Integralność: `latest.json` z sha256 bundla i indeksu + podpis minisign (klucz poza CI); Garlic weryfikuje; zip-slip/zip-bomb.
- Takedown: przebudowa/usunięcie starych bundli/indeksów z retencji; weryfikacja zgłaszającego; purge po prefiksie (Free: prefix/host/tag, 800 URL/s) — bez „purge everything”. `removed.json` i próba procesu w etapie 2 (przed publicznym startem). Denylista uwzględniona w rollbacku i AC („0 brakujących” z wyjątkami).
- Token R2: kopia offsite (MinIO homelab) lub bucket lock; token bezpiecznika (WAF edit, tylko strefa zatto.dev/rulesets) w Vault, opisany.
- WAF Free 5 reguł: połączyć reguły, zostawić miejsce awaryjne; `strict wildcard`. „Ignore query string” w Cache Rules = Enterprise/PAYG → usuń [S]; zbadać Transform URL Rewrite czyszczący query [NZ], inaczej 403 udokumentowane.
- Wielkość: ~300k obiektów, ~3,5–4 GB (etap 2), ~6 GB etap 3; rebuild = ~300k PUT (koszt A powyżej ~3 rebuildów/mies.). Rozważ rastry tylko w jednej przestrzeni ścieżek. Czas CI ~25 min render + 25–60 min upload.
- GitHub Actions cron wyłącza się po 60 dniach bez aktywności → bot commituje `sources.lock` + zewnętrzny `workflow_dispatch` z homelabu.
- Kolejność publikacji: pliki → indeksy → usunięcia; purge też dla nowych slugów (404 w cache); 404 Status Code TTL — Free min 2 h lub domyślne 3 min.
- Pokrycie „wszystko AI/IT”: etap 3 (simple-icons z filtrem licencji+`guidelines`, devicon, svgl, gilbarbara/logos) jako zobowiązanie z terminem; taksonomia + `frameworks`, `editors`, `browsers`, `analytics`, `design`, `hardware`, `messaging`, `cloud`, `languages`; minimalne liczby per kategoria w AC. Chmury (AWS/Azure/GCP) i CNCF — decyzja/przegląd prawny.
- Pierwszeństwo: slug homarr (kontrakt), plik = najlepszy poprawny SVG (homarr śr. 15,7 KB vs selfh.st 1,9 KB). Ryzyko: homarr = konkurent, zmiana licencji/zamknięcie → zamrożenie ostatniego commitu Apache.
- Apache §4b / CC BY: zmienione pliki niosą informację (dopuść `<metadata>`/`<desc>` z source/licencja/„modified”, wstawiane przez pipeline). Garlic: link „Icon credits” w UI do `/attribution`.
- DX: OpenAPI 3.1, JSON Schema (`schema_version`), polityka deprecjacji (v1 ≥ 24 mies., `Deprecation`/`Sunset`), changelog katalogu, `/v1/` z linkami, zachowanie przy braku wariantu, reguła „slug nie znika” vs usunięcie upstream. Docs: inline SVG → sanityzuj po swojej stronie.
- Workers Static Assets odpadają (limit plików/wersję) — dopisać w porównaniu. Warunki CDN CF a obrazy: R2 = Developer Platform OK; wariant VPS ryzykowny — dopisać w 6.4.
- Estymaty realne: etap 1 ≈ 6–8 d.

## DROBNE
- §6.6 „indeks się nie zmienia” błędne. Retencja „lub”/„i”. AC6 → „429 przed 700. żądaniem w 10 s”. ETag słaby `W/` przy kompresji. `Content-Disposition: attachment` dla bundla, jawny `Content-Type`. Walidacja slugów regexem przed kluczem R2. Ścieżka `/compat/dashboard-icons/` vs `/compat/homarr/` — rozważ. Zamknąć NZ: plan Free, 429 domyślny, purge Free. Bezpiecznik w homelabie = brak ochrony przy awarii homelabu (zapisać). AC brakujące: ACAO, `Link`, `/privacy`, HIT JSON, sha256, kolizje aliasów, cron keepalive, purge nowego sluga.
