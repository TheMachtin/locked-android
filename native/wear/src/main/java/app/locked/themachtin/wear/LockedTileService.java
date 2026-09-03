package app.locked.themachtin.wear;

import android.content.Context;

import androidx.wear.protolayout.ActionBuilders;
import androidx.wear.protolayout.ColorBuilders;
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters;
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement;
import androidx.wear.protolayout.ModifiersBuilders.Clickable;
import androidx.wear.protolayout.ResourceBuilders;
import androidx.wear.protolayout.TimelineBuilders;
import androidx.wear.protolayout.material.Button;
import androidx.wear.protolayout.material.ButtonColors;
import androidx.wear.protolayout.material.Text;
import androidx.wear.protolayout.material.Typography;
import androidx.wear.protolayout.material.layouts.MultiButtonLayout;
import androidx.wear.protolayout.material.layouts.PrimaryLayout;
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
 * Handgelenk nicht kosten. Oben steht, was gerade getragen wird (das Telefon
 * meldet es mit), darunter die Modelle als farbige Knöpfe mit ihren
 * Anfangsbuchstaben.
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

    @Override
    protected ListenableFuture<TileBuilders.Tile> onTileRequest(RequestBuilders.TileRequest request) {
        String geklickt = null;
        if (request.getCurrentState() != null) {
            geklickt = request.getCurrentState().getLastClickableId();
        }
        if (geklickt != null && !geklickt.isEmpty()) {
            // Erst die Rückmeldung setzen, dann senden: die Kachel wird unten
            // sofort gezeichnet, das Senden dauert länger als dieser Aufruf.
            Registry.setzeStatus(this, "→ " + Registry.labelVon(this, geklickt));
            Registry.sende(this, geklickt);
        }

        LayoutElement layout = layout(this, request.getDeviceConfiguration());
        return Futures.immediateFuture(new TileBuilders.Tile.Builder()
            .setResourcesVersion(RES_VERSION)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
            .build());
    }

    @Override
    protected ListenableFuture<ResourceBuilders.Resources> onTileResourcesRequest(
            RequestBuilders.ResourcesRequest request) {
        // Keine Bilder — die Knöpfe tragen Text. Nichts zu liefern, aber die
        // Fassung muss stimmen, sonst zeigt das System gar nichts an.
        return Futures.immediateFuture(
            new ResourceBuilders.Resources.Builder().setVersion(RES_VERSION).build());
    }

    private static LayoutElement layout(Context ctx, DeviceParameters geraet) {
        List<Registry.Modell> modelle = Registry.laden(ctx);
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
        for (int i = 0; i < anzahl; i++) {
            Registry.Modell m = modelle.get(i);
            Clickable klick = new Clickable.Builder()
                .setId(m.id)
                .setOnClick(new ActionBuilders.LoadAction.Builder().build())
                .build();
            knoepfe.addButtonContent(new Button.Builder(ctx, klick)
                .setTextContent(m.kurz)
                .setButtonColors(new ButtonColors(m.farbe, m.schrift))
                .build());
        }

        return new PrimaryLayout.Builder(geraet)
            .setPrimaryLabelTextContent(kopf)
            .setContent(knoepfe.build())
            .build();
    }
}
