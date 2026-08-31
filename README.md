# Locked — Android App

Native Android-Version der [Locked-PWA](https://github.com/TheMachtin/locked), gebaut mit Capacitor.

## Features (zusätzlich zur PWA)

- **Native Local Notifications** — täglicher Reminder um 08:00 (Berechtigung wird beim ersten Start abgefragt)
- **In-App-Update-Check** — prüft beim Start ob eine neue Version im GitHub-Release liegt, zeigt Banner mit Download-Link
- **Echtes Offline-First** — die App startet ohne Netz, OneDrive-Sync läuft opportunistisch

## Setup (einmalig)

1. **Keystore erzeugen**: im Repo → Actions → *Bootstrap Signing Keystore* → *Run workflow*
2. Nach Abschluss: Artifact `locked-keystore` herunterladen
3. Inhalt von `keystore.base64.txt` als Secret `KEYSTORE_BASE64` im Repo speichern
   (Settings → Secrets and variables → Actions → New repository secret)
4. Passwort aus `keystore.password.txt` als Secret `KEYSTORE_PASSWORD` speichern
5. Keystore-Datei (`locked-release.jks`) **sicher offline** aufheben — bei Verlust kein App-Update mehr möglich

## Microsoft-Login (OneDrive-Sync) — Azure-Setup

Die native App kann **nicht** denselben Login-Weg nutzen wie die PWA: `loginPopup()` ruft
`window.open()`, und die Capacitor-WebView reicht das an den externen Chrome weiter — das
Token käme über `window.opener` nie in die App zurück. Deshalb läuft der Login nativ über
den System-Browser (Chrome Custom Tab) mit **Auth-Code-Flow + PKCE** und springt über das
eigene Schema `locked://auth` zurück.

Damit das funktioniert, braucht die App-Registrierung im
[Azure-Portal](https://portal.azure.com) → *App-Registrierungen* → *Authentifizierung*:

| Plattform | Redirect-URI | wofür |
|---|---|---|
| Mobile- und Desktopanwendungen | `locked://auth` | native App |
| Single-page application | `https://themachtin.github.io/locked-android/` | Web-Version am PC |

Die native URI wird über *Plattform hinzufügen → Mobile- und Desktopanwendungen →
Benutzerdefinierte Redirect-URI* eingetragen. Sie darf **nicht** unter „Single-page
application" stehen — sonst lehnt der Token-Endpunkt den Tausch ab.

Welche URI die laufende Installation tatsächlich sendet, steht in der App unter
**Daten → OneDrive-Sync**. Schlägt die Anmeldung fehl, zeigt die App die vollständige
Microsoft-Meldung an (inkl. `AADSTS`-Code, falls vorhanden).

Zwei Details, die leicht übersehen werden:
- Der Token-Tausch läuft nativ über `CapacitorHttp`, nicht über `fetch()`. Ein `fetch()`
  aus der WebView schickt einen `Origin`-Header mit, den Azure bei nicht-SPA-Redirect-URIs
  mit `AADSTS9002326` ablehnt.
- Für den Refresh-Token wird der Scope `offline_access` angefordert. Ohne ihn müsstest du
  dich stündlich neu anmelden.

## Build

Jeder Push auf `main` löst zwei Workflows aus:

**APK** (`build-apk.yml`):
- **Artifact** (90 Tage Verfügbarkeit) unter der Workflow-Run-Seite
- **Release** unter [Releases](https://github.com/TheMachtin/locked-android/releases) mit APK-Anhang

**Web-Version** (`deploy-pages.yml`): `www/` geht nach GitHub Pages, siehe
[Am PC benutzen](#am-pc-benutzen). Beide Workflows berechnen die Version gleich
(Commit-Anzahl → `1.0.N`), Handy und PC zeigen nach einem Push also dieselbe
Nummer — sichtbar im Tooltip der Kopfzeile.

## Installation

1. APK aus dem neuesten Release herunterladen
2. Am Handy antippen → „Von unbekannter Quelle zulassen" bestätigen
3. App installiert sich; Datenzugriff bleibt (OneDrive-Login persistent)

Beim nächsten Update: im Startbanner „Herunterladen" tippen → APK antippen → Installieren.

## Am PC benutzen

Die App ist im Kern eine Web-App — Capacitor ist nur die Android-Hülle. `www/` wird
deshalb zusätzlich als PWA nach GitHub Pages ausgerollt:

**<https://themachtin.github.io/locked-android/>**

Gleicher Code wie die APK, gleiche OneDrive-Datei, gleicher Drei-Wege-Merge — Handy
und PC können also parallel laufen. Nativ-only bleiben Reminder-Notifications,
APK-Update-Check und die Filesystem-Kopie der Daten; am PC hält der Service Worker
die App offline-fähig, der lokale Stand liegt im localStorage des Browsers.

### Einmalig einzurichten

1. **Pages aktivieren**: Settings → Pages → *Source: GitHub Actions*, dann den
   Workflow einmal neu starten. Das muss von Hand passieren — der `GITHUB_TOKEN`
   darf die Pages-Site nicht anlegen (`Resource not accessible by integration`),
   `pages: write` reicht nur fürs Deployen. Solange Pages aus ist, scheitert der
   Workflow im Schritt *Configure Pages* mit `Not Found`.
2. **Redirect-URI in Azure**: `https://themachtin.github.io/locked-android/` unter
   *Authentifizierung → Single-page application* eintragen (siehe Tabelle oben).
   Ohne den Eintrag scheitert der Login mit einem `AADSTS`-Fehler. Welche URI die
   laufende Instanz sendet, steht in der App unter **Daten → OneDrive-Sync**.

### Alternative: lokal servieren

Ohne Pages tut es auch ein lokaler Server — `file://` reicht nicht, Service Worker
und MSAL brauchen einen echten Origin:

```bash
npx serve www          # oder: python3 -m http.server -d www 8000
```

Die Origin (z. B. `http://localhost:8000/`) muss dann ebenfalls als
SPA-Redirect-URI in Azure stehen.

### Die alte PWA nicht parallel benutzen

Das Vorgänger-Repo [TheMachtin/locked](https://github.com/TheMachtin/locked) liegt
auf demselben OneDrive-Pfad, ist aber älter: bei einem Schreibkonflikt (HTTP 412)
fragt es nur „lokal behalten oder Serverstand laden" und überschreibt die Datei
danach ohne `If-Match` — der Drei-Wege-Merge aus `merge.js` fehlt dort. Wer beide
gleichzeitig nutzt, riskiert, Einträge des anderen Geräts zu verlieren.

## Tech

- **Capacitor 6** — WebView-Wrapper um die bestehende HTML/JS-App
- **Plugins**: LocalNotifications, Preferences, Network, Filesystem, App
- **GitHub Actions** — APK-Build + Signing + Release-Upload, dazu Pages-Deploy der Web-Version
