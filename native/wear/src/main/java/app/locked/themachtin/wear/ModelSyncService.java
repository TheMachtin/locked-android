package app.locked.themachtin.wear;

import android.util.Log;

import androidx.wear.tiles.TileService;

import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.WearableListenerService;

/**
 * Nimmt die Modell-Registry vom Telefon entgegen.
 *
 * Das Telefon legt sie als Datenelement ab, sobald sich Registry oder Zustand
 * ändern; Google Play Services trägt sie herüber, auch wenn die Uhr-App gerade
 * nicht läuft. Hier wird sie nur weggeschrieben und die Kachel angestoßen —
 * damit sie beim nächsten Blick schon stimmt und nicht erst beim Antippen.
 */
public class ModelSyncService extends WearableListenerService {

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
        if (!neu) return;
        try {
            TileService.getUpdater(this).requestUpdate(LockedTileService.class);
        } catch (Exception e) {
            Log.w(Registry.TAG, "Kachel-Aktualisierung fehlgeschlagen", e);
        }
    }
}
