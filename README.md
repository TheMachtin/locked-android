# Locked 2.0

Persönliches Tracking als **Android-App**, **Desktop-Programm** und **Web-App** —
ein Quellcode (`www/`), drei Hüllen.

| Plattform | Bezug | Installation |
|---|---|---|
| Android | APK aus dem [neuesten Release](https://github.com/TheMachtin/locked-android/releases) | antippen → „Von unbekannter Quelle zulassen" |
| Windows | `Locked-Setup-2.0.N.exe` aus demselben Release | ausführen; portable Variante liegt daneben |
| Linux | `Locked-2.0.N.AppImage` | ausführbar machen und starten |
| Browser | <https://themachtin.github.io/locked-android/> | Edge/Chrome → „App installieren" |

Alle Installationen teilen sich dieselbe OneDrive-Datei und führen parallele
Änderungen dreiwegig zusammen — Handy und PC dürfen gleichzeitig laufen.

## Wie die Punkte entstehen

```
Einnahmen = (verschlossene Stunden × Satz des Modells + Bonus) × Streak-Multiplikator
Kosten    = offene Stunden × Satz + Preis je Orgasmus
Konto     = Summe aller Tagesergebnisse seit dem Stichtag
Form      = Form gestern × 0,97 + Tagesergebnis
```

Drei Eigenschaften, die das Modell tragen:

**Der Streak wirkt als Multiplikator, nicht als Summand.** `1 + 0,02 × orgasmusfreie
Tage`, gedeckelt bei 2,0. Er verstärkt, was tatsächlich getan wurde — ohne Käfig
gibt es auch mit 200 Tagen Streak nichts.

**Der Orgasmus hat einen sichtbaren Preis.** `15 + 45 × 2^(−Wartetage/7)`: heute
nach dem letzten kostet er 60, nach einer Woche 37, nach einem Monat 17. Die App
zeigt den aktuellen Preis an, *bevor* man ihn zahlt. Ein Streak-Bruch ist damit
eine bezifferte Entscheidung statt einer stillen Katastrophe.

**Konto und Form sagen Verschiedenes.** Das Konto summiert und wächst zwangsläufig.
Die Form klingt mit 3 % pro Tag ab, läuft gegen einen Grenzwert und bleibt
dadurch über Jahre vergleichbar: ein Ausrutscher dellt sie, zerstört sie nicht,
und zwei ruhige Wochen bauen sie spürbar ab.

Jede Zahl darin steht im Tab **Regeln** und liegt in der Datei, nicht im Programm.

### Warum 1.x abgelöst wurde

Die alte Formel war `Streak = Streak × 1,07 + Basis` — eine Rekursion ohne
Fixpunkt:

| Tag | Streak-Punkte/Tag | Anteil der Tragestunden am Tagesergebnis |
|---|---|---|
| 1 | 8 | 56 % |
| 30 | 755 | 1,3 % |
| 90 | 50.300 | 0,02 % |
| 365 | 6,1 · 10¹² | ~0 % |

Ab etwa Tag 40 maß die App nur noch „Tage seit dem letzten Orgasmus"; ob 24 oder
4 Stunden getragen wurde, war rechnerisch Rauschen. Der Orgasmus kostete nominal
−10, real aber den ganzen Streak — unbezifferbar und nirgends sichtbar. Und
„Ungeöffnet" hieß *kein Eintrag an dem Tag*, mit der höchsten Basis im Modell:
die App nicht zu benutzen zahlte sich am besten aus.

## Modelle sind Daten

Käfige, Ereignisse und Sätze stehen unter **Regeln**, nicht im Quellcode. Je
Modell einstellbar: Bezeichnung, Farbe, Punkte je Stunde, „zählt als
verschlossen". Ein neuer Käfig — oder derselbe Käfig in zwei Trageweisen — ist
ein Eintrag, kein Release.

Zwei Eigenschaften trägt das Programm mit und sichert sie gegen Unsinn ab:

- **offener Zustand** — der Startzustand jeder Historie und das Ziel automatischer
  Einträge. Genau einer, nicht löschbar, nicht archivierbar.
- **Regeneration** — trägt Fenster und Sperrfrist. Höchstens eine, darf fehlen.

Solange kein Eintrag auf ein Modell zeigt, folgt seine interne ID dem Namen
(„Cobra Variante A" → `COBRAV`). Sobald Einträge existieren, bleibt sie fest und
das Modell lässt sich nur noch archivieren — sonst zeigten alte Tage ins Leere.

## Der Umstieg von 1.x

Beim ersten Start rechnet `www/js/core/legacy.js` die alte Formel ein letztes Mal
durch und legt das Ergebnis als `legacy` in der Datei ab. Danach wird dort nichts
mehr gerechnet, nur noch angezeigt — als Archiv-Karte im Dashboard. Das neue
Konto startet bei null.

Der Schnappschuss steht **in der Datei, nicht im Programm**: wer die App frisch
installiert, hat kein `legacy` und sieht die Karte gar nicht erst.

2.0 schreibt nach `locked2.json` statt nach `locked.json`. Die alte App kennt
weder `settings` noch `legacy` und würde beides beim Speichern stillschweigend
entfernen; getrennte Dateien halten 1.x als Rückfallebene lauffähig. Die
Übernahme läuft über **Daten → Daten aus Version 1.x übernehmen** (aus OneDrive
oder aus einer Datei) und erkennt Dubletten, ist also gefahrlos wiederholbar.

Die Einträge selbst bleiben unangetastet: Tragezeit, Orgasmus-Zähler und der
getragene Zustand laufen über den Schnitt hinweg durch. Nur die Punkte beginnen neu.

## Aufbau

```
www/
  index.html          nur Struktur
  css/app.css
  js/
    core/             ohne DOM, in Node testbar
      time.js         Datum und Zeit, lokal und sommerzeitfest
      settings.js     Modell-Registry, Normalisierung, Preisformel
      calc.js         Einnahmen, Kosten, Konto, Form
      legacy.js       die alte Formel, eingefroren
      migrate.js      1.x → 2.0, Stichtag, Archiv
      merge.js        Drei-Wege-Merge für den Sync
      escalation.js   Inaktivitäts-Vorschläge
    sync/             auth.js · onedrive.js · files.js
    ui/               eintrag · dashboard · einstellungen · daten · charts
    state.js          zentraler Zustand, alle Änderungen über mutate()
    platform.js       Android / Desktop / Web an einer Stelle
electron/             main.js · preload.cjs — die Desktop-Hülle
test/                 node --test, ohne Testframework
```

Keine Build-Kette, kein Framework: ES-Module, die der Browser direkt lädt.
Derselbe Ordner geht unverändert in die APK, in den Installer und nach Pages.

```bash
npm test          # 65 Tests, nur Node-Builtins
npm start         # Desktop-App lokal starten
npm run build:win # Windows-Installer (auf Windows)
npx serve www     # Web-Version lokal
```

## Microsoft-Login (OneDrive-Sync)

Drei Wege, weil MSAL nur im echten Browser funktioniert:

| Hülle | Verfahren | Redirect-URI | Azure-Plattform |
|---|---|---|---|
| Web | MSAL-Popup | `https://themachtin.github.io/locked-android/` | Single-page application |
| Android | Auth-Code + PKCE im System-Browser | `locked://auth` | Mobile- und Desktopanwendungen |
| Desktop | Auth-Code + PKCE, Rücksprung über Loopback | `http://localhost` | Mobile- und Desktopanwendungen |

Alle drei müssen unter [App-Registrierungen → Authentifizierung](https://portal.azure.com)
eingetragen sein. `http://localhost` erlaubt dort ausdrücklich beliebige Ports —
die Desktop-App sucht sich beim Anmelden einen freien.

### Die Falle in der neuen Azure-Oberfläche

Auf der Seite **Authentication (Preview)** legt der Knopf *+ Umleitungs-URI
hinzufügen* keine einzelne URI an: das Panel schickt die schon vorhandenen
benutzerdefinierten URIs mit. Ist `locked://auth` bereits registriert, steht es
dort vorausgefüllt im Feld und wird beim Speichern ein zweites Mal übermittelt.
Azure lehnt das ab mit

> Umleitungs-URIs müssen eindeutig identifizierbare Werte aufweisen.

Die Meldung klingt nach einem Konflikt mit der URI, die man gerade eintippt —
gemeint ist aber die doppelt gesendete bestehende. Zwei Wege daran vorbei:

- über den Link *„To switch to the old experience"* im Banner oben auf die alte
  Oberfläche wechseln und die URI dort hinzufügen, oder
- in der Tabelle in der Zeile *Mobilgerät- und Desktopanwendungen* auf
  **Bearbeiten** gehen (nicht auf *+ Umleitungs-URI hinzufügen*) und die neue URI
  als zusätzliche Zeile ergänzen.

Die angebotenen Häkchen (`nativeclient`, `LiveSDK`, `msal…://auth`) bleiben leer.

Zwei weitere Details, die leicht übersehen werden:

- Android und Desktop tauschen den Token **nicht** per `fetch()`. Ein `fetch()`
  aus der WebView schickt einen `Origin`-Header mit, den Azure bei
  Nicht-SPA-Redirect-URIs mit `AADSTS9002326` ablehnt. Android nutzt
  `CapacitorHttp`, der Desktop den Hauptprozess.
- Der Scope `offline_access` ist nötig, sonst müsste man sich stündlich neu
  anmelden.

Welche URI die laufende Installation sendet, steht in der App unter
**Daten → OneDrive-Sync**.

## Build

Jeder Push auf `main` löst drei Workflows aus, die dieselbe Versionsnummer
berechnen (Commit-Anzahl → `2.0.N`) und sie über `scripts/bake-version.sh`
eintragen — Handy, PC und Web zeigen nach einem Push also dieselbe Nummer:

| Workflow | Ergebnis |
|---|---|
| `build-apk.yml` | signierte APK, als Artefakt und am Release |
| `build-desktop.yml` | Windows-Installer, portable `.exe`, Linux-AppImage |
| `deploy-pages.yml` | `www/` nach GitHub Pages |

Alle drei laufen erst nach `npm test`.

Die Desktop-Pakete sind **nicht signiert** — ein Zertifikat kostet Geld und
bringt für eine App, die nur ihr Autor installiert, nichts. Windows zeigt beim
ersten Start den SmartScreen-Hinweis: „Weitere Informationen" → „Trotzdem
ausführen".

## Updates

Jede Hülle hat ihren eigenen Weg:

| Plattform | Weg | Auslöser |
|---|---|---|
| Android | Banner beim Start, lädt die APK und öffnet den Installer | eigene Prüfung gegen die GitHub-API |
| Desktop (Installer) | `electron-updater` lädt im Hintergrund, Banner „Neu starten" | `latest.yml` am Release |
| Desktop (portabel) | keiner — neue `.exe` von Hand holen | — |
| Web | Service Worker, Banner „Aktualisieren" | neuer Deploy auf Pages |

Am Desktop wird **geladen** ohne zu fragen, **installiert** aber erst auf Klick:
ein Neustart mitten im Eintippen wäre eine unangenehme Überraschung. Wer den
Knopf ignoriert, bekommt das Update beim nächsten regulären Beenden.

Zwei Voraussetzungen, die leicht verlorengehen:

- Am Release müssen neben den Paketen auch `latest.yml` (Windows) und
  `latest-linux.yml` (Linux) hängen — ohne sie findet der Updater nichts. Der
  Build erzeugt sie, weil in der `package.json` ein `publish`-Ziel steht, und
  `build-desktop.yml` lädt sie ausdrücklich mit hoch.
- `electron-updater` gehört zu den **dependencies**, nicht zu den
  devDependencies: es läuft im ausgelieferten Hauptprozess mit.

Die portable Fassung ist bewusst ausgenommen — eine laufende Einzeldatei kann
sich nicht selbst ersetzen. Erkannt wird sie an `PORTABLE_EXECUTABLE_DIR`, das
electron-builder dort setzt.

### Einmalig einzurichten

1. **Signatur für Android**: Actions → *Bootstrap Signing Keystore* → *Run
   workflow*; danach `keystore.base64.txt` als Secret `KEYSTORE_BASE64` und das
   Passwort als `KEYSTORE_PASSWORD` hinterlegen. Die `.jks`-Datei offline
   aufheben — bei Verlust ist kein App-Update mehr möglich.
2. **Pages aktivieren**: Settings → Pages → *Source: GitHub Actions*. Das muss von
   Hand passieren; der `GITHUB_TOKEN` darf die Pages-Site nicht anlegen
   (`Resource not accessible by integration`).
3. **Redirect-URIs in Azure** eintragen, siehe Tabelle oben.

## Datenformat

```jsonc
{
  "version": 3,
  "events":   [ { "date": "…", "time": "HH:MM", "type": "HT" } ],
  "settings": { "models": [ … ], "points": { … }, "rules": { … },
                "startedAt": "…",        // optional, nur wenn von Hand gesetzt
                "updatedAt": "…" },
  "legacy":   { "punkte": …, "von": "…", "bis": "…" },   // fehlt bei Neuinstallation
  "days": {}, "notes": {}, "meta": {}
}
```

### Der Stichtag wird abgeleitet

Ab wann das Konto zählt, steht normalerweise **nirgends** — es ergibt sich:

| Lage | Konto zählt ab |
|---|---|
| kein Archiv | dem ersten Eintrag, also **alles** |
| Archiv vorhanden | dem Tag nach dessen Ende |
| `settings.startedAt` gesetzt | diesem Datum |

Ein festes Datum beim ersten Start wäre falsch: wer die App heute installiert und
die letzten beiden Tage nachträgt, will diese Tage gewertet haben — ohne alte Ära
gibt es ja nichts, wovon zu trennen wäre. Umgekehrt darf der Stichtag nie *vor*
das Archiv rutschen, sonst stünden dieselben Tage zweimal in der Wertung, einmal
nach alter und einmal nach neuer Formel. Das Feld im Tab **Regeln** setzt ihn von
Hand und lässt sich wieder leeren.

Gespeichert werden nur **Ereignisse und Regeln**, nie Punkte. Jede Regeländerung
rechnet die Historie automatisch neu — es ist nicht möglich, damit Daten
kaputtzumachen. Einzige Ausnahme ist `legacy`: der Schnappschuss ist absichtlich
eingefroren und wird auch vom Merge nie überschrieben.
