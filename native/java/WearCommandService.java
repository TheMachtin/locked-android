package app.locked.themachtin.plugins;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import app.locked.themachtin.MainActivity;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;

import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Was von der Uhr kommt.
 *
 * Die Uhr schickt eine Modell-ID und den Zeitpunkt des Tippens (`NS@1757003100000`).
 * Daraus wird dieselbe Adresse, die auch ein Kurzbefehl oder eine Automation
 * schickt — der Eintrag entsteht danach an genau einer Stelle im Programm, nicht
 * an einer zweiten, die irgendwann anders rechnet.
 *
 * Der Zeitpunkt zählt erst, wenn er *alt* ist: die Uhr hebt einen Tipp auf, den
 * sie nicht loswurde, und trägt ihn nach, sobald das Telefon wieder in Reichweite
 * ist — dann gehört er in die Historie, wo er passiert ist, nicht wo er ankam.
 * Ein frischer Tipp bekommt dagegen weiter die Uhrzeit dieses Geräts. Beide Uhren
 * gehen nie exakt gleich, und für den Normalfall ist die des Telefons die
 * maßgebliche: dort liegt die Datei.
 *
 * Der Haken liegt woanders: seit Android 10 darf eine App aus dem Hintergrund
 * keine Oberfläche mehr starten. Erlaubt ist es nur mit „Über anderen Apps
 * anzeigen". Fehlt die Berechtigung, wird der Eintrag nicht still verschluckt,
 * sondern als Benachrichtigung angeboten: ein Tipp darauf ist eine Handlung des
 * Nutzers und darf die App öffnen. Auf der Uhr steht diese Benachrichtigung
 * ohnehin — der Weg bleibt damit einer, er wird nur einen Tipp länger.
 */
public class WearCommandService extends WearableListenerService {

    private static final String PFAD = "/locked/log";
    private static final String KANAL = "locked-wear";
    private static final int NOTIF_ID = 7100;
    /** Bis hierhin gilt ein Tipp der Uhr als „jetzt". */
    private static final long FRISCH_MS = 120000;

    @Override
    public void onMessageReceived(MessageEvent event) {
        if (event == null || !PFAD.equals(event.getPath())) return;
        String roh = new String(event.getData(), StandardCharsets.UTF_8).trim();
        if (roh.isEmpty()) return;

        // „NS@1757003100000" — die ältere Uhr-APK schickt nur „NS", und dann bleibt
        // es dabei. Ein Trennzeichen, das in keiner ID vorkommen kann: sie besteht
        // aus Buchstaben und Ziffern (siehe core/settings.js → normalizeModel).
        String id = roh;
        long getipptMs = 0;
        int at = roh.lastIndexOf('@');
        if (at > 0) {
            try {
                getipptMs = Long.parseLong(roh.substring(at + 1));
                id = roh.substring(0, at);
            } catch (NumberFormatException e) {
                Log.w("Locked", "Zeitstempel der Uhr unlesbar: " + roh);
            }
        }
        if (id.isEmpty()) return;

        // Die Marke der Uhr reist mit: bestätigt wird erst, wenn daraus ein Eintrag
        // geworden ist (siehe shortcuts.js → runCommand). Ein unbekannter Parameter
        // stört das Lesen der Adresse nicht.
        Uri adresse = Uri.parse("locked://log?m=" + Uri.encode(id) + nachgetragen(getipptMs)
            + "&w=" + Uri.encode(roh));
        Intent intent = new Intent(Intent.ACTION_VIEW, adresse)
            .setClass(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        if (darfAusDemHintergrundStarten()) {
            try {
                startActivity(intent);
                return;
            } catch (Exception e) {
                Log.w("Locked", "Start aus dem Hintergrund abgelehnt", e);
            }
        }
        biete(intent, id);
    }

    /**
     * Der Zusatz `&t=…&d=…` für einen Tipp, der liegen geblieben ist.
     *
     * Frisch heißt: innerhalb von zwei Minuten. Dann bleibt alles wie bisher, das
     * Telefon setzt seine eigene Uhrzeit — die Uhren beider Geräte gehen nie exakt
     * gleich, und ein Zeitstempel, der um Sekunden danebenliegt, wäre keine
     * Verbesserung. Erst wenn ein Tipp merklich älter ist, hat er eine eigene
     * Geschichte: dann stammt er aus einer Funklücke und gehört dorthin, wo er
     * getippt wurde.
     *
     * Formatiert wird in der Zeitzone dieses Geräts — hier liegt die Datei, und
     * hier steht auch der Rest der Historie in Ortszeit.
     */
    private static String nachgetragen(long getipptMs) {
        if (getipptMs <= 0) return "";
        long alter = System.currentTimeMillis() - getipptMs;
        if (alter <= FRISCH_MS) return "";
        Date wann = new Date(getipptMs);
        return "&t=" + new SimpleDateFormat("HH:mm", Locale.US).format(wann)
             + "&d=" + new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(wann);
    }

    /** Ohne diese Berechtigung blockt Android den Start wortlos — dann gar nicht erst versuchen. */
    private boolean darfAusDemHintergrundStarten() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        try {
            return Settings.canDrawOverlays(this);
        } catch (Exception e) {
            return false;
        }
    }

    /** @return ob der Eintrag hier gelandet ist — nur dann darf die Uhr ihn streichen. */
    private boolean biete(Intent intent, String id) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS")
                   != PackageManager.PERMISSION_GRANTED) {
            Log.w("Locked", "Keine Benachrichtigungs-Berechtigung — Kommando von der Uhr verfällt");
            return false;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel kanal = new NotificationChannel(
                    KANAL, "Von der Uhr", NotificationManager.IMPORTANCE_HIGH);
                kanal.setDescription("Einträge, die von der Uhr angestoßen wurden");
                NotificationManager nm = getSystemService(NotificationManager.class);
                if (nm != null) nm.createNotificationChannel(kanal);
            }
            // Je Eintrag eine eigene Benachrichtigung samt eigenem PendingIntent:
            // Die Uhr kann mehrere nachgetragene Tipps kurz hintereinander schicken.
            // Mit fester Kennung überschriebe der zweite den ersten — und der wäre
            // dann verloren, obwohl die Uhr ihn als zugestellt abgehakt hat.
            int kennung = NOTIF_ID + Math.abs(String.valueOf(intent.getData()).hashCode() % 1000);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(this, kennung, intent, flags);
            NotificationCompat.Builder b = new NotificationCompat.Builder(this, KANAL)
                .setSmallIcon(android.R.drawable.ic_menu_edit)
                .setContentTitle("Locked")
                .setContentText("Antippen: " + id + " eintragen")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi);
            NotificationManagerCompat.from(this).notify(kennung, b.build());
            return true;
        } catch (Exception e) {
            Log.w("Locked", "Benachrichtigung fehlgeschlagen", e);
            return false;
        }
    }
}
