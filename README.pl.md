# booksy-mcp po polsku

Serwer [MCP](https://modelcontextprotocol.io) dla **Booksy Biz**. Twój asystent AI może czytać kalendarz salonu, grafiki pracowników, klientów, płatności i raporty, korzystając z Twojej własnej, zalogowanej karty w przeglądarce. Hasła ani sesja nie opuszczają Twojego komputera. Pełny opis (po angielsku) jest w [README.md](README.md).

> ### Zainstaluj w 3 minuty
>
> Wklej to do Claude Code albo Codex:
>
> ```text
> Zainstaluj booksy-mcp wg https://github.com/PiotrZapolski/booksy-mcp/blob/master/INSTALL.md i przeprowadź mnie przez to krok po kroku.
> ```
>
> Resztę zrobi agent. Od Ciebie potrzeba tylko czterech rzeczy: włączyć w Chrome tryb dewelopera, kliknąć "Załaduj rozpakowane", wpisać kod parowania i zrestartować klienta (Claude Code, Codex lub Claude Desktop).

## Co zobaczysz po drodze

1. Agent sprawdzi Node.js (wersja 20 lub nowsza) i pobierze program.
2. Agent doda serwer `booksy` do Twojego klienta. Inne wpisy zostają, a przed zmianą powstaje kopia pliku.
3. Agent rozpakuje rozszerzenie do folderu `~/booksy-mcp/extension` i poda Ci jego ścieżkę.
4. Ty w Chrome: wejdź na `chrome://extensions`, włącz **Tryb dewelopera** (prawy górny róg), kliknij **Załaduj rozpakowane** i wskaż ten folder.
5. Ty: zrestartuj klienta, żeby zobaczył nowy serwer.
6. Ty: otwórz https://booksy.com/pro i zaloguj się. Zostaw tę kartę otwartą.
7. Agent pokaże 8-znakowy kod. Kliknij ikonę **Booksy MCP Bridge**, wpisz kod i kliknij **Połącz** (Connect).
8. Agent sprawdzi połączenie i pokaże nazwę Twojego salonu.

## Bezpieczeństwo w skrócie

- Zapytania do Booksy wysyła sam panel w Twojej karcie. Program nie widzi ani nie zapisuje Twojej sesji.
- Ruch jest spokojny, jak u człowieka klikającego w panelu. Przy blokadzie lub captcha program zatrzymuje się i niczego nie omija.
- Zapisy (zmiany w kalendarzu, wiadomości) są domyślnie wyłączone i włączasz je sam.
- To narzędzie nieoficjalne, niezwiązane z Booksy. Przeczytaj sekcję [Risks](README.md#risks).

## Ręcznie, bez agenta

Po zbudowaniu projektu (`npm ci && npm run build`) uruchom `node dist/index.js setup`. Opcje: `--client claude-code|codex|claude-desktop|all`, `--dry-run` (tylko pokaż), `--uninstall` (usuń). Szczegółowe kroki znajdziesz w [INSTALL.md](INSTALL.md).

## Zadania zaplanowane

`booksy-mcp job` pobiera stałą listę raportów i grafik bez klienta MCP i bez modelu językowego, np. co
wieczór z launchd. Działa przez to samo rozszerzenie i ten sam tryb bezpieczny co narzędzia (odstępy,
budżety, stop po 403/429/captcha). Gdy klient MCP już trzyma port, job łączy się z nim jako przekaźnik
i nie przeszkadza mu. `--open-panel` otwiera kartę panelu w tle tylko wtedy, gdy żadnej nie ma, i
zamyka ją na końcu. `--jitter <sekundy>` losowo opóźnia start. Kody wyjścia: 0 komplet, 1 częściowo,
2 nic, 3 brak rozszerzenia lub panelu, 4 przerwa po blokadzie. Opis opcji: sekcja
[Scheduled jobs](README.md#scheduled-jobs).

## Gdy coś nie działa

- Klient nie widzi narzędzi `booksy`: zrestartuj klienta (w Claude Code `/mcp` i połącz ponownie).
- Błąd `bridge_not_connected`: Chrome musi być otwarty z włączonym rozszerzeniem.
- Brak karty panelu: otwórz https://booksy.com/pro i zaloguj się.
- Port zajęty: inny klient już używa booksy-mcp. Zamknij go.
- Przerwa po blokadzie (cooldown): Booksy prosi o zwolnienie tempa. Poczekaj.
