package app.locked.themachtin;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import app.locked.themachtin.plugins.AppInstallerPlugin;
import app.locked.themachtin.plugins.ShortcutsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppInstallerPlugin.class);
        registerPlugin(ShortcutsPlugin.class);
        vergissWiederhergestelltesKommando();
        super.onCreate(savedInstanceState);
    }

    /**
     * Ein Kommando gilt einmal.
     *
     * Ein Kurzbefehl startet die App mit `locked://log?…`; die App trägt ein und
     * geht in den Hintergrund. Wird sie später aus den „letzten Apps" geholt,
     * *nachdem* Android den Prozess beendet hat, liefert das System denselben
     * Intent noch einmal aus — die WebView läuft neu, liest die Start-URL und
     * würde denselben Eintrag ein zweites Mal schreiben, mit der Uhrzeit von
     * jetzt. Das Flag unterscheidet beide Fälle: es steht nur an einem Intent,
     * der aus der Übersicht wiederhergestellt wurde, und nie an einem frisch
     * angetippten Kurzbefehl.
     */
    private void vergissWiederhergestelltesKommando() {
        Intent intent = getIntent();
        if (intent == null) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) return;
        intent.setData(null);
        setIntent(intent);
    }
}
