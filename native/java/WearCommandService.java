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

/**
 * Was von der Uhr kommt.
 *
 * Die Uhr schickt nur eine Modell-ID. Daraus wird dieselbe Adresse, die auch ein
 * Kurzbefehl oder eine Automation schickt — der Eintrag entsteht danach an genau
 * einer Stelle im Programm, nicht an einer zweiten, die irgendwann anders rechnet.
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

    @Override
    public void onMessageReceived(MessageEvent event) {
        if (event == null || !PFAD.equals(event.getPath())) return;
        String id = new String(event.getData(), StandardCharsets.UTF_8).trim();
        if (id.isEmpty()) return;

        Uri adresse = Uri.parse("locked://log?m=" + Uri.encode(id));
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

    /** Ohne diese Berechtigung blockt Android den Start wortlos — dann gar nicht erst versuchen. */
    private boolean darfAusDemHintergrundStarten() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        try {
            return Settings.canDrawOverlays(this);
        } catch (Exception e) {
            return false;
        }
    }

    private void biete(Intent intent, String id) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS")
                   != PackageManager.PERMISSION_GRANTED) {
            Log.w("Locked", "Keine Benachrichtigungs-Berechtigung — Kommando von der Uhr verfällt");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel kanal = new NotificationChannel(
                    KANAL, "Von der Uhr", NotificationManager.IMPORTANCE_HIGH);
                kanal.setDescription("Einträge, die von der Uhr angestoßen wurden");
                NotificationManager nm = getSystemService(NotificationManager.class);
                if (nm != null) nm.createNotificationChannel(kanal);
            }
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(this, 0, intent, flags);
            NotificationCompat.Builder b = new NotificationCompat.Builder(this, KANAL)
                .setSmallIcon(android.R.drawable.ic_menu_edit)
                .setContentTitle("Locked")
                .setContentText("Antippen: " + id + " eintragen")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi);
            NotificationManagerCompat.from(this).notify(NOTIF_ID, b.build());
        } catch (Exception e) {
            Log.w("Locked", "Benachrichtigung fehlgeschlagen", e);
        }
    }
}
