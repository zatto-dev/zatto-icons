# Recenzja r2 — skonsolidowana (koordynator)

Oceny r2: Nika 8,2 (brak blokujących) · Straż 7,8 · Sowa 7,8. Cel r3: wszyscy ≥ 8, zero blokujących. Odrzucenia z zał. C r2 recenzenci uznali za zasadne.

## BLOKUJĄCE
1. **Integralność ikon end-to-end + ochrona originu Garlica** (Straż N1, Sowa N1, Nika W2).
   - Manifest sha256 pochodzi z niezaufanego joba build → `publish` i notariusz uruchamiają własny walidator allow-listy (czysty Go, bez renderu) + bramkę PII na każdym zmienionym SVG, sprawdzają magic bytes/wymiary rastrów przed uploadem/podpisem.
   - Compat `metadata.json` dostaje rozszerzenie `zi_sha256` per nazwa i wariant (ignorowane przez innych klientów). Garlic pobiera indeks z **wersjonowanego, niemutowalnego** URL wskazanego w podpisanym `latest.json` (`v1/catalog/<ver>/compat-metadata.json`) → brak race z mutowalnym `metadata.json` (Sowa W6); przy niezgodności zostaje stary indeks, ponowienie za 1 h.
   - Garlic weryfikuje sha256 każdej ikony przed zapisem do `/data`; odrzuca niezgodne.
   - Garlic na `/icon/*`: `Content-Security-Policy: default-src 'none'; img-src data:; sandbox` (bez `style-src 'unsafe-inline'`, bo na wyjściu nie ma style), `X-Content-Type-Options: nosniff`, Content-Type po rozszerzeniu. Placeholder/monogram: tylko jeden znak `[A-Za-z0-9]` albo XML-escape.
   - Plan rotacji klucza minisign (2 klucze publiczne w Garlicu, rotacja przez wydanie).
   - AC: podmieniony plik w R2 → odrzucony przez Garlica; `/icon/x` ma CSP sandbox + nosniff; nazwa usługi `<script>` → poprawny placeholder; niezgodny indeks → stary indeks zostaje.
2. **Bot `sources.lock` / auto-merge** (Straż N2, Nika W1). `GITHUB_TOKEN` nie tworzy nowych runów (poza workflow_dispatch/repository_dispatch). Token GitHub App (contents+pull-requests write) tylko w kroku podbijającym lock, bez renderu. Raport diff/pHash generuje job build bez sekretów. Ruleset: wymagane checki zamiast review dla `sources.lock`, bypass tylko dla App. Publikacja przez `workflow_dispatch`/`workflow_run`. AC: dzienny PR bota odpala checki i publikację bez ręcznej akcji.

## WAŻNE
- **Bezpiecznik L3** (wszyscy): automat stanów jednoznaczny. L3 trwa do końca miesiąca rozliczeniowego albo ręcznego zdjęcia (lub rosnący czas trzymania); wyzwalacz także szybkościowy (missy/15 min), nie tylko prognoza; nazwa „miękki sufit” + najgorszy przypadek; L2 nie hamuje botnetu na `/compat/*/svg/<losowy>` — opisać. Kompromis koszt vs dostępność → decyzja CEO.
- **Token bezpiecznika**: `r2OperationsAdaptiveGroups` jest na poziomie konta → Account Analytics Read (zweryfikuj w E0); token WAF Edit w GH publicznym repo — świadomie lub tylko w homelabie.
- **Notariusz/bezpiecznik nie na CT101** (warsztat z obcym kodem): osobny minimalny LXC, sekrety z Vault na czas uruchomienia, polityka Vault tylko `zatto/zatto-icons/*`.
- **Bucket lock na `v1/f/`** sprzeczny z takedownem → bez locka na `f/` (ochrona = kopia MinIO + deterministyczny rebuild) albo retencja ≤ 72 h. Takedown przy deduplikacji `f/*`: sprawdź, czy hash nie jest używany przez inny slug.
- **Limity zasobów na każdy etap** (usvg, libxml2, jsdom), nie tylko render; przekroczenie = odrzucenie pliku i zachowanie poprzedniej wersji, nie przerwanie runu.
- **DOMPurify `sanitize(x)==x`** odrzuci ~100% (serializacja HTML) → porównanie kanonicznego drzewa (RETURN_DOM / C14N). PoC przed bramką.
- **usvg i `<text>`**: bez fontów tekst ginie, zastępczy font zmienia wordmarki → `--skip-system-fonts`, bramka wizualna oryginał vs wynik (pHash/SSIM), SVG z `<text>` bez fontu → raster z upstreamu. `--coordinates-precision` istnieje, ale może psuć pliki → bramka wizualna.
- **Limiter Garlica**: token bucket z burstem ~100 (pierwszy ekran pickera natychmiast), średnio ≤ 20 req/s.
- **Placeholder musi się podmienić** bez przeładowania (SSE lub retry `<img>` po N s).
- **Kolejność etapów vs prawo** (Nika W5): próba takedownu i `/terms` w E1 albo publiczne wydanie Garlica z domyślnym API po E2 → decyzja CEO z rekomendacją.
- **Upstream usunął ikonę** → anomalia `needs-review`, nie ciche zachowanie.
- **WAF/Transform ograniczyć do hosta** `http.host eq "icons.zatto.dev"`; odnotować, że RL (tylko Path) obejmie `/v1/*` innych hostów strefy.
- **„Szybszy niż wszystko inne” testowalny**: benchmark Garlica vs Homarr, Homepage, Dashy (cold start, render 50 usług, RAM, liczba żądań sieci) + budżet RAM indeksu w pamięci. Jeśli P1 (TTFB PL) nie przejdzie na Free → z góry ustalona ścieżka decyzji (Pro/Argo).
- **Budżet SVG**: `<desc>` z atrybucją +150–200 B przy medianie 1,1 KB → urealnij budżet lub skróć `<desc>` (stały szablon, XML-escape, bez danych z upstreamu).

## DROBNE
- URL Rewrite: realnie 2–3 reguły (bez regex na Free); budżet Transform ≤ 10 OK.
- Location hint `weur`/`eeur` (zamyka NZ); jurysdykcja `eu` = inny endpoint, nieodwracalna — rozważ.
- AC10 staging: 1 reguła RL na strefę → test na produkcji (HIT = 0 USD) lub czasowa zmiana.
- AC16: sprawdzać nazwy zmiennych bez wypisywania wartości.
- AC dla CSP stron HTML po rewrite i dla `/v1/icons/*`, `/v1/f/*`.
- pHash próg Hamminga >12 nie wykryje drobnej wstawki → dodatkowo próg różnicy pikseli.
- Compat ~32k obiektów, nie 24k; bramka „max 1 pełny rebuild/mies. bez zgody”.

## DECYZJE CEO — popraw listę
- Nowe: D1 publiczne wydanie Garlica z domyślnym API po E1 czy po E2; D2 miękki sufit kosztu i kompromis L3 (przy ataku nowe ikony niedostępne).
- Microsoft **i OpenAI** razem (simple-icons #10019, #13944).
- Rozdziel: właściciel takedown vs administrator danych.
- Już rozstrzygnięte przez CEO (usuń z listy): gałąź Garlica feat/selfhst-icons — **dokończyć i wdrożyć jako pomost**.
