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
