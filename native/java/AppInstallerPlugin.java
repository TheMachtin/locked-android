package app.locked.themachtin.plugins;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Startet die Installation einer heruntergeladenen APK-Datei.
 * Erfordert REQUEST_INSTALL_PACKAGES + FileProvider im Manifest.
 * Bei fehlender "Unbekannte Quellen"-Berechtigung öffnet die App den passenden Einstellungs-Dialog.
 */
@CapacitorPlugin(name = "AppInstaller")
public class AppInstallerPlugin extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path required");
            return;
        }
        if (path.startsWith("file://")) path = path.substring(7);

        // Ab Android 8 muss die App eine "Unknown apps installieren"-Berechtigung haben
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { getContext().startActivity(settings); } catch (Exception ignored) {}
                call.reject("Install-Berechtigung fehlt — bitte in den Einstellungen erlauben und erneut versuchen");
                return;
            }
        }

        try {
            File file = new File(path);
            if (!file.exists()) { call.reject("Datei nicht gefunden: " + path); return; }
            String authority = getContext().getPackageName() + ".fileprovider";
            Uri uri = FileProvider.getUriForFile(getContext(), authority, file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Install fehlgeschlagen: " + e.getMessage());
        }
    }
}
