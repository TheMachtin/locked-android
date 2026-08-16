package app.locked.themachtin;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import app.locked.themachtin.plugins.AppInstallerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
