# Locked 2.0

Persönliches Tracking als **Android-App**, **Desktop-Programm** und **Web-App** —
ein Quellcode (`www/`), drei Hüllen.

| Plattform | Bezug | Installation |
|---|---|---|
| Android | APK aus dem [neuesten Release](https://github.com/TheMachtin/locked-android/releases) | antippen → „Von unbekannter Quelle zulassen" |
| Windows | `Locked-Setup-2.3.N.exe` aus demselben Release | ausführen; portable Variante liegt daneben |
| Linux | `Locked-2.3.N.AppImage` | ausführbar machen und starten |
| Browser | <https://themachtin.github.io/locked-android/> | Edge/Chrome → „App installieren" |

Alle Installationen teilen sich dieselbe OneDrive-Datei und führen parallele
Änderungen dreiwegig zusammen — Handy und PC dürfen gleichzeitig laufen.

## Wie die Punkte entstehen

```
Einnahmen = (verschlossene Stunden × Satz + Ungeöffnet-Zuschlag) × Streak-Multiplikator
Kosten    = offene Stunden × Satz + Preis je Orgasmus
Konto     = Summe aller Tagesergebnisse seit dem Stichtag
Form      = Form gestern × 0,97 + Tagesergebnis
```

Vier Eigenschaften, die das Modell tragen:

**Der Streak wirkt als Multiplikator, nicht als Summand.** `1 + 0,02 × orgasmusfreie
Tage`, gedeckelt bei 2,0. Er verstärkt, was tatsächlich getan wurde — ohne Käfig
gibt es auch mit 200 Tagen Streak nichts.

**Die ungeöffnete Strecke steigt und ist gedeckelt.** `min(1 × Tage am Stück, 7)`
obendrauf, je vollendetem Tag. Sie bezahlt das, was der Stundensatz nicht sieht:
zwei Modellwechsel am Tag ergeben dieselben 24 verschlossenen Stunden wie ein
Tag, an dem der Käfig gar nicht auf war — nur ist das nicht dasselbe. Der Anstieg
bildet ab, dass der fünfte Tag mehr verlangt als der erste; der Deckel
verhindert, dass daraus wieder eine Größe wird, gegen die Tragestunden und
Orgasmuspreis nicht mehr ankommen. Am Deckel sind es 7 von 19 Rohpunkten eines
vollen Tages.

**Ein Tag sind 24 Stunden am Verschluss, nicht bis Mitternacht.** Sonst hinge die
Belohnung daran, wann die Uhr steht: wer um 01:00 zusperrt und 46 Stunden
durchhält, hätte keinen einzigen ganzen Kalendertag — wer um 23:00 zusperrt, nach
26 Stunden schon einen. Gutgeschrieben wird an dem Datum, an dem der Block
abläuft, und was einmal abgelaufen ist, bleibt: eine Öffnung am Abend nimmt den
Block nicht mehr weg, den der Morgen voll gemacht hat.

**Der Orgasmus hat einen sichtbaren Preis.** `15 + 45 × 2^(−Wartetage/7)`: heute
nach dem letzten kostet er 60, nach einer Woche 37, nach einem Monat 17. Die App
zeigt den aktuellen Preis an, *bevor* man ihn zahlt. Ein Streak-Bruch ist damit
eine bezifferte Entscheidung statt einer stillen Katastrophe.

**Konto und Form sagen Verschiedenes.** Das Konto summiert und wächst zwangsläufig.
Die Form klingt mit 3 % pro Tag ab, läuft gegen einen Grenzwert und bleibt
dadurch über Jahre vergleichbar: ein Ausrutscher dellt sie, zerstört sie nicht,
und zwei ruhige Wochen bauen sie spürbar ab.

Jede Zahl darin steht im Tab **Regeln** und liegt in der Datei, nicht im Programm.

### Was der Ungeöffnet-Zuschlag ersetzt hat

Bis dahin stand an dieser Stelle ein starrer Bonus von 5 Punkten für einen Tag
mit höchstens einer offenen Stunde. Der maß die falsche Größe. Zwei
Modellwechsel am Tag ergeben keine einzige offene Stunde — der Käfig geht auf,
der nächste kommt dran, dazwischen liegt keine Zeit, die als „offen" gebucht
würde. Dieser Tag bekam den Bonus voll, genau wie ein Tag, an dem nichts
passiert ist. Was den Unterschied macht, ist nicht die offene Stunde, sondern
das Öffnen selbst; und wie oft geöffnet wurde, stand nirgends in der Rechnung.

Der Zuschlag misst dasselbe Anliegen an der richtigen Größe und macht daraus
eine Skala statt eines Schalters. Ein Vergleich mit den Standardsätzen, jeweils
ein voll verschlossener Tag ohne Multiplikator:

| | vorher | jetzt |
|---|---|---|
| Tag mit Modellwechsel | 17 | 12 |
| 1. Tag am Stück | 17 | 13 |
| 5. Tag am Stück | 17 | 17 |
| 7. Tag am Stück und weiter | 17 | 19 |

Der fünfte Tag verdient also, was früher jeder Tag verdient hat. Wer täglich
wechselt, verliert gegenüber vorher; wer durchhält, gewinnt ab etwa der ersten
Woche — und genau das war der Zweck.

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
die App nicht zu benutzen zahlte sich am besten aus. Den Namen gibt es in 2.0
wieder, die Bedeutung nicht: er zählt jetzt die Zeit am Stück im selben Käfig
(siehe unten) und bringt keine Punkte.

## Modelle sind Daten

Käfige, Ereignisse und Sätze stehen unter **Regeln**, nicht im Quellcode. Je
Modell einstellbar: Bezeichnung, Farbe, Punkte je Stunde und der
Verschluss-Zustand. Ein neuer Käfig — oder derselbe Käfig in zwei Trageweisen —
ist ein Eintrag, kein Release.

Der **Verschluss-Zustand** ist eine Auswahl aus dreien:

| | verdient | zählt als | „verschlossen seit" | „ungeöffnet seit" |
|---|---|---|---|---|
| **Verschlossen** | Stundensatz + Ungeöffnet-Zuschlag | verschlossene Zeit | läuft | läuft, solange dasselbe Modell bleibt |
| **Unterbrechung** | nichts (Satz 0) | weder noch | läuft weiter | beginnt neu |
| **Offen** | kostet den Stundensatz | offene Zeit | beginnt neu | beginnt neu |

Die **Unterbrechung** gibt es, weil die Reinigung sonst als Öffnung gebucht
werden müsste: zehn Minuten am Waschbecken hätten die verschlossene Phase auf
null gesetzt — eine Aussage über den Käfig, die niemand gemeint hat, denn danach
ist es derselbe wie davor. Sie schützt die Phase und die Stundenkosten, nicht
mehr: die ungeöffnete Strecke beendet sie sehr wohl, und das ist richtig so,
denn sie steht in der Datei genau dann, wenn der Käfig dafür herunter kam. Einen
Deckel braucht sie nicht: sie verdient nichts, eine lange „Reinigung" kostet
also von allein jede Stunde, die der Käfig gebracht hätte.

### Zwei Uhren: „verschlossen" und „ungeöffnet"

Im Dashboard, im Block **Jetzt**, stehen beide nebeneinander, und sie
beantworten verschiedene Fragen. **Verschlossen** misst den Verschluss und läuft über
Modellwechsel und Reinigungen hinweg — wer zweimal täglich den Käfig tauscht,
war trotzdem durchgehend zu. **Ungeöffnet** ist die strengere Frage: der
zusammenhängende Lauf desselben Modells. Jeder Wechsel setzt sie zurück, eine
Unterbrechung ebenso, denn die steht in der Datei genau dann, wenn der Käfig
dafür herunter kam. Was ohne Öffnen geht — die Düse unter der Dusche — erzeugt
keinen Eintrag und lässt die Strecke laufen.

Damit ist „ungeöffnet" nie länger als „verschlossen", und der Abstand zwischen
beiden ist genau das, was die Wechsel gekostet haben.

Bezahlt wird die Strecke **je vollendetem Tag**, und ein Tag sind 24 Stunden ab
dem Verschluss: `min(1 × Tage am Stück, 7)`, gutgeschrieben an dem Datum, an dem
der Block abläuft. Beide Kacheln zählen deshalb in vollendeten
24-h-Abschnitten und nicht in Kalendertagen — dieselbe Einheit, in der bezahlt
wird, und die einzige, die zu den Stunden daneben passt. („Orgasmusfrei" zählt
weiter Kalendertage, weil der Multiplikator ein Tagesfaktor ist.)

Ein Tag ohne Eintrag zählt dabei als ungeöffnet, weil der Zustand des Vortags
fortgilt — das ist *nicht* die 1.x-Falle, in der die Abwesenheit von Einträgen
selbst belohnt wurde. Dort war ein leerer Tag der beste Tag, egal was war; hier
hängt der Zuschlag am fortgeschriebenen Zustand: wer als „offen" fortgilt,
bekommt nichts und zahlt weiter Stundenkosten. Die Belohnung setzt voraus, dass
Öffnungen eingetragen werden — dieselbe Voraussetzung, auf der auch der
Stundensatz steht.

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

### Nicht jedes Ereignis ist ein Orgasmus

Ereignisse hatten lange genau eine Wirkung auf die orgasmusfreie Strecke: sie
brachen sie. Das war richtig, solange „Ereignis" und „Orgasmus" dasselbe hießen
— nur tun sie das nicht. Ein Samenerguss ohne Orgasmus, etwa durch Reizung von
innen, ist beides nicht ganz: kein Orgasmus, den man verschwiegen hätte, aber
auch kein Nichts, denn was sich angesammelt hatte, ist weg. Ihn als Orgasmus zu
buchen hieße, eine Empfindung zu behaupten, die es nicht gab; ihn wegzulassen
hieße, eine Strecke weiterzuzählen, die so nicht mehr stimmt. Für keine der
beiden Unwahrheiten gab es vorher eine Alternative.

Deshalb trägt jedes Ereignis jetzt neben seinem Preis einen zweiten Wert:
**Rest der Strecke**, ein Faktor zwischen 0 und 1.

| Faktor | orgasmusfreie Strecke | Tag gilt als | Preisabstand des nächsten Orgasmus |
|---|---|---|---|
| **0** (Vorgabe) | auf null | mit Orgasmus | beginnt neu |
| **0,5** | die Hälfte bleibt stehen | mit Orgasmus | beginnt neu |
| **1** | unberührt, wächst weiter | orgasmusfrei | zählt darüber hinweg |

Eine Skala und kein Schalter, aus demselben Grund wie beim
Ungeöffnet-Zuschlag: zwischen „zählt voll" und „zählt gar nicht" liegt der
häufigere Fall, dass etwas verbraucht ist, aber nicht alles.

Vier Eigenschaften, die dranhängen:

**Der Preis bleibt davon unberührt.** Die Strecke zu schonen heißt nicht, das
Ereignis umsonst zu geben — es kostet weiter seinen Preis und steht in den
Kosten des Tages. Für einen festen Betrag setzt man Minimum und Maximum gleich;
die Wartezeitkurve, die für den Orgasmus gedacht ist, hat für ein Ereignis ohne
eigene Wartezeit nichts zu sagen.

**Die Zähler heißen weiter nach dem, was sie zählen.** Die Kachel
„Orgasmusfrei", die Balken „Orgasmen im Verlauf", der Zähler mit seinen vier
Fenstern und die Zeile „Tage mit Orgasmus" lassen ein Ereignis mit Faktor 1
aus — sonst stünde „letzte 30 T: 1" neben „Orgasmusfrei: 40 T" auf demselben
Bildschirm. Verschwiegen wird es nicht: es steht als eigene Zahl unter dem
Zähler, in der Zeitleiste des Tages und in den Kosten.

**Der strengste Eintrag des Tages entscheidet.** Wer morgens geschont und
abends gebrochen hat, hat gebrochen.

**Der Aufschlag je weiterem am Tag zählt je Ereignisart.** Sonst machte ein
Erguss am Nachmittag den Orgasmus am Abend zum zweiten und verteuerte ihn —
zwei verschiedene Dinge, die sich gegenseitig bepreisen.

Die Vorgabe ist 0. Jede bestehende Datei kennt das Feld nicht und rechnet nach
dem Laden genau wie vorher; wer die Unterscheidung nicht braucht, merkt nichts
davon. Wer sie braucht, legt unter **Regeln → Modelle und Ereignisse** ein
zweites Ereignis an, gibt ihm einen festen Preis und den Faktor 1.

### Punktesätze einfrieren

Frei änderbare Sätze haben eine Lücke, die kein Rechenfehler ist: **ein Ziel ist
keins, wenn man unterwegs die Sätze anheben kann.** „2.000 Punkte bis
Weihnachten" ist mit dem doppelten Stundensatz eine andere Aussage als mit dem
einfachen, und dem Kontostand sieht man am Ende nicht an, welche von beiden
gemeint war.

Unter **Regeln → Punktesätze** lässt sich deshalb eine Frist setzen. Sie läuft
sichtbar herunter, **verlängern geht jederzeit, aufheben nicht** — eine Sperre,
die sich zurückdrehen lässt, hält nichts fest. Gesperrt ist alles, was in die
Punkte eingeht:

| gesperrt | frei |
|---|---|
| die fünf Punktesätze (Zuschlag, Deckel, Streak, Form-Abklang) | Einträge — die App bleibt vollständig benutzbar |
| Stundensätze, Verschluss-Zustände, Orgasmus-Preise, der Rest der Strecke, Regenerations-Fenster | Namen, Farben, IDs, Archivieren |
| neue und gelöschte Modelle | der Stichtag |
| „Auf Standard zurücksetzen" | die Inaktivitäts-Regeln |

Die Registry gehört dazu, weil sie sonst der offene Weg daran vorbei wäre: ein
neues Modell mit Satz 5 tut dasselbe wie ein erhöhter Punktesatz. Das
Zurücksetzen ebenso — ein Klick, und alle Sätze stünden wieder frei da.

Die Frist steht in den Einstellungen und wandert damit über OneDrive auf das
andere Gerät. Geprüft wird sie im Kern (`isFrozen()`), nicht am Eingabefeld: die
ausgegrauten Felder sind die Anzeige, die Abfrage vor jedem Schreibweg ist die
Sperre. Was sie **nicht** ist: eine Kontrolle durch Dritte. Die Datei liegt
offen, und wer sie von Hand ändert, hebt sie auf. Sie bindet den, der sie setzt.

## Was die Oberfläche zeigt

**Jeder Tab beantwortet eine Frage.** Der Eintrag-Tab: *was trage ich ein, was
steht heute schon drin*. Das Dashboard: *wie steht es*. Bis 2.2 stand der
laufende Zustand — die vier Uhren, das getragene Modell, der Orgasmus-Preis,
Konto und Form — auf **beiden** Seiten; der Eintrag-Tab war damit ein zweites
Dashboard, durch das man scrollen musste, um an die Schnelltasten zu kommen.
Jetzt steht er nur noch im Dashboard, in der Karte **Jetzt**.

**Der Eintrag-Tab beginnt mit den Schnelltasten.** Darunter der gewählte Tag mit
seinen Einträgen, und als Fußzeile das Tagesergebnis — eine Zeile, die sich zur
vollen Aufschlüsselung öffnet (Stunden × Satz, Zuschläge, Orgasmuspreise, Summe).
Weil die Tasten jetzt *über* der Datumswahl stehen, warnt die Karte sichtbar,
sobald ein anderer Tag als heute eingestellt ist: ohne das landete ein Eintrag
stillschweigend auf dem Tag, den man vorhin zum Nachsehen ausgewählt hat.

**Der Statusblock hat nur eine Fassung.** Die vier Uhren, das Modell und der
Preis kommen aus `ui/status.js` — dieselbe Datei, aus der auch die Live-Ansicht
(`jetzt.html`) baut. Zwei eigene Fassungen desselben Blocks wären zwei
Wahrheiten, und die Abweichung fiele erst auf, wenn eine davon falsch ist.

**Der Zeitraum hat eine Ebene und einen Anker.** Statt einer Reihe von
Jahreszahlen, die mit jedem Jahr länger wird, wählt man **Alles · Jahr · Quartal
· Monat** und blättert mit ‹ › durch. Zwei Klicks reichen damit von „alles" bis
„März 2025", und die Frage „wie läuft dieser Monat" ist überhaupt erst
beantwortbar. Die Pfeile sperren am Rand der erfassten Spanne — steht die
Auswahl außerhalb, bleibt der Weg zurück offen, sonst klemmte sie in einem
leeren Monat fest. Wird die Ebene feiner, bleibt der Zeitpunkt: von „2026" auf
„Quartal" ist das laufende Quartal gemeint, nicht Q1. Im selben Block steht die
**Auflösung** (Monat/Woche/Tag), und sie gilt für alle Diagramme darunter statt
nur für eines; beim Wechsel der Ebene zieht sie sinnvoll mit.

**Dieselbe Form, andere Kennzahl.** Das Balkendiagramm *Je Zeitraum* zeigt
wahlweise Punkte, verschlossene Stunden oder Orgasmen — ein Klick auf einen
Balken springt in den Eintrag-Tab dieses Tages. Dazu kommen die gestapelte
Tragezeit in den Modellfarben (der Donut zeigt die Aufteilung des Zeitraums, die
Balken die Verschiebung darin), *Orgasmen im Verlauf* mit der Anzahl als Balken
und dem durchschnittlichen Abstand als Linie auf eigener Achse, und unter
„Details" das Muster nach Uhrzeit. Alle teilen sich eine Zusammenfassung
(`aggregatePeriods()`) — drei eigene Fassungen davon entwickelten früher oder
später drei Vorstellungen davon, was ein Monat ist.

**Unter jeder Zahl steht, worauf sie sich bezieht.** Ein Durchschnitt ohne
Nenner ist keine Auskunft: an der Kachel steht deshalb, durch wie viele
Kalendertage geteilt wurde. Drei Blöcke stehen bewusst *außerhalb* des
Zeitraums, weil sie Fragen an die Gegenwart beantworten: **Jetzt**, der
**Orgasmus-Zähler** (laufender Monat, letzte 30 und 90 Tage, Zeit seit dem
letzten) und die Kacheln Konto und Form. Wo eine Kachel so von ihrem Ausschnitt
abweicht, sagt sie es in ihrer Unterzeile.

**Die Regeln-Seite klappt zu.** Erklärtext, Punktesätze, Stichtag, Inaktivität
und Zurücksetzen sind einklappbare Karten, und jede trägt im zugeklappten
Zustand ihre Kernaussage in der Kopfzeile — „ab 14.05.26", „Erinnerung 2 T ·
Vorschläge 4 T", „🔒 bis 10.10.26". Der Zustand bleibt je Karte gemerkt.

**Die Farbskala des Kalenders kommt aus den eigenen Sätzen.** Feste Schwellen
(„++ ab 25 Punkten") messen an einem Maßstab, den die Datei gar nicht kennt: wer
seinen Stundensatz halbiert, käme nie wieder über „+", wer ihn verdoppelt, hätte
ab dem ersten Tag nur „+++". Zwei Bezugsgrößen spannen die Skala stattdessen auf:

| Band | Bereich | mit den Standardsätzen |
|---|---|---|
| `−−` | unter −*voll* | unter −12 |
| `−` | −*voll* bis 0 | −12 bis 0 |
| `0` | 0 bis *voll*/4 | 0 bis 3 |
| `+` | *voll*/4 bis *voll* | 3 bis 12 |
| `++` | *voll* bis *spitze* | 12 bis 25 |
| `+++` | ab *spitze* | ab 25 |

*voll* ist ein Tag durchgehend verschlossen, ohne jeden Zuschlag (24 h × bester
Satz eines verschlossenen Modells = 12). *best* ist der beste denkbare Tag,
derselbe Tag mit vollem Ungeöffnet-Zuschlag und Streak-Deckel ((12 + 7) × 2 =
38), und *spitze* liegt auf halbem Weg dorthin (25). Ein ganzer verschlossener
Tag ist damit „++" — nicht die Ausnahme, sondern das, was ein guter Tag hier
heißt —, und „+++" bleibt den langen Strecken und dem Multiplikator vorbehalten.
Der achte Tag am Stück (12 + 7 = 19) ist „++". Die Legende unter dem Kalender
rechnet die Schwellen aus den gerade eingestellten Sätzen aus und steht deshalb
nicht im HTML.

## Jemanden zusehen lassen

Die Karte **Jetzt** lässt sich teilen, ohne die Historie mitzugeben. Möglich ist
das, weil der Block aus einer Handvoll Zeitstempeln besteht — verschlossen seit,
ungeöffnet seit, letzter Orgasmus — und alles andere daraus rechnet. Wer die
Anker hat, kann die Uhren selbst weiterlaufen lassen: die Stunden zählen hoch,
der Preis fällt, die Strecke wächst um Mitternacht. Nichts davon braucht ein
einziges Ereignis.

Im Daten-Tab steht dafür ein Knopf: **Momentaufnahme kopieren**. Der packt das
Paket in den Link selbst (`jetzt.html#d=…`, rund 700 Zeichen) — keine Datei,
keine Freigabe, kein Konto beim Empfänger. Die Uhren laufen darin weiter, neue
Einträge erscheinen nicht; dafür braucht es einen neuen Link.

### Der Weg über eine laufende Datei — gebaut, aber zugeklappt

Darunter liegt zugeklappt, was eine *mitlaufende* Ansicht bräuchte: die App legt
neben `locked2.json` eine kleine `jetzt.json` ab, gibt sie frei, und die
Anzeigeseite holt sie minütlich nach. Alles davon ist gebaut und geprüft — es
führt über OneDrive nur ins Leere (siehe unten). Gelöscht ist es deshalb nicht:
sobald `jetzt.json` an einem Ort liegt, der Dateien herausgibt, trägt der Aufbau
sofort.

Ein Knopf dort macht den Rest: **Freigabelink erzeugen** schaltet das
Mitschreiben ein, legt die Datei an und holt den Anzeigen-Link über
`createLink` von OneDrive — in einem Schritt. Der dafür nötige Scope
(`Files.ReadWrite`) ist derselbe, mit dem die App ohnehin schreibt; eine neue
Zustimmung braucht es nicht. Zweimal drücken legt keine zweite Freigabe an:
Graph liefert für dieselbe Art und Reichweite denselben Link zurück.

**Freigabe zurücknehmen** zieht sie wieder ein. Das gehört dazu — eine App, die
Links vergibt, aber zum Widerrufen auf die OneDrive-Oberfläche verweist,
überlässt genau den Schritt von Hand, auf den es ankommt.

Scheitern kann die Reichweite: bei einem Geschäftskonto darf die Verwaltung
anonyme Links abschalten. Dann steht die Begründung von Microsoft unverändert in
der Meldung, und der Weg über die OneDrive-Oberfläche bleibt — ein von Hand
eingesetzter Link funktioniert genauso, die App weiß dann nur nichts von ihm und
kann ihn nicht zurücknehmen.

Die Seite dahinter ist `jetzt.html` — dieselbe Web-App, aber eine eigene Seite
ohne Anmeldung, ohne Token und ohne Schreibweg. Dass sie nichts ändern kann, ist
keine Einstellung, die jemand umlegen könnte, sondern eine Eigenschaft ihres
Aufbaus: sie hat schlicht keinen Zugang dafür. Sie holt die Datei etwa minütlich
neu und lässt die Uhren dazwischen selbst laufen.

Zwei Dinge stehen dort ausdrücklich dabei, statt verschwiegen zu werden:

**Wie alt der Stand ist.** Unter dem Block steht, wann das Paket geschrieben
wurde und wann zuletzt geholt. Die Uhren stimmen immer — ein *neues Ereignis*
sieht der Zuschauer aber erst nach dem nächsten Abruf. Wer das nicht daneben
schreibt, lässt eine Momentaufnahme wie eine Live-Übertragung aussehen.

**Ein nicht erreichbarer Abruf verwirft nichts.** Der letzte Stand bleibt stehen
und läuft weiter, mit dem Hinweis, dass er älter ist. Er ist nicht falsch.

### Warum die laufende Datei über OneDrive nicht geht

Gemessen am 07.09.2026, mit einer anonym lesbaren Freigabe:

| Adressform | Antwort |
|---|---|
| `shares/…/root/content` | `401` |
| `shares/…/driveItem/content` | `401` |
| `graph/shares/…/driveItem/content` | `401` |
| Freigabelink mit `download=1` | von CORS blockiert |
| Freigabelink direkt | von CORS blockiert |

Zwei verschiedene Absagen. Die drei API-Wege *antworten* — Microsoft schickt
dort CORS-Header —, verlangen aber einen Token, obwohl dieselbe Freigabe im
Browser ohne Anmeldung lesbar ist. Die beiden direkten Wege lassen fremdes
JavaScript gar nicht erst bis zum Status kommen.

**OneDrive gibt anonyme Dateien nicht an fremdes JavaScript heraus.** Für eine
Ansicht, die neue Einträge zeigt, braucht es deshalb einen Host, der das tut;
bis dahin ist die Momentaufnahme der Weg.

Nachmessen lässt sich das jederzeit mit **Diagnose-Link kopieren**:
`jetzt.html#diag=…` probiert die Formen durch und schreibt hin, welche mit
welchem Status antwortet. Die Unterscheidung, auf die es ankommt, ist die
zwischen einer *Statuszeile* und einem *Block* — die erste hat die CORS-Prüfung
bestanden und scheitert nur an der Berechtigung. Die Adressen selbst zeigt die
Seite nicht: sie enthalten die Freigabe-Kennung, und dieser Zettel ist zum
Herzeigen gedacht. Dieselbe Diagnose prüft auch jede andere Quelle — sie ist
nicht auf OneDrive festgelegt.

Beides landet im Adress-Fragment hinter `#`, und das schickt kein Browser an
einen Server: weder das Paket noch ein Freigabelink taucht in einem
Zugriffsprotokoll auf.

Was bleibt: ein Freigabelink ist ein Ausweis. Wer ihn hat, sieht den Block, auch
wenn er ihn weitergereicht bekommen hat. Zurücknehmen geht — dafür der Knopf —,
beim Link im Adress-Fragment nicht: der veraltet nur.

## Wo die Dateien liegen

Der OneDrive-Ordner steht im Daten-Tab und gilt für alle drei Dateien —
`locked2.json`, `jetzt.json` und die alte `locked.json`. Verschoben wird dabei
nichts: erst in OneDrive umlegen, dann hier eintragen.

Der Ordner gehört zur *Installation*, nicht zur Datei — nach einem Umzug ist er
an jedem Gerät einmal zu setzen. Das ist Absicht: die Einstellungen stehen in
genau der Datei, die man erst finden muss, um sie zu lesen. Ein Pfad, der sich
selbst enthält, wäre nicht auflösbar, und ein Merge-Konflikt darüber schickte
ein Gerät ins Leere.

Beim Wechsel wirft die App ETag und Merge-Basis weg und lädt neu. Beides gehörte
zur Datei am alten Ort: ein ETag von dort ließe das nächste Speichern gegen eine
Version prüfen, die am neuen Ort niemand kennt, und die Basis beschriebe eine
Historie, die dort vielleicht gar nicht liegt.

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

## Die Inaktivitäts-Regel zählt Lebenszeichen, keine Einträge

Wer die App tagelang nicht anfasst, hat trotzdem etwas getan — nur nicht
eingetragen. Nach der eingestellten Frist bietet die App deshalb an, das
Fehlende nachzutragen: eine Öffnung und ab dann täglich einen Orgasmus. Sie
*schlägt* das vor und schreibt nichts von allein; erfundene Einträge wären
später nicht mehr von echten zu unterscheiden.

Gezählt wird ab dem letzten **Lebenszeichen**, und davon gibt es drei — der
späteste gewinnt:

| | zählt, weil |
|---|---|
| ein Eintrag | er den Stand ändert; auch von Uhr oder Automation, dafür muss die App nicht auf sein |
| ein verworfener Vorschlag | die Antwort schon gegeben wurde |
| ein Blick in die App | der Stand offenbar noch stimmt |

Der dritte Fall ist der Grund für die Unterscheidung. Wer eine Woche im selben
Käfig steckt, hat nichts einzutragen — der Zustand hat sich ja nicht geändert.
Nach dem letzten *Eintrag* gerechnet sieht das aus wie Verschwinden, und die
Regel bietet an, eine Öffnung und tägliche Orgasmen nachzutragen, die es nie
gab. Genau in dem Fall wäre der Vorschlag nicht nur unnötig, sondern falsch.

Als Blick zählt die App erst, wenn sie lange genug offen war — zwei Sekunden in
den Standardregeln, einstellbar bis auf null. Ein Fehlgriff in der Hosentasche,
der sie kurz aufblitzen lässt, soll die Frist nicht zurücksetzen. Steht die App
offen auf dem Schreibtisch, frischt sich die Marke minütlich auf; festgehalten
wird sie höchstens stündlich, denn die Frist zählt in Tagen und jede Marke ist
eine Datei-Änderung.

Ein Blick **verhindert** einen Vorschlag, er nimmt ihn nicht zurück: steht schon
einer an, bleibt er stehen, bis er übernommen oder verworfen ist. Sonst
verschwände die Karte zwei Sekunden nach dem Öffnen — genau dann, wenn sie
gebraucht wird.

Die Marke steht als `meta.lastSeenAt` in der Datei und wandert mit: der jüngere
Blick gewinnt, egal an welchem Gerät er passiert ist. Sonst mahnte das Telefon
eine Woche lang etwas an, das am PC längst nachgesehen wurde — und schlimmer:
böte dort an, falsche Einträge in dieselbe Datei zu schreiben. In der Kopfzeile
erscheint dafür kein „ungespeichert": wer die App nur ansieht, hat nichts
eingegeben.

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
  jetzt.html          die Live-Ansicht — eine Seite, kein Tab
  css/app.css
  js/
    core/             ohne DOM, in Node testbar
      time.js         Datum und Zeit, lokal und sommerzeitfest
      settings.js     Modell-Registry, Normalisierung, Preisformel
      calc.js         Einnahmen, Kosten, Konto, Form
      legacy.js       die alte Formel, eingefroren
      migrate.js      1.x → 2.0, Stichtag, Archiv
      merge.js        Drei-Wege-Merge für den Sync
      escalation.js   Inaktivitäts-Vorschläge, „zuletzt gesehen"
      command.js      Kommandos aus einer URL: lesen, auflösen, planen
      jetzt.js        der Statusblock als Paket: bauen und weiterrechnen
    sync/             auth.js · onedrive.js · files.js
      paths.js        wo die Dateien in OneDrive liegen (einstellbar)
    ui/               eintrag · dashboard · einstellungen · daten · charts
      status.js       der laufende Zustand — Dashboard und Live-Ansicht
      jetzt.js        derselbe Block, aus einem Paket statt aus der Historie
      zeitraum.js     Ebene, Anker, Blättern — ohne DOM, deshalb testbar
      collapse.js     einklappbare Karten, Zustand gemerkt
    state.js          zentraler Zustand, alle Änderungen über mutate()
    jetzt-view.js     was die Live-Ansicht tut: holen, ticken, zeichnen
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
npm test          # 166 Tests, nur Node-Builtins
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
berechnen (Commit-Anzahl → `2.3.N`) und sie über `scripts/bake-version.sh`
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
  "days": {}, "notes": {},
  "meta":     { "lastSeenAt": "…",                 // letzter Blick in die App
                "escalationDismissedAt": "…" }     // letzter verworfener Vorschlag
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
