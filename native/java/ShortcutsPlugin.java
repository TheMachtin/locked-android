package app.locked.themachtin.plugins;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import app.locked.themachtin.MainActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Kurzbefehle des Launchers (langer Druck auf das App-Symbol).
 *
 * Sie werden zur Laufzeit gesetzt statt in einer XML-Datei des Builds
 * hinterlegt: die Modelle stehen in der synchronisierten Datei, nicht im
 * Quellcode. Ein neuer Käfig ist ein Eintrag im Regeln-Tab — und steht danach
 * ohne Release auch am Startbildschirm.
 *
 * Jeder Kurzbefehl trägt dieselbe Anweisung wie eine Automation: die URL
 * `locked://log?m=<ID>`. Damit ist er von Hand aufs Startbild ziehbar *und* von
 * jeder Automatisierungs-App auslösbar — der Weg von der Uhr führt über
 * dieselbe Adresse.
 */
@CapacitorPlugin(name = "Shortcuts")
public class ShortcutsPlugin extends Plugin {

    private static final int ICON_PX = 192;
    private static final int FALLBACK_FARBE = 0xFF84CC16;

    @PluginMethod
    public void set(PluginCall call) {
        JSArray items = call.getArray("items");
        Context ctx = getContext();
        try {
            List<ShortcutInfoCompat> liste = new ArrayList<>();
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject o = items.getJSONObject(i);
                    ShortcutInfoCompat s = baue(ctx, o, liste.size());
                    if (s != null) liste.add(s);
                }
            }
            // Das Gerät sagt, wie viele es zeigt — meist fünf. Mehr zu setzen
            // wirft, statt den Rest wegzulassen.
            int max = ShortcutManagerCompat.getMaxShortcutCountPerActivity(ctx);
            if (max > 0 && liste.size() > max) liste = liste.subList(0, max);

            if (liste.isEmpty()) ShortcutManagerCompat.removeAllDynamicShortcuts(ctx);
            else ShortcutManagerCompat.setDynamicShortcuts(ctx, liste);

            JSObject ret = new JSObject();
            ret.put("count", liste.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Shortcuts fehlgeschlagen: " + e.getMessage());
        }
    }

    private ShortcutInfoCompat baue(Context ctx, JSONObject o, int rang) {
        String id = o.optString("id", "");
        String label = o.optString("label", id);
        String kurz = o.optString("kurz", label);
        String url = o.optString("url", "");
        if (id.isEmpty() || url.isEmpty() || kurz.isEmpty()) return null;

        // Ausdrücklich auf die eigene Activity: der Kurzbefehl funktioniert
        // damit auch dann, wenn der Intent-Filter im Manifest einmal fehlen
        // sollte. Action und Daten bleiben trotzdem stehen — daran erkennt die
        // WebView das Kommando (appUrlOpen bzw. getLaunchUrl).
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.setClass(ctx, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        return new ShortcutInfoCompat.Builder(ctx, "modell-" + id)
            .setShortLabel(kurz)
            .setLongLabel(label)
            .setIcon(IconCompat.createWithAdaptiveBitmap(
                symbol(farbe(o.optString("color", "")), o.optString("initialen", ""), label)))
            .setRank(rang)
            .setIntent(intent)
            .build();
    }

    private static int farbe(String hex) {
        try { return Color.parseColor(hex); } catch (Exception e) { return FALLBACK_FARBE; }
    }

    /**
     * Ein Symbol aus Farbe und Anfangsbuchstaben.
     *
     * Kein eigenes Bild je Modell: die Farbe steht in der Registry und ändert
     * sich mit ihr, ein mitgeliefertes PNG könnte das nicht. Adaptiv gezeichnet,
     * die Fläche füllt also das ganze Bitmap — sichtbar ist je nach Launcher nur
     * der mittlere Ausschnitt, und dort steht die Schrift.
     */
    private static Bitmap symbol(int farbe, String vorgabe, String label) {
        Bitmap bmp = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        c.drawColor(farbe);

        // Das Kürzel kommt aus der Web-Seite, damit Uhr und Startbildschirm
        // dasselbe zeigen; fehlt es, leitet diese Klasse es selbst ab.
        String txt = (vorgabe == null || vorgabe.isEmpty()) ? initialen(label) : vorgabe;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(kontrast(farbe));
        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setTextAlign(Paint.Align.CENTER);
        p.setTextSize(ICON_PX * (txt.length() > 1 ? 0.30f : 0.40f));
        Paint.FontMetrics fm = p.getFontMetrics();
        c.drawText(txt, ICON_PX / 2f, ICON_PX / 2f - (fm.ascent + fm.descent) / 2f, p);
        return bmp;
    }

    /** „Holy Trainer" → „HT", „Neosteel" → „NE". */
    private static String initialen(String label) {
        String[] teile = String.valueOf(label).trim().split("\\s+");
        if (teile.length >= 2 && !teile[0].isEmpty() && !teile[1].isEmpty()) {
            return (teile[0].charAt(0) + "" + teile[1].charAt(0)).toUpperCase();
        }
        String w = teile.length > 0 ? teile[0] : "";
        if (w.isEmpty()) return "•";
        return w.substring(0, Math.min(2, w.length())).toUpperCase();
    }

    /** Helle Farbe → dunkle Schrift. Sonst wäre die Hälfte der Palette unlesbar. */
    private static int kontrast(int farbe) {
        double l = (0.299 * Color.red(farbe) + 0.587 * Color.green(farbe) + 0.114 * Color.blue(farbe)) / 255.0;
        return l > 0.6 ? 0xFF2B241B : 0xFFFFFFFF;
    }
}
