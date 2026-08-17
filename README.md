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
| Single-page application | URL der PWA | Browser-Version |

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

Jeder Push auf `main` löst automatisch einen APK-Build aus. Ergebnis:
- **Artifact** (90 Tage Verfügbarkeit) unter der Workflow-Run-Seite
- **Release** unter [Releases](https://github.com/TheMachtin/locked-android/releases) mit APK-Anhang

## Installation

1. APK aus dem neuesten Release herunterladen
2. Am Handy antippen → „Von unbekannter Quelle zulassen" bestätigen
3. App installiert sich; Datenzugriff bleibt (OneDrive-Login persistent)

Beim nächsten Update: im Startbanner „Herunterladen" tippen → APK antippen → Installieren.

## Tech

- **Capacitor 6** — WebView-Wrapper um die bestehende HTML/JS-App
- **Plugins**: LocalNotifications, Preferences, Network, Filesystem, App
- **GitHub Actions** — Build + Signing + Release-Upload
