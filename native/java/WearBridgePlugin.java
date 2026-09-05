package app.locked.themachtin.plugins;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;

import java.nio.charset.StandardCharsets;

/**
 * Was die Uhr wissen muss.
 *
 * Genau zwei Dinge: welche Modelle es gibt (mit Farbe und Kürzel) und was gerade
 * getragen wird. Beides steht als *Daten* in der synchronisierten Datei, also
 * schickt es das Telefon herüber, statt es in der Uhr-App zu verdrahten — ein
 * neuer Käfig erscheint dort ohne neue Uhr-Fassung.
 *
 * Der Datenkanal von Play Services hält das Element vor: die Uhr bekommt es auch,
 * wenn sie beim Ändern gar nicht in Reichweite war.
 */
@CapacitorPlugin(name = "WearBridge")
public class WearBridgePlugin extends Plugin {

    private static final String PFAD = "/locked/models";
    /** Der Rückweg zur Uhr: „steht in der Datei". */
    private static final String PFAD_OK = "/locked/ok";

    @PluginMethod
    public void publish(PluginCall call) {
        String json = call.getString("json");
        if (json == null || json.isEmpty()) {
            call.reject("json required");
            return;
        }
        try {
            PutDataMapRequest karte = PutDataMapRequest.create(PFAD);
            karte.getDataMap().putString("json", json);
            // Ohne Zeitstempel: gleicher Inhalt heißt kein Datenverkehr. Der
            // Kanal erkennt das von allein, solange nichts Wechselndes drinsteht.
            PutDataRequest anfrage = karte.asPutDataRequest();
            anfrage.setUrgent();
            Wearable.getDataClient(getContext()).putDataItem(anfrage)
                .addOnFailureListener(e -> Log.w("Locked", "Uhr nicht erreicht", e));
            call.resolve();
        } catch (Exception e) {
            call.reject("Uhr-Abgleich fehlgeschlagen: " + e.getMessage());
        }
    }

    /**
     * Der Uhr sagen, dass ihr Tipp jetzt in der Datei steht.
     *
     * Erst diese Nachricht streicht ihn drüben aus der Warteschlange, und sie geht
     * bewusst von *hier* aus — nicht schon aus dem Dienst, der die Nachricht
     * entgegennimmt. Der weiß nur, dass etwas angekommen ist; ob daraus ein
     * Eintrag wurde, entscheidet sich erst danach. Fehlt „Über anderen Apps
     * anzeigen", liegt der Tipp bis dahin als Benachrichtigung da und wartet auf
     * einen Fingerdruck — würde die Uhr ihn schon dafür streichen, wäre er
     * verloren, sobald ihn jemand wegwischt.
     *
     * Verschickt wird die Marke, die die Uhr mitgeschickt hat („NS@1757003100000"),
     * damit drüben genau dieser Eintrag getroffen wird und kein späterer.
     */
    @PluginMethod
    public void confirm(PluginCall call) {
        String marke = call.getString("marke");
        if (marke == null || marke.isEmpty()) {
            call.reject("marke required");
            return;
        }
        try {
            byte[] daten = marke.getBytes(StandardCharsets.UTF_8);
            Wearable.getNodeClient(getContext()).getConnectedNodes()
                .addOnSuccessListener(nodes -> {
                    if (nodes == null) return;
                    for (Node n : nodes) {
                        Wearable.getMessageClient(getContext())
                            .sendMessage(n.getId(), PFAD_OK, daten)
                            .addOnFailureListener(e -> Log.w("Locked", "Uhr nicht bestätigt", e));
                    }
                })
                .addOnFailureListener(e -> Log.w("Locked", "Keine Uhr erreichbar", e));
            call.resolve();
        } catch (Exception e) {
            call.reject("Bestätigung fehlgeschlagen: " + e.getMessage());
        }
    }

    /**
     * Darf die App sich selbst öffnen, wenn die Uhr etwas schickt?
     *
     * Seit Android 10 nur mit „Über anderen Apps anzeigen". Fehlt der Schalter,
     * kommt der Eintrag als antippbare Benachrichtigung — das funktioniert, ist
     * aber ein Tipp mehr, und man muss wissen, warum. Deshalb fragt die
     * Oberfläche hier nach, statt es den Nutzer raten zu lassen.
     */
    @PluginMethod
    public void overlayState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", darfStarten());
        call.resolve(ret);
    }

    /** Direkt auf die Seite mit dem Schalter — suchen muss man ihn sonst lange. */
    @PluginMethod
    public void requestOverlay(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Einstellung nicht erreichbar: " + e.getMessage());
        }
    }

    private boolean darfStarten() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        try { return Settings.canDrawOverlays(getContext()); }
        catch (Exception e) { Log.w("Locked", "Overlay-Status unklar", e); return false; }
    }
}
