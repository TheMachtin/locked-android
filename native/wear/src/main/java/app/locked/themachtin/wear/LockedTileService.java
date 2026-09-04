package app.locked.themachtin.wear;

import android.content.Context;
import android.util.Log;

import androidx.wear.protolayout.ActionBuilders;
import androidx.wear.protolayout.ColorBuilders;
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters;
import androidx.wear.protolayout.DimensionBuilders;
import androidx.wear.protolayout.DimensionBuilders.DpProp;
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement;
import androidx.wear.protolayout.ModifiersBuilders.Clickable;
import androidx.wear.protolayout.ResourceBuilders;
import androidx.wear.protolayout.TimelineBuilders;
import androidx.wear.protolayout.material.Button;
import androidx.wear.protolayout.material.ButtonColors;
import androidx.wear.protolayout.material.ButtonDefaults;
import androidx.wear.protolayout.material.Text;
import androidx.wear.protolayout.material.Typography;
import androidx.wear.protolayout.material.layouts.MultiButtonLayout;
import androidx.wear.protolayout.material.layouts.PrimaryLayout;
import androidx.wear.tiles.EventBuilders;
import androidx.wear.tiles.RequestBuilders;
import androidx.wear.tiles.TileBuilders;
import androidx.wear.tiles.TileService;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.List;

/**
 * Die Kachel.
 *
 * Eine Wischbewegung vom Zifferblatt, ein Tipp — mehr soll ein Eintrag am
 * Handgelenk nicht kosten. Oben steht, was gerade getragen wird und seit wann
 * (das Telefon meldet beides mit), darunter die Modelle als farbige Knöpfe mit
 * ihrem Kürzel.
 *
 * Welche Knöpfe das sind, entscheidet das Telefon — hier steht nur, wie sie
 * aussehen. Der gerade getragene Zustand ist nicht dabei; das ist die Auskunft
 * oben, kein Knopf. Was übrig bleibt, wird dafür größer gezeichnet.
 *
 * Der Tipp löst kein Öffnen einer App aus, sondern `LoadAction`: das System
 * ruft diese Klasse erneut auf, wir erkennen am Knopf-Kennzeichen, was gemeint
 * war, schicken es ans Telefon und zeichnen die Kachel gleich mit der Antwort
 * neu. Deshalb bleibt der Bildschirm, wo er ist.
 *
 * Ereignisse mit Preis stehen hier bewusst nicht: das Telefon schickt sie gar
 * nicht erst herüber. Ein Fehlgriff am Handgelenk darf nichts kosten.
 */
public class LockedTileService extends TileService {

    private static final String RES_VERSION = "1";
    /** MultiButtonLayout trägt höchstens sieben; sechs bleiben auf kleinen Uhren lesbar. */
    private static final int MAX_KNOEPFE = 6;
    /**
     * Wie oft die Kachel sich von selbst neu rechnet.
     *
     * Der Zustand oben trägt eine Dauer, und eine Dauer altert. Das Telefon meldet
     * sich nur, wenn sich etwas *ändert* — wer seit dem Morgen nichts eingetragen
     * hat, sähe sonst mittags noch „gerade eben".
     */
    private static final long AUFFRISCHUNG_MS = 5 * 60 * 1000L;

    /** Zwischenraum, den MultiButtonLayout zwischen die Knöpfe legt. */
    private static final float ABSTAND_DP = 6f;
    /** Anteil des Bildschirms, den PrimaryLayout dem Inhalt lässt — quer und hoch. */
    private static final float BREITE_ANTEIL = 0.89f;
    private static final float HOEHE_ANTEIL = 0.60f;

    @Override
    protected ListenableFuture<TileBuilders.Tile> onTileRequest(RequestBuilders.TileRequest request) {
        List<Registry.Modell> modelle = Registry.laden(this);
        String geklickt = null;
        if (request.getCurrentState() != null) {
            geklickt = request.getCurrentState().getLastClickableId();
        }
        if (istEchterTipp(geklickt, modelle)) {
            // Erst die Rückmeldung setzen, dann senden: die Kachel wird unten
            // sofort gezeichnet, das Senden dauert länger als dieser Aufruf.
            Registry.setzeStatus(this, "→ " + Registry.labelVon(this, geklickt));
            Registry.sende(this, geklickt);
        }

        LayoutElement layout = layout(this, request.getDeviceConfiguration(), modelle);
        return Futures.immediateFuture(new TileBuilders.Tile.Builder()
            .setResourcesVersion(RES_VERSION)
            .setFreshnessIntervalMillis(AUFFRISCHUNG_MS)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
            .build());
    }

    /**
     * Beim Hinsehen neu rechnen.
     *
     * Zwischen zwei Auffrischungen liegen Minuten; die Dauer oben wäre beim Blick
     * auf die Kachel also bis zu so alt. Wer hersieht, soll den aktuellen Stand
     * sehen und nicht den von vorhin.
     */
    @Override
    protected void onTileEnterEvent(EventBuilders.TileEnterEvent requestParams) {
        try {
            getUpdater(this).requestUpdate(LockedTileService.class);
        } catch (Exception e) {
            Log.w(Registry.TAG, "Kachel-Aktualisierung fehlgeschlagen", e);
        }
    }

    /**
     * Ein echter Tipp — oder derselbe Zustand noch einmal gezeichnet?
     *
     * Das Kennzeichen des zuletzt gedrückten Knopfes bleibt im Zustand der Kachel
     * stehen. Jeder spätere Anlass zu zeichnen — die Meldung des Telefons, ein
     * Blick auf die Kachel, das Auffrischen — bringt es erneut mit; ohne Sperre
     * entstünde daraus ein Eintrag, den niemand ausgelöst hat.
     *
     * Zwei Dinge unterscheiden den echten Tipp, und sie greifen nacheinander:
     *
     *   - Der getippte Knopf ist gleich darauf **weg**. Das Telefon meldet das
     *     Modell als getragen zurück, und was getragen wird, steht nicht als Knopf
     *     auf der Kachel. Ein Kennzeichen, das zu keinem sichtbaren Knopf gehört,
     *     kann folglich kein Tipp von eben sein.
     *   - Bis diese Meldung eintrifft — oder falls sie ausbleibt, weil das Telefon
     *     nicht erreichbar ist — deckt das Wiederholfenster den Fall ab.
     */
    private boolean istEchterTipp(String id, List<Registry.Modell> sichtbar) {
        if (id == null || id.isEmpty()) return false;
        boolean steht = false;
        for (Registry.Modell m : sichtbar) {
            if (m.id.equals(id)) { steht = true; break; }
        }
        return steht && !Registry.istWiederholung(this, id);
    }

    @Override
    protected ListenableFuture<ResourceBuilders.Resources> onTileResourcesRequest(
            RequestBuilders.ResourcesRequest request) {
        // Keine Bilder — die Knöpfe tragen Text. Nichts zu liefern, aber die
        // Fassung muss stimmen, sonst zeigt das System gar nichts an.
        return Futures.immediateFuture(
            new ResourceBuilders.Resources.Builder().setVersion(RES_VERSION).build());
    }

    private static LayoutElement layout(Context ctx, DeviceParameters geraet,
            List<Registry.Modell> modelle) {
        Text kopf = new Text.Builder(ctx, Registry.kopfzeile(ctx))
            .setTypography(Typography.TYPOGRAPHY_CAPTION2)
            .setColor(ColorBuilders.argb(0xFFB9A98E))
            .setMaxLines(1)
            .build();

        if (modelle.isEmpty()) {
            // Ohne Registry gibt es nichts anzutippen. Sagen, warum — eine leere
            // Kachel sähe nach einem Fehler aus.
            return new PrimaryLayout.Builder(geraet)
                .setPrimaryLabelTextContent(kopf)
                .setContent(new Text.Builder(ctx, "Locked am Telefon einmal öffnen")
                    .setTypography(Typography.TYPOGRAPHY_BODY2)
                    .setColor(ColorBuilders.argb(0xFFF3EAD9))
                    .setMaxLines(3)
                    .build())
                .build();
        }

        MultiButtonLayout.Builder knoepfe = new MultiButtonLayout.Builder();
        int anzahl = Math.min(modelle.size(), MAX_KNOEPFE);
        DpProp groesse = knopfGroesse(anzahl, geraet);
        for (int i = 0; i < anzahl; i++) {
            Registry.Modell m = modelle.get(i);
            Clickable klick = new Clickable.Builder()
                .setId(m.id)
                .setOnClick(new ActionBuilders.LoadAction.Builder().build())
                .build();
            knoepfe.addButtonContent(new Button.Builder(ctx, klick)
                .setTextContent(m.kurz)
                .setSize(groesse)
                // Vorgelesen wird sonst „H T". Der volle Name steht ohnehin schon
                // in der Registry — hier kostet er nichts und trägt alles.
                .setContentDescription(m.label)
                .setButtonColors(new ButtonColors(m.farbe, m.schrift))
                .build());
        }

        return new PrimaryLayout.Builder(geraet)
            .setPrimaryLabelTextContent(kopf)
            .setContent(knoepfe.build())
            .build();
    }

    /**
     * Wie groß ein Knopf sein darf.
     *
     * MultiButtonLayout wählt selbst, aber vorsichtig: ab vier Knöpfen fällt es
     * auf die Standardgröße zurück, obwohl ein rundes Zifferblatt von 45 mm
     * deutlich mehr hergibt — und getroffen wird die Kachel unterwegs, mit einer
     * Hand, ohne hinzusehen. Hier steht deshalb eine eigene Staffel, eine Stufe
     * großzügiger als die eingebaute.
     *
     * Gedeckelt wird sie am tatsächlichen Bildschirm statt an einer Annahme über
     * ihn: das Raster, in dem MultiButtonLayout die Knöpfe anordnet (zwei Reihen
     * ab vier Knöpfen, drei Spalten ab fünf), muss samt Zwischenraum in den Platz
     * passen, den PrimaryLayout dem Inhalt lässt. Sonst gewänne die kleine Uhr
     * einen Rand, den sie nicht hat.
     */
    private static DpProp knopfGroesse(int anzahl, DeviceParameters geraet) {
        DpProp gewuenscht = anzahl <= 2 ? ButtonDefaults.EXTRA_LARGE_SIZE
            : anzahl <= 4 ? ButtonDefaults.LARGE_SIZE
            : ButtonDefaults.DEFAULT_SIZE;

        int spalten = anzahl == 4 ? 2 : Math.min(Math.max(anzahl, 1), 3);
        int reihen = anzahl <= 3 ? 1 : 2;
        float quer = (geraet.getScreenWidthDp() * BREITE_ANTEIL - (spalten - 1) * ABSTAND_DP) / spalten;
        float hoch = (geraet.getScreenHeightDp() * HOEHE_ANTEIL - (reihen - 1) * ABSTAND_DP) / reihen;
        float platz = Math.min(quer, hoch);

        return gewuenscht.getValue() <= platz ? gewuenscht : DimensionBuilders.dp(platz);
    }
}
