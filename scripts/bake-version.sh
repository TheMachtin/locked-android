#!/usr/bin/env bash
# Version und Commit-Hash in die ausgelieferten Dateien schreiben.
#
# Alle drei Builds (APK, Desktop, Web) rufen dasselbe Skript auf — sonst zeigen
# Handy und PC nach einem Push unterschiedliche Nummern, und der Update-Check
# vergleicht Äpfel mit Birnen.
#
#   scripts/bake-version.sh 2.0.42 a1b2c3d
set -euo pipefail

NAME="${1:?Version fehlt}"
HASH="${2:?Commit-Hash fehlt}"

# platform.js hält die Platzhalter; von dort liest die ganze App.
sed -i.bak "s|__APP_VERSION__|${NAME}|g; s|__APP_COMMIT__|${HASH}|g" www/js/platform.js
rm -f www/js/platform.js.bak

# package.json trägt die Version für electron-builder (Dateiname, Installer,
# Programme-Eintrag). node statt sed: an einer JSON-Datei hat sed nichts zu suchen.
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  p.version = process.argv[1];
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "$NAME"

echo "Version $NAME ($HASH) eingetragen."
grep -n "APP_VERSION\s*=\|APP_COMMIT\s*=" www/js/platform.js
