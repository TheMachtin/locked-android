package app.locked.themachtin.wear;

import android.app.Activity;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataItemBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.Wearable;

import java.util.List;

/**
 * Die Liste in der App-Übersicht.
 *
 * Die Kachel ist der schnelle Weg, aber sie zeigt nur Anfangsbuchstaben. Wer
 * nachsehen will, welcher Knopf welcher Käfig ist — oder wer die Kachel gar
 * nicht eingerichtet hat —, findet hier dieselben Modelle mit vollem Namen.
 */
public class WearMainActivity extends Activity {

    private LinearLayout spalte;
    private TextView kopf;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF000000);
        spalte = new LinearLayout(this);
        spalte.setOrientation(LinearLayout.VERTICAL);
        // Runder Bildschirm: oben und unten mehr Luft, sonst liegt der erste
        // Knopf in der Rundung.
        spalte.setPadding(dp(16), dp(34), dp(16), dp(34));
        scroll.addView(spalte, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);

        kopf = new TextView(this);
        kopf.setTextColor(0xFFB9A98E);
        kopf.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        kopf.setGravity(Gravity.CENTER);
        kopf.setPadding(0, 0, 0, dp(10));
        spalte.addView(kopf);

        holeRegistry();
        zeichne();
    }

    @Override
    protected void onResume() {
        super.onResume();
        zeichne();
    }

    /** Einmal aktiv nachfragen — falls die Uhr die Meldung des Telefons verpasst hat. */
    private void holeRegistry() {
        try {
            Wearable.getDataClient(this).getDataItems().addOnSuccessListener(buffer -> {
                try {
                    for (DataItem item : buffer) {
                        if (!Registry.PFAD_REGISTRY.equals(item.getUri().getPath())) continue;
                        String json = DataMapItem.fromDataItem(item).getDataMap().getString("json");
                        if (json != null && !json.isEmpty()) Registry.speichere(this, json);
                    }
                } finally {
                    buffer.release();
                }
                zeichne();
            });
        } catch (Exception ignored) { /* ohne Play Services bleibt der letzte Stand stehen */ }
    }

    private void zeichne() {
        kopf.setText(Registry.kopfzeile(this));
        // Alles außer der Kopfzeile neu aufbauen.
        while (spalte.getChildCount() > 1) spalte.removeViewAt(1);

        List<Registry.Modell> modelle = Registry.laden(this);
        if (modelle.isEmpty()) {
            TextView leer = new TextView(this);
            leer.setText("Noch keine Modelle empfangen.\n\nLocked am Telefon einmal öffnen —"
                + " danach stehen sie hier und auf der Kachel.");
            leer.setTextColor(0xFFF3EAD9);
            leer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            leer.setGravity(Gravity.CENTER);
            spalte.addView(leer);
            return;
        }

        for (Registry.Modell m : modelle) {
            spalte.addView(taste(m));
        }
    }

    private View taste(final Registry.Modell m) {
        Button b = new Button(this);
        b.setText(m.label);
        b.setAllCaps(false);
        b.setTextColor(m.schrift);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setPadding(dp(10), dp(10), dp(10), dp(10));

        GradientDrawable form = new GradientDrawable();
        form.setColor(m.farbe);
        form.setCornerRadius(dp(22));
        b.setBackground(form);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(44));
        lp.bottomMargin = dp(8);
        b.setLayoutParams(lp);

        b.setOnClickListener(v -> {
            Registry.setzeStatus(this, "→ " + m.label);
            Registry.sende(this, m.id);
            kopf.setText(Registry.kopfzeile(this));
            v.setAlpha(0.6f);
            v.animate().alpha(1f).setDuration(400).start();
        });
        return b;
    }

    private int dp(int wert) {
        return Math.round(wert * getResources().getDisplayMetrics().density);
    }
}
