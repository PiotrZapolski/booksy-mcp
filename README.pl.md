# booksy-mcp po polsku

[![Licencja: MIT](https://img.shields.io/badge/licencja-MIT-blue)](LICENSE)
![Node.js 20 lub nowszy](https://img.shields.io/badge/node-%3E%3D20-339933)
![Status: in daily use](https://img.shields.io/badge/status-in%20daily%20use-green)
[![PiotrZapolski/booksy-mcp MCP server](https://glama.ai/mcp/servers/PiotrZapolski/booksy-mcp/badges/score.svg)](https://glama.ai/mcp/servers/PiotrZapolski/booksy-mcp)

booksy-mcp to darmowy serwer MCP dla Booksy Biz na licencji MIT. Dzięki niemu Claude Code, Codex albo Claude Desktop czytają kalendarz salonu, grafiki pracowników, klientów, płatności i raporty przez Twoją własną, zalogowaną kartę w Chrome. Sesja nie opuszcza więc Twojego komputera: nie potrzebujesz klucza API, usługi w chmurze ani konta u strony trzeciej. Projekt jest nieoficjalny.

**Status:** autor korzysta z booksy-mcp codziennie, na działającym panelu salonu w Booksy Biz. Booksy może w każdej chwili zmienić panel, więc któreś narzędzie może przestać działać, dopóki projekt nie nadąży za zmianą. Gdy tak się stanie, załóż issue. Serwer jest w npm jako `booksy-biz-mcp`. Rozszerzenia Chrome nie ma w Chrome Web Store: polecenie `setup` rozpakowuje je do folderu, a Ty ładujesz je w trybie dewelopera.

> ### Zainstaluj w 3 minuty
>
> Wklej to do Claude Code albo Codex:
>
> ```text
> Zainstaluj booksy-mcp wg https://github.com/PiotrZapolski/booksy-mcp/blob/master/INSTALL.md i przeprowadź mnie przez to krok po kroku.
> ```
>
> Resztę zrobi agent. Od Ciebie potrzeba tylko czterech rzeczy: włączyć w Chrome tryb dewelopera, kliknąć "Załaduj rozpakowane", wpisać kod parowania i zrestartować klienta (Claude Code, Codex lub Claude Desktop). Możesz też sam uruchomić `npx -y booksy-biz-mcp setup` (sekcja [Ręcznie, bez agenta](#ręcznie-bez-agenta)).

Narzędzie nieoficjalne: nie jest powiązane z Booksy, a Booksy go nie popiera ani nie wspiera.
Najpierw przeczytaj o [ryzyku](README.md#risks).

Pakiet w npm nazywa się [`booksy-biz-mcp`](https://www.npmjs.com/package/booksy-biz-mcp). Pakiet `booksy-mcp` w npm należy do kogoś innego i
nie jest tym projektem, więc go nie instaluj. Polecenie w pakiecie i repozytorium nadal nazywają się
`booksy-mcp`.

## Kiedy użyć booksy-mcp, a kiedy nie?

booksy-mcp ma sens, gdy chcesz, żeby asystent AI na Twoim komputerze czytał dane salonu, i godzisz
się na [ryzyko](README.md#risks) związane z nieoficjalnym narzędziem.

Nie korzystaj z niego, jeśli potrzebujesz wspieranej integracji, utrata
konta Booksy byłaby dla Ciebie dotkliwa, nie masz komputera z Chrome i otwartą, zalogowaną kartą
panelu albo Twój asystent łączy się tylko ze zdalnymi serwerami MCP.

| | booksy-mcp | Oficjalne API Booksy | Narzędzia, które kopiują sesję albo działają w chmurze | Ręczny eksport z panelu |
| --- | --- | --- | --- | --- |
| Gdzie jest sesja logowania | W Twojej karcie Chrome. Token sesji nie jest odczytywany, kopiowany ani zapisywany | Poza zakresem tego porównania: API jest dla partnerów, właściciel salonu nie uzyska dostępu samodzielnie | Zależnie od narzędzia: skopiowana poza przeglądarkę albo przechowywana przez usługę | W Twojej przeglądarce |
| Gdzie trafiają dane klientów | Z karty do lokalnego serwera i Twojego klienta MCP. Dostawca AI tego klienta może je przetwarzać. Eksporty zostają na Twoim dysku | Zależy od integracji partnera | Zależy od narzędzia, mogą trafiać też na jego serwery | Do plików na Twoim komputerze, a potem tam, gdzie je wyślesz |
| Konto u strony trzeciej | booksy-mcp nie wymaga własnego konta. Nadal potrzebujesz logowania do Booksy Biz i klienta MCP | Dostęp partnerski | Zależy od narzędzia | Niepotrzebne |
| Licencja | MIT | Poza zakresem tego porównania | Zależy od narzędzia | Nie dotyczy |
| Dojrzałość | Autor używa go codziennie na działającym panelu; nieoficjalny, może przestać działać, gdy Booksy zmieni panel | Nie oceniamy | Zależy od narzędzia | Robisz to ręcznie w panelu |

## O co możesz zapytać asystenta?

Na każde z tych pytań jest w kodzie narzędzie do odczytu. Ważne odpowiedzi porównaj z tym, co
widzisz w Booksy.

- "Co mam jutro w kalendarzu?" (`calendar_agenda`)
- "Kto ma wolne terminy w piątek?" (`calendar_open_slots`)
- "Które rezerwacje czekają na potwierdzenie?" (`appointment_requests`)
- "Pokaż godziny pracy i nieobecności zespołu w tym tygodniu." (`staff_schedule`)
- "Znajdź tego klienta i pokaż jego wcześniejsze wizyty." (`customer_cards`, `customer_visit_history`)
- "Podsumuj płatności z zeszłego miesiąca." (`payment_summary`)
- "Co piszą klienci w ostatnich opiniach?" (`reviews_feed`)

## Co zobaczysz po drodze

1. Agent sprawdzi Node.js (wersja 20 lub nowsza) i uruchomi instalator z npm (`npx -y booksy-biz-mcp setup`).
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

Potrzebujesz Node.js 20 lub nowszego i Chrome 121 lub nowszego. Uruchom:

```sh
npx -y booksy-biz-mcp setup
```

Polecenie `setup` dodaje serwer do Claude Code, Codex i Claude Desktop (do tych, które znajdzie). Każdy
klient uruchamia potem serwer przez `npx -y booksy-biz-mcp`, więc niczego nie klonujesz ani nie
budujesz. Kopiuje też rozszerzenie Chrome z pakietu npm do folderu `~/booksy-mcp/extension`, próbuje otworzyć
`chrome://extensions` i wypisuje kolejne kroki. Opcje: `--client claude-code|codex|claude-desktop|all`,
`--dry-run` (tylko pokaż, nic nie zmieniaj), `--uninstall` (usuń), `--no-open`,
`--extension-dir <folder>`.

Skąd wziąć rozszerzenie Chrome: jest w pakiecie npm. `setup` rozpakowuje je do
`~/booksy-mcp/extension`, a `npx -y booksy-biz-mcp extension <folder>` kopiuje je do wskazanego
folderu i wypisuje ścieżkę. To samo rozszerzenie jest w każdym
[wydaniu na GitHubie](https://github.com/PiotrZapolski/booksy-mcp/releases/latest) jako plik
`booksy-mcp-extension-<wersja>.zip`. Ten folder wskazujesz w Chrome po kliknięciu
**Załaduj rozpakowane**.

Bez polecenia `setup` dodaj serwer sam. Claude Code:
`claude mcp add booksy --scope user -- npx -y booksy-biz-mcp`. Claude Desktop
(`claude_desktop_config.json`) i inne klienty z wpisem `mcpServers`:

```json
{
  "mcpServers": {
    "booksy": {
      "command": "npx",
      "args": ["-y", "booksy-biz-mcp"]
    }
  }
}
```

Tam, gdzie dokumentacja podaje `booksy-mcp <polecenie>`, przy npx wpisujesz
`npx -y booksy-biz-mcp <polecenie>`. Inne drogi: paczka dla Claude Desktop (niżej) albo budowanie ze
źródeł (`git clone`, `npm ci && npm run build`, potem `node dist/index.js setup`), opisane w sekcji
[Install](README.md#install). Kroki dla agenta znajdziesz w [INSTALL.md](INSTALL.md).

## Claude Desktop: paczka bez budowania

Każde [wydanie na GitHubie](https://github.com/PiotrZapolski/booksy-mcp/releases/latest) zawiera
paczkę MCP Bundle, a oficjalny [MCP Registry](https://registry.modelcontextprotocol.io) ma ją i
pakiet npm pod nazwą `io.github.PiotrZapolski/booksy-mcp`. Z paczką nie potrzebujesz terminala:

1. Pobierz `booksy-mcp-<wersja>.mcpb` z najnowszego wydania i otwórz plik w Claude Desktop (albo
   przeciągnij go do **Settings > Extensions**). Kliknij **Install**.
2. Pobierz `booksy-mcp-extension-<wersja>.zip` z tego samego wydania i rozpakuj. W Chrome wejdź na
   `chrome://extensions`, włącz **Tryb dewelopera**, kliknij **Załaduj rozpakowane** i wskaż
   rozpakowany folder.
3. Otwórz https://booksy.com/pro, zaloguj się i poproś asystenta o `session_status`. Pokaże
   8-znakowy kod: kliknij ikonę **Booksy MCP Bridge**, wpisz kod i kliknij **Połącz** (Connect).

Ustawienia paczki są w pliku `~/.config/booksy-mcp/config.json`, opis w sekcji
[Configuration](README.md#configuration).

## Zadania zaplanowane

`booksy-mcp job` pobiera stałą listę raportów i grafik bez klienta MCP i bez modelu językowego, np. co
wieczór z launchd. Działa przez to samo rozszerzenie i ten sam tryb bezpieczny co narzędzia (odstępy,
budżety, stop po 403/429/captcha). Gdy klient MCP już trzyma port, job łączy się z nim jako przekaźnik
i nie przeszkadza mu. `--open-panel` otwiera kartę panelu w tle tylko wtedy, gdy żadnej nie ma, i
zamyka ją na końcu. `--jitter <sekundy>` losowo opóźnia start. Kody wyjścia: 0 komplet, 1 częściowo,
2 nic, 3 brak rozszerzenia lub panelu, 4 przerwa po blokadzie. Opis opcji: sekcja
[Scheduled jobs](README.md#scheduled-jobs).

`booksy-mcp job --agenda --from <data> --to <data>` czyta kalendarz i wypisuje wizyty z telefonami
klientów jako jeden JSON na stdout (np. do przypomnień SMS). Nie zapisuje żadnych plików.
Klientom z aplikacji Booksy (bez numeru w kalendarzu) dociąga telefon ze szczegółów wizyty, najwyżej
`--details-limit` (domyślnie 30) na przebieg; `--known-customers <plik>` pomija klientów, których
numer już masz.

## Gdy coś nie działa

- Klient nie widzi narzędzi `booksy`: zrestartuj klienta (w Claude Code `/mcp` i połącz ponownie).
- Błąd `bridge_not_connected`: Chrome musi być otwarty z włączonym rozszerzeniem.
- Brak karty panelu: otwórz https://booksy.com/pro i zaloguj się.
- Port zajęty: inny klient już używa booksy-mcp. Zamknij go.
- Przerwa po blokadzie (cooldown): Booksy prosi o zwolnienie tempa. Poczekaj.

## FAQ

### Czy Booksy ma oficjalne API albo serwer MCP dla właścicieli salonów?

booksy-mcp to nieoficjalny serwer MCP dla Booksy Biz, nie jest produktem Booksy. Booksy Biz nie
udostępnia właścicielom salonów API, które można włączyć samodzielnie: oficjalne API jest dla
partnerów. Dlatego ten projekt działa przez panel w Twojej przeglądarce.

### Jak podłączyć Booksy do Claude albo ChatGPT?

booksy-mcp podłączysz do Claude Code, Claude Desktop i Codex: wklej zdanie z ramki
"Zainstaluj w 3 minuty" w Claude Code albo Codex. Serwer działa lokalnie przez stdio i nie ma
zdalnego adresu URL. Polecenie `setup` nie konfiguruje aplikacji ChatGPT. Z narzędzi OpenAI
obsługiwany jest Codex.

### Czy booksy-mcp jest bezpieczny dla mojego konta Booksy?

booksy-mcp nie może zagwarantować bezpieczeństwa konta: Booksy może je zawiesić albo zamknąć za
złamanie regulaminu, a niektóre wersje regulaminu zakazują automatycznych narzędzi. Tryb bezpieczny
ogranicza ruch, a po błędzie 403, 429 albo captcha program się zatrzymuje, ale ryzyko zostaje.
Przed użyciem przeczytaj sekcję [Risks](README.md#risks).

### Które klienty MCP są obsługiwane?

booksy-mcp ma automatyczną konfigurację (`setup`) dla Claude Code, Codex i Claude Desktop.

### Czy działa bez Chrome?

Nie, booksy-mcp wymaga Chrome 121 lub nowszego z rozszerzeniem oraz otwartej karty Booksy Biz, na
której jesteś zalogowany. Dotyczy to też zadań zaplanowanych.

### Czy może dodawać i zmieniać rezerwacje?

booksy-mcp ma narzędzia zapisu, które dodają, przenoszą i odwołują wizyty, ale wszystkie są
domyślnie wyłączone. Każde włączasz na serwerze, w rozszerzeniu zaznaczasz **Allow writes**, a każdy
zapis ma dwa kroki: próbę na sucho i potwierdzenie. Szczegóły: [Writes](README.md#writes).

### Czy jest darmowy?

Tak, booksy-mcp jest darmowy i udostępniony na licencji [MIT](LICENSE). Konto Booksy, asystent AI i
SMS-y z kampanii mają własne warunki i ceny.
