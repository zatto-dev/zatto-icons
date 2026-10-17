# Recenzja r3 — skonsolidowana (koordynator)

Oceny r3: Nika 8,7 (0 blokujących) · Straż 8,6 (0 blokujących) · Sowa 8,3 (1 blokująca). Cel r4: domknąć blokującą + ważne bez nowej pełnej rundy (Sowa: „jeśli poprawka + urealniony P3 → akceptuję”).

## BLOKUJĄCA (Sowa)
- **L3 przepuszcza `/v1/catalog/*` z wildcardem** → atakujący chodzi po `/v1/catalog/<losowe>/x.json`, każdy to miss klasy B, koszt nieograniczony; zdanie „w L3 missy blokowane (0 USD)” fałszywe. Poprawka: reguła 3 = dokładna lista `http.request.uri.path in {…}` (latest.json, .minisig, pliki bieżącej wersji: compat-metadata, index, search, categories, changes, bundle, strony). Listę przepisuje bezpiecznik przy wejściu w L3 i notariusz po każdym podpisie, gdy L3 aktywne. AC: w L3 `/v1/catalog/zzz/x.json` → 403.

## WAŻNE (do wprowadzenia w tekście)
1. **Budżet P3 nieosiągalny** (Sowa W1): 128-bit skróty per plik × ~32k plików = 170–512 KB gzip. Rekomendacja: kubełki Merkle — w indeksie 256 skrótów kubełków (~8 KB), niemutowalne `v1/catalog/<ver>/h/<xx>.json` (~2 KB gzip), Garlic pobiera kubełek tylko przy dodaniu usługi. Zachowaj argument bezpieczeństwa skrótu (Straż: 128-bit OK, opisać; łańcuch latest→indeks pełne 256 bit).
2. **Wyścig wersji ikon vs indeks** (Nika N1, Straż W5, Sowa drobne): niezgodność sha → wymuszone odświeżenie `latest.json` (≤ 1 / 15 min) + 1 ponowienie; dla SVG pobieranie niemutowalnego `/v1/f/<hash>`, zawsze zgodnego z indeksem. AC: zmiana w upstream + Garlic ze starym indeksem → ikona w `/data` ≤ 2 s.
3. **Ponawianie `<img>`** (Straż W1): `error` na `<img>` nie widzi nagłówków → `X-Icon-Pending` niewykonalne. Ponawiaj zawsze przy `error` 1/3/10 s (maks. 3) albo `fetch(HEAD)`/status. Popraw AC P6.
4. **Rulesety GitHub App** (Straż W2, Sowa W3): bypass obejmuje cały ruleset. Ruleset A (review + CODEOWNERS, bypass App) + ruleset B bez bypassu (wymagane checki `build` + `diff-scope`: PR od App może zmieniać tylko `sources.lock`). AC: PR od App dotykający `.github/` nie mergeuje się. Potwierdź zachowanie w dokumentacji GitHub.
5. **Anti-rollback/freeze** (Straż W4, wzorzec TUF): Garlic odrzuca `version` ≤ bieżącej; podpisane `expires` (+14 d), po wygaśnięciu zostaje obecny indeks + ostrzeżenie; rollback publikuje stare treści pod nową wyższą wersją. AC: starszy podpisany `latest.json` odrzucony.
6. **Wyzwalacz L3** (Sowa W2, Nika drobne): tanio wywoływalny (ok. 1,1k req/s z kilkunastu IP, 0 USD) → miesiąc bez nowych ikon. Wyzwalacz szybkościowy tylko gdy miesięczne GET ≥/bliskie 10M; próg m15 > ~5M; L3 trzymane 24–72 h z ponownym uzbrojeniem, ręczne zdjęcie przy drugim wejściu w miesiącu. Wpisz do D2 z alternatywą „dzienny budżet”. Opóźnienie GraphQL R2 → [NZ], mierzyć w E0 (najgorszy przypadek przy 20 min ~72 USD).
7. **Token bezpiecznika** (Straż W3): tylko Zone WAF Edit (custom + RL), bez Transform/Redirect/Config; `zi-guard` co 5 min porównuje WAF/RL/Transform/Rewrite z oczekiwanym stanem z repo → alert + przywrócenie. Osobne AppRole Vault dla notariusza i bezpiecznika.
8. **FTS5 injection** (Straż W6): parametr wiązany, fraza w cudzysłowach ze zdwojeniem `"`, ≤ 64 znaki, filtr znaków (lub LIKE/GLOB na trigramie). AC: `" OR`, `NEAR(`, `*`, 10 KB śmieci → 200/400, p95 ≤ 20 ms. Plus „złoty zestaw” ~30 zapytań: wyniki = dzisiejszy Search (Nika).
9. **RAM** (Nika N3, Sowa W5, Straż drobne): `GOMEMLIMIT` z zapasem (nie równy celowi) lub ustalany po benchmarku; podnoszony na czas importu (`debug.SetMemoryLimit`); R2 etap 3 ≤ idle + 14 MiB lub `cache_size` ograniczone w imporcie; PoC powtórzyć na prawdziwym Garlicu; CPU idle nie rośnie. Uczciwie w §4.10: przy 5k zysk idle ~0,5 MB, szczyt importu wyższy niż mapy (+10 vs +4,2 MB) — zysk od etapu 3; decyzja SQLite uzasadniona wzrostem katalogu i brakiem JSON w pamięci. `fsync` przed `rename` przy `synchronous=OFF`; odbudowa przy uszkodzeniu.
10. **Miniatury pickera** (Nika N2): jawnie `/var/cache/garlic/thumbs` (warstwa kontenera, nie `/data`, nie tmpfs); `index-<ver>.db` w `/data` = indeks, dozwolony. AC: po przeglądaniu pickera `/data` = indeks + ikony dodanych usług.
11. **Estymaty** (Sowa W4, Nika): E1 realnie 16–20 d → podziel na E1a (API + sanitizer + compat + Garlic na API z integralnością) i E1b (bezpiecznik, benchmark, reszta), żeby nasza instancja przeszła wcześniej.

## DROBNE
- Ujednolić „miękki sufit” (§5.1, §7 vs §5.5/D2); §5.4 reguła 3 vs §5.5 (compat metadata). Klasa A 275k vs 285k.
- Prywatność: dzienne `latest.json` = obraz aktywnych instalacji w analityce CF → §4.7, `/privacy`, README.
- `ServeContent` = sendfile tylko bez TLS/gzip — nie obiecywać bezwarunkowo.
- Base64url zamiast hex dla skrótów (opcjonalnie).

## DECYZJE CEO
- Dodaj **D11**: benchmark z nazwami Homarr/Homepage/Dashy publicznie (reklama porównawcza — obiektywna i sprawdzalna, pytanie do prawnika) czy tylko wewnętrznie.
- D2 uzupełnij o nowy kształt L3 i alternatywę „dzienny budżet”.
