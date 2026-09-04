# Locked 2.0

Persönliches Tracking als **Android-App**, **Desktop-Programm** und **Web-App** —
ein Quellcode (`www/`), drei Hüllen.

| Plattform | Bezug | Installation |
|---|---|---|
| Android | APK aus dem [neuesten Release](https://github.com/TheMachtin/locked-android/releases) | antippen → „Von unbekannter Quelle zulassen" |
| Windows | `Locked-Setup-2.1.N.exe` aus demselben Release | ausführen; portable Variante liegt daneben |
| Linux | `Locked-2.1.N.AppImage` | ausführbar machen und starten |
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
Modell einstellbar: Bezeichnung, Farbe, Punkte je Stunde und der
Verschluss-Zustand. Ein neuer Käfig — oder derselbe Käfig in zwei Trageweisen —
ist ein Eintrag, kein Release.

Der **Verschluss-Zustand** ist eine Auswahl aus dreien:

| | verdient | zählt als | Phase „verschlossen seit" |
|---|---|---|---|
| **Verschlossen** | Stundensatz + Durchgehend-Bonus | verschlossene Zeit | läuft |
| **Unterbrechung** | nichts (Satz 0) | weder noch | läuft weiter |
| **Offen** | kostet den Stundensatz | offene Zeit | beginnt neu |

Die **Unterbrechung** gibt es, weil die Reinigung sonst als Öffnung gebucht
werden müsste: zehn Minuten am Waschbecken hätten die verschlossene Phase auf
null gesetzt und den Tagesbonus gekostet — eine Aussage über den Käfig, die
niemand gemeint hat. Einen Deckel braucht sie nicht: sie verdient nichts, eine
lange „Reinigung" kostet also von allein jede Stunde, die der Käfig gebracht
hätte.

Zwei weitere Eigenschaften trägt das Programm mit und sichert sie gegen Unsinn ab:

- **offener Zustand** — der Startzustand jeder Historie und das Ziel automatischer
  Einträge. Genau einer, nicht löschbar, nicht archivierbar, nie „verschlossen"
  oder „Unterbrechung".
- **Regeneration** — trägt Fenster und Sperrfrist. Höchstens eine, darf fehlen.

Solange kein Eintrag auf ein Modell zeigt, folgt seine interne ID dem Namen
(„Cobra Variante A" → `COBRAV`) — und lässt sich in demselben Zeitraum auch von
Hand setzen. Sobald Einträge existieren, bleibt sie fest und das Modell lässt
sich nur noch archivieren; sonst zeigten alte Tage ins Leere.

Die Wahl lohnt sich, sobald zwei Modelle gleich anfangen: „Steelworxx mit" und
„Steelworxx ohne" ergeben von allein `STEELW` und `STEELW2` — zwei Adressen, die
niemand auseinanderhält. `SM` und `SO` stehen dann nicht nur in `locked://log?m=SM`,
sondern auch auf dem Knopf der Uhr, denn eine kurze ID, die zum Namen passt,
*ist* dort das Kürzel. Eine selbst gesetzte ID wandert beim Umbenennen übrigens
nicht mehr mit: sie steht in Adressen, die anderswo eingerichtet sind.

## Eintragen, ohne die App zu öffnen

Ein Eintrag ist ein Zeitpunkt und ein Modell. Dafür das Telefon zu entsperren,
die App zu suchen, den richtigen Tab abzuwarten und eine Taste zu halten, ist
viel Weg für wenig Inhalt — besonders in dem Moment, in dem der Käfig gerade
zugeht. Jedes Modell hat deshalb eine Adresse:

```
locked://log?m=HT
```

Wer sie öffnet, hat eingetragen: aktuelle Uhrzeit, aktuelles Datum, keine
Rückfrage. Die App speichert nach OneDrive, meldet den Eintrag als
Benachrichtigung und geht wieder in den Hintergrund — das Telefon bleibt, wo es
war.

| Parameter | Bedeutung | Standard |
|---|---|---|
| `m` | Modell: ID (`HT`) oder Name (`Holy Trainer`) | — |
| `t` | Uhrzeit `HH:MM` | jetzt |
| `d` | Datum `YYYY-MM-DD`, `-1`, `gestern` | heute |
| `app` | die App offen lassen statt sie zu schließen | aus |

Die ID steht in der App unter **Daten → Kurzbefehle**, je Modell eine fertige
Adresse zum Kopieren. Der Name tut es auch — die ID ist nur die stabilere
Angabe, weil sie sich beim Umbenennen nicht ändert.

Dieselbe Anweisung nimmt die Web-App als Parameter der Seite entgegen:
`https://themachtin.github.io/locked-android/?log=HT`. Ein Lesezeichen genügt.

**Zweimal ausgelöst ist einmal eingetragen.** Ein Fehlgriff, eine hängende
Automation, ein zweiter Tastendruck: derselbe Eintrag in derselben Minute wird
nicht doppelt geschrieben, sondern gemeldet. Alles andere wäre am Handgelenk
nicht von Erfolg zu unterscheiden.

### Am Startbildschirm

Langer Druck auf das App-Symbol zeigt die Zustände als Kurzbefehle; jeder lässt
sich einzeln auf den Startbildschirm ziehen. Sie stehen nicht im Build, sondern
kommen aus der Registry — ein neuer Käfig erscheint dort, sobald er in **Regeln**
angelegt ist, mit seiner Farbe und seinem Kürzel.

Android zeigt vier bis fünf davon. Ist die Liste länger, bleibt der offene
Zustand trotzdem dabei: eine Auswahl aus lauter Käfigen ohne den Weg heraus wäre
die Hälfte der Wahrheit.

**Ereignisse mit Preis sind nicht dabei.** Ein Kurzbefehl fragt nicht nach, und
ausgelöst wird er unterwegs, ohne hinzusehen — ein Fehlgriff soll deshalb nichts
kosten können. Wer den Orgasmus trotzdem auf die Uhr legen will, baut seine
Adresse von Hand; angeboten wird sie nicht.

### Die Kachel auf der Galaxy Watch

Eine Wischbewegung vom Zifferblatt, ein Tipp. Oben auf der Kachel steht, was
gerade getragen wird und seit wann, darunter liegen die Modelle als farbige
Knöpfe mit ihrem Kürzel.

**Was gerade getragen wird, ist kein Knopf.** Sein Tipp setzte den Zustand auf
den Zustand — er belegte nur den Platz eines Knopfes, der etwas ändern kann. Die
Auskunft steht als Zeile darüber, und die übrigen Knöpfe werden dafür größer: die
Kachel zeichnet weniger Knöpfe größer, und drei trifft man unterwegs besser als
vier. Der offene Zustand bleibt dabei gesetzt, solange er nicht selbst der
getragene ist — wer offen ist, braucht den Ausweg nicht.

Führt jemand mehr Modelle, als auf ein Zifferblatt passen, kommen die Käfige
zuerst und darunter die zuletzt häufiger getragenen; Reinigung und Regeneration
rücken nach, wenn Platz bleibt. Gezeichnet wird trotzdem in der Reihenfolge der
Registry: welcher Knopf wo liegt, soll sich nicht mit der Nutzung verschieben,
sonst lernt man die Kachel nie.

**Auf dem Knopf steht die ID** — dieselbe, die in `locked://log?m=NS` steht, in
den Kurzbefehlen und in einer Automation. Nur wo sie dafür zu lang ist (`REG`)
oder nichts mehr mit dem Namen zu tun hat (`KK` für „Nicht verschlossen"),
rechnet die App zwei Buchstaben aus dem Namen: „RE" und „NV". Zweimal dasselbe
Kürzel gibt es nicht — „Regeneration" und „Reinigung" ergäben beide „RE", also
weicht das zweite auf seine ID aus und wird „CL". Weicht ein Kürzel so von der ID
ab, steht es unter **Daten → Kurzbefehle** neben dem Modell.

**Die Uhr rechnet dabei nichts.** Sie kennt die Modell-Registry, die das
Telefon herüberschickt, und sie schickt eine Modell-ID mit dem Zeitpunkt des
Tippens zurück — daraus wird drüben dieselbe Adresse `locked://log?m=…` wie bei
jedem Kurzbefehl. Der Eintrag entsteht damit an genau einer Stelle im Programm;
eine zweite, die irgendwann anders rechnet, kann es gar nicht geben. Aus
demselben Grund schreibt kein Dienst die Datei direkt: er wüsste nichts von der
laufenden WebView und nichts vom Sync.

**Ein Tipp geht nicht verloren, wenn das Telefon nicht da ist.** Es liegt ja
gerade deshalb im anderen Zimmer — sonst bräuchte es die Uhr nicht. Kommt die
Nachricht nicht durch, hebt die Uhr den Tipp auf und stellt ihn zu, sobald sie
das Telefon wieder erreicht: beim nächsten Blick auf die Kachel, beim Öffnen der
Uhr-App oder wenn das Telefon von sich aus eine neue Registry schickt.
Nachgereicht wird er mit seinem Zeitstempel — `locked://log?m=NS&t=14:05&d=2026-09-04` —
und steht damit in der Historie, wo er passiert ist, nicht wo er ankam. Erst ab
zwei Minuten Verspätung; darunter bleibt die Uhrzeit des Telefons maßgeblich,
denn zwei Uhren gehen nie exakt gleich.

Solange etwas wartet, steht das oben auf der Kachel — „wartet: Neosteel" —
*statt* des Zustands. Das Telefon weiß von dem Wechsel ja noch nichts und würde
weiter den alten melden; „Neosteel · 1 h 25" wäre in dem Moment die falscheste
Auskunft, die die Kachel geben kann. Ein zweiter Tipp auf dasselbe Modell ändert
nichts: gemeint war der Wechsel, nicht das Nachfassen, also bleibt der frühere
Zeitpunkt stehen. Und weil dasselbe Modell in derselben Minute drüben ohnehin nur
einmal eingetragen wird, ist ein doppelt zugestellter Tipp folgenlos.

Der Tipp öffnet keine App. `LoadAction` ruft die Kachel erneut auf, sie erkennt
den Knopf, schickt und zeichnet sich sofort mit der Rückmeldung neu — der
Bildschirm bleibt, wo er ist. Die eigentliche Bestätigung kommt als
Benachrichtigung des Telefons und steht damit ohnehin auf der Uhr; bei einem
Orgasmus mit dem Preis darin.

#### Installieren — ein PC ist nicht nötig

Wear-OS-Apps kommen normalerweise aus dem Play Store; für eine App mit einem
Nutzer wären das zwölf Tester über vierzehn Tage und eine öffentliche
Store-Seite. Bleibt der Weg über ADB — und den kann das Telefon selbst gehen.

**1. Auf der Uhr: Entwicklermodus**

- *Einstellungen → Info zur Uhr → Softwareinformationen* → fünfmal auf
  **Softwareversion** tippen.
- *Einstellungen → Entwickleroptionen* → **ADB-Debugging** an, dann
  **Drahtloses Debugging** an. Dort stehen IP-Adresse und Port; unter
  **Neues Gerät koppeln** erscheinen Kopplungscode und ein *zweiter*, eigener
  Kopplungs-Port. Die beiden Ports sind nicht derselbe — das ist die häufigste
  Stolperstelle.

**2. Am Telefon: die APK holen**

`wear-release.apk` aus dem neuesten [Release](https://github.com/TheMachtin/locked-android/releases)
herunterladen. Sie darf im Download-Ordner liegen bleiben.

**3. Am Telefon: aufspielen**

Mit **Wear Installer 2** (kostenlos im Play Store; es gibt auch *Bugjaeger*,
gleiches Prinzip): Uhr und Telefon im selben WLAN, dann in der App den
Kopplungscode samt IP und Kopplungs-Port eintragen, danach mit IP und dem
regulären Port verbinden. Anschließend **APK vom Gerät installieren** und die
heruntergeladene Datei auswählen. Gekoppelt wird nur einmal; beim nächsten Mal
genügt das Verbinden.

Wer lieber am PC arbeitet, tut dasselbe mit `adb` — Uhr und PC im selben WLAN:

```bash
adb pair 192.168.1.42:37123     # Kopplungs-Port und Code aus „Neues Gerät koppeln"
adb connect 192.168.1.42:5555   # der Port aus „Drahtloses Debugging"
adb install -r wear-release.apk
```

**4. Auf der Uhr: Kachel hinzufügen**

Zifferblatt nach links wischen bis zum **+** → **Locked**. In der App-Übersicht
steht dieselbe Auswahl mit vollen Namen.

**5. Am Telefon, einmalig**

- Locked öffnen — dabei geht die Registry an die Uhr.
- *Daten → Kurzbefehle*: dort steht, ob die Uhr direkt eintragen darf, mit
  einem Knopf **Erlauben** direkt zum passenden Schalter. Handarbeit geht auch:
  *Einstellungen → Apps → Locked → Über anderen Apps anzeigen* einschalten —
  auf manchen Geräten liegt der Schalter stattdessen unter *Einstellungen →
  Apps →* **⋮** *→ Spezieller Zugriff → Über anderen Apps anzeigen*.

Der Grund: seit Android 10 darf eine App aus dem Hintergrund keine Oberfläche
starten, und ohne eigene Deklaration im Manifest bietet Android den Schalter für
eine App gar nicht erst an — wonach man auch immer sucht, man findet ihn nicht.
Fehlt die Berechtigung, wird das Kommando von der Uhr deshalb nicht still
verschluckt — es kommt als Benachrichtigung, und ein Tipp darauf trägt ein. Das
ist eine Handlung des Nutzers, die darf. Nur eben einen Tipp länger.

Die Uhr-APK muss aus demselben Build stammen wie die des Telefons: der
Datenkanal von Play Services verbindet nur Apps mit gleicher Anwendungs-ID *und*
gleicher Signatur. Da beide aus derselben Werkstatt kommen, gilt das automatisch
— und die Uhr braucht kein Update, solange sich am Protokoll nichts ändert.

#### Wenn die Kachel „Locked am Telefon einmal öffnen" zeigt

Dann hat sie noch keine Registry. Locked am Telefon öffnen und ein paar Sekunden
warten; die Kachel zieht von allein nach.

### Ohne eigene Uhr-App: über eine Automation

Wer die Uhr-APK nicht aufspielen will, kommt mit einer Automations-App ans
selbe Ziel — sie löst dieselbe Adresse aus.

| Brücke | Kosten | Aktion am Telefon |
|---|---|---|
| MacroDroid + Wear-App | kostenlos (Limit für Makros) | „URL öffnen" |
| Tasker + AutoWear | einmalig kostenpflichtig | „Browse URL" |

Mit MacroDroid: neues Makro, Auslöser **Android Wear** (der Name ist später der
Knopf auf der Uhr), Aktion **Apps → URL öffnen** mit `locked://log?m=HT`. Die
Berechtigung *Über anderen Apps anzeigen* braucht dann MacroDroid statt Locked —
der Haken verschwindet nicht, er wandert nur.

### Was hier absichtlich fehlt

**Daten auf der Uhr.** Sie könnte den Kontostand zeigen, die Streaks, den Preis
— dafür bräuchte sie die Datei, also eine eigene OneDrive-Anmeldung auf einem
Bildschirm von vier Zentimetern, oder eine zweite Kopie der Historie, die mit
der ersten auseinanderläuft. Die Uhr ist eine Fernbedienung. Das ist keine
Einschränkung, das ist die Entscheidung.

Was sie aufhebt, ist deshalb kein Widerspruch: ein Tipp, der noch nicht
zugestellt ist, ist keine Historie, sondern eine unbeantwortete Frage. Sobald er
durch ist, vergisst die Uhr ihn wieder.

**Ereignisse mit Preis auf der Kachel.** Das Telefon schickt sie gar nicht erst
herüber. Ein Knopf ohne Rückfrage, gedrückt ohne hinzusehen, darf nichts kosten.

**Ein stiller Empfänger ohne Oberfläche.** Ein BroadcastReceiver könnte den
Eintrag schreiben, ohne die App zu zeigen. Er wüsste aber nichts von der
laufenden WebView und nichts vom Sync — der nächste Speichervorgang der App
überschriebe ihn, und der Fehler fiele erst am PC auf. Der Umweg über die
sichtbare App ist eine Sekunde langsamer und dafür dieselbe Wahrheit wie jeder
andere Eintrag.

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
      command.js      Kommandos aus einer URL: lesen, auflösen, planen
    sync/             auth.js · onedrive.js · files.js
    ui/               eintrag · dashboard · einstellungen · daten · charts
    state.js          zentraler Zustand, alle Änderungen über mutate()
    platform.js       Android / Desktop / Web an einer Stelle
    shortcuts.js      Kommandos ausführen, Kurzbefehle des Launchers setzen
electron/             main.js · preload.cjs — die Desktop-Hülle
native/
  java/               Capacitor-Plugins und der Empfänger für die Uhr
  wear/               die Uhr-App: Kachel, Liste, Datenkanal (eigenes APK)
test/                 node --test, ohne Testframework
```

Keine Build-Kette, kein Framework: ES-Module, die der Browser direkt lädt.
Derselbe Ordner geht unverändert in die APK, in den Installer und nach Pages.

```bash
npm test          # 104 Tests, nur Node-Builtins
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
berechnen (Commit-Anzahl → `2.1.N`) und sie über `scripts/bake-version.sh`
eintragen — Handy, PC und Web zeigen nach einem Push also dieselbe Nummer:

| Workflow | Ergebnis |
|---|---|
| `build-apk.yml` | signierte APK für Telefon *und* Uhr, als Artefakt und am Release |
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
