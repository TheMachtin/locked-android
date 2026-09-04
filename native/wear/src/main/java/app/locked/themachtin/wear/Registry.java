package app.locked.themachtin.wear;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.util.Log;

import androidx.wear.tiles.TileService;

import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Was die Uhr vom Telefon weiß — und wie sie zurückredet.
 *
 * Die Uhr hält keine Daten. Sie kennt nur die Modell-Registry, die das Telefon
 * über den Datenkanal schickt, und sie schickt einen Modellnamen zurück. Alles
 * Rechnen, Speichern und Synchronisieren bleibt drüben; die Uhr ist eine
 * Fernbedienung, kein zweiter Kopf. Deshalb kann hier auch nichts auseinander
 * laufen.
 *
 * Die Registry liegt in den SharedPreferences, nicht im Speicher: die Kachel
 * wird vom System jederzeit neu gestartet und muss sofort zeichnen können,
 * ohne auf eine Antwort des Telefons zu warten.
 */
final class Registry {

    static final String TAG = "LockedWear";
    static final String PFAD_REGISTRY = "/locked/models";
    static final String PFAD_LOG = "/locked/log";

    private static final String PREFS = "locked_wear";
    private static final String KEY_JSON = "registry";
    private static final String KEY_STATUS = "status";
    private static final String KEY_STATUS_MS = "status_ms";
    private static final String KEY_KLICK = "klick";
    private static final String KEY_KLICK_MS = "klick_ms";

    /** Wie lange eine Rückmeldung („→ Holy Trainer") den Zustand überdeckt. */
    private static final long STATUS_MS = 20000;
    /**
     * Fenster, in dem derselbe Knopf als Wiederholung gilt.
     *
     * Großzügig bemessen, weil es nichts kostet: das Telefon trägt denselben
     * Eintrag in derselben Minute ohnehin nur einmal ein („Zweimal ausgelöst ist
     * einmal eingetragen"). Ein zweiter Tipp auf denselben Knopf innerhalb einer
     * Minute hätte drüben also gar keine Wirkung — hier abgefangen spart er den
     * Weg und die Rückfrage.
     */
    private static final long KLICK_MS = 60000;

    private Registry() {}

    static class Modell {
        String id = "";
        String label = "";
        String kurz = "";
        int farbe = 0xFF84CC16;
        int schrift = 0xFF2B241B;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void speichere(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY_JSON, json).apply();
    }

    static String rohdaten(Context ctx) {
        return prefs(ctx).getString(KEY_JSON, "");
    }

    /** Die Modelle, die auf die Kachel dürfen. Leer, solange das Telefon nichts geschickt hat. */
    static List<Modell> laden(Context ctx) {
        List<Modell> out = new ArrayList<>();
        String json = rohdaten(ctx);
        if (json.isEmpty()) return out;
        try {
            JSONArray arr = new JSONObject(json).optJSONArray("models");
            if (arr == null) return out;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Modell m = new Modell();
                m.id = o.optString("id", "");
                m.label = o.optString("label", m.id);
                m.kurz = o.optString("kurz", m.id);
                m.farbe = farbe(o.optString("color", ""));
                m.schrift = kontrast(m.farbe);
                if (!m.id.isEmpty()) out.add(m);
            }
        } catch (Exception e) {
            Log.w(TAG, "Registry unlesbar", e);
        }
        return out;
    }

    static String labelVon(Context ctx, String id) {
        for (Modell m : laden(ctx)) if (m.id.equals(id)) return m.label;
        return id;
    }

    /** Der Zustand, den das Telefon zuletzt gemeldet hat. */
    private static String jetztText(Context ctx) {
        try {
            JSONObject jetzt = new JSONObject(rohdaten(ctx)).optJSONObject("jetzt");
            if (jetzt == null) return "";
            String label = jetzt.optString("label", "");
            if (label.isEmpty()) return "";
            long seitMs = jetzt.optLong("seitMs", 0);
            String wieLange = seitMs > 0 ? dauer(System.currentTimeMillis() - seitMs) : "";
            if (!wieLange.isEmpty()) return label + " · " + wieLange;
            // Ältere Fassung des Telefons: nur die Uhrzeit des Wechsels.
            String seit = jetzt.optString("seit", "");
            return seit.isEmpty() ? label : label + " · " + seit;
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * Wie lange das schon so ist — „3 h 20", „47 min", „12 T 5 h".
     *
     * Die Uhrzeit des Wechsels stand vorher da und beantwortete die Frage nur
     * mittelbar: wer um 4 Uhr nachts auf die Uhr sieht, will nicht rechnen. Das
     * Telefon schickt deshalb den Zeitpunkt, gerechnet wird hier beim Zeichnen —
     * eine fertige Dauer wäre in dem Moment richtig, in dem sie ankommt, und
     * danach jede Minute falscher.
     *
     * Knapper geschrieben als im Telefon (dort „5 h 12 min"): die Zeile trägt den
     * Namen des Zustands mit, und was nicht in eine Zeile passt, endet als „…".
     */
    static String dauer(long ms) {
        if (ms < 0) return "";
        long min = ms / 60000;
        if (min < 1) return "gerade eben";
        long tage = min / 1440, std = (min % 1440) / 60, rest = min % 60;
        if (tage > 0) return tage + " T " + std + " h";
        if (std > 0) return std + " h " + (rest < 10 ? "0" : "") + rest;
        return min + " min";
    }

    /**
     * Kam derselbe Knopf eben schon?
     *
     * Der Zustand der Kachel trägt das Kennzeichen des zuletzt gedrückten Knopfes
     * weiter. Jede Aktualisierung (etwa, weil das Telefon einen neuen Zustand
     * gemeldet hat, oder weil die Kachel sich auffrischt) ruft sie damit erneut
     * *mit diesem Kennzeichen* auf — ohne Sperre würde daraus eine Schleife aus
     * Senden und Neuzeichnen.
     *
     * Die zweite Sperre steht in `LockedTileService.istEchterTipp()`: ein Knopf,
     * den es gar nicht mehr gibt, war kein Tipp. Diese hier deckt die Zeitspanne
     * ab, bis das Telefon den neuen Zustand gemeldet hat.
     */
    static boolean istWiederholung(Context ctx, String id) {
        SharedPreferences p = prefs(ctx);
        long jetzt = System.currentTimeMillis();
        if (id.equals(p.getString(KEY_KLICK, "")) && jetzt - p.getLong(KEY_KLICK_MS, 0) < KLICK_MS) {
            return true;
        }
        p.edit().putString(KEY_KLICK, id).putLong(KEY_KLICK_MS, jetzt).apply();
        return false;
    }

    static void setzeStatus(Context ctx, String text) {
        prefs(ctx).edit()
            .putString(KEY_STATUS, text)
            .putLong(KEY_STATUS_MS, System.currentTimeMillis())
            .apply();
    }

    /**
     * Die Zeile über den Knöpfen: kurz nach einem Tippen die Rückmeldung, sonst
     * der zuletzt gemeldete Zustand. Eine Bestätigung, die ewig stehen bleibt,
     * wäre beim nächsten Blick eine Lüge.
     */
    static String kopfzeile(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String status = p.getString(KEY_STATUS, "");
        long ms = p.getLong(KEY_STATUS_MS, 0);
        if (!status.isEmpty() && System.currentTimeMillis() - ms < STATUS_MS) return status;
        String jetzt = jetztText(ctx);
        return jetzt.isEmpty() ? "Locked" : jetzt;
    }

    /**
     * Ein Modell ans Telefon schicken.
     *
     * Ohne Antwort: die Bestätigung kommt als Benachrichtigung des Telefons, die
     * auf der Uhr ohnehin erscheint. Nur wenn gar nichts hinausging, muss die
     * Kachel es selbst sagen — sonst stünde dort „gesendet", während nichts
     * passiert ist.
     */
    static void sende(Context ctx, String id) {
        final Context app = ctx.getApplicationContext();
        try {
            Wearable.getNodeClient(app).getConnectedNodes()
                .addOnSuccessListener(nodes -> {
                    if (nodes == null || nodes.isEmpty()) { melde(app, "Telefon nicht verbunden"); return; }
                    for (Node n : nodes) {
                        Wearable.getMessageClient(app)
                            .sendMessage(n.getId(), PFAD_LOG, id.getBytes(StandardCharsets.UTF_8))
                            .addOnFailureListener(e -> melde(app, "nicht angekommen"));
                    }
                })
                .addOnFailureListener(e -> melde(app, "Telefon nicht verbunden"));
        } catch (Exception e) {
            Log.w(TAG, "Senden fehlgeschlagen", e);
            melde(app, "Senden fehlgeschlagen");
        }
    }

    private static void melde(Context ctx, String text) {
        setzeStatus(ctx, text);
        try {
            TileService.getUpdater(ctx).requestUpdate(LockedTileService.class);
        } catch (Exception e) {
            Log.w(TAG, "Kachel-Aktualisierung fehlgeschlagen", e);
        }
    }

    static int farbe(String hex) {
        try { return Color.parseColor(hex); } catch (Exception e) { return 0xFF84CC16; }
    }

    /** Helle Fläche → dunkle Schrift. Sonst wäre die halbe Palette unlesbar. */
    static int kontrast(int farbe) {
        double l = (0.299 * Color.red(farbe) + 0.587 * Color.green(farbe) + 0.114 * Color.blue(farbe)) / 255.0;
        return l > 0.6 ? 0xFF2B241B : 0xFFFFFFFF;
    }
}
