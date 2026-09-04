package app.locked.themachtin.wear;

import android.util.Log;

import androidx.wear.tiles.TileService;

import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;

import java.nio.charset.StandardCharsets;

/**
 * Nimmt entgegen, was vom Telefon kommt: die Modell-Registry — und die
 * Bestätigung, dass ein Tipp angekommen ist.
 *
 * Das Telefon legt sie als Datenelement ab, sobald sich Registry oder Zustand
 * ändern; Google Play Services trägt sie herüber, auch wenn die Uhr-App gerade
 * nicht läuft. Hier wird sie nur weggeschrieben und die Kachel angestoßen —
 * damit sie beim nächsten Blick schon stimmt und nicht erst beim Antippen.
 */
public class ModelSyncService extends WearableListenerService {

    /**
     * Das Telefon hat einen Tipp übernommen.
     *
     * Diese Nachricht ist der einzige Beweis, dass er drüben ist: der Erfolg beim
     * Senden sagt nur, dass Play Services ihn angenommen hat. Erst hier wird er
     * aus der Warteschlange gestrichen.
     */
    @Override
    public void onMessageReceived(MessageEvent event) {
        if (event == null || !Registry.PFAD_OK.equals(event.getPath())) return;
        String marke = new String(event.getData(), StandardCharsets.UTF_8).trim();
        if (marke.isEmpty()) return;
        Registry.bestaetigt(this, marke);
    }

    @Override
    public void onDataChanged(DataEventBuffer events) {
        boolean neu = false;
        for (DataEvent event : events) {
            if (event.getType() != DataEvent.TYPE_CHANGED) continue;
            if (!Registry.PFAD_REGISTRY.equals(event.getDataItem().getUri().getPath())) continue;
            String json = DataMapItem.fromDataItem(event.getDataItem()).getDataMap().getString("json");
            if (json == null || json.isEmpty()) continue;
            Registry.speichere(this, json);
            neu = true;
        }
        // Das Telefon hat sich gemeldet, ist also erreichbar — der beste Moment für
        // Tipps, die von einer Funklücke übrig sind.
        Registry.zustellen(this, false);
        if (!neu) return;
        try {
            TileService.getUpdater(this).requestUpdate(LockedTileService.class);
        } catch (Exception e) {
            Log.w(Registry.TAG, "Kachel-Aktualisierung fehlgeschlagen", e);
        }
    }
}
