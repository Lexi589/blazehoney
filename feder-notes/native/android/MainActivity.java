package de.feder.notes;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FederHttpPlugin.class);
        super.onCreate(savedInstanceState);

        // Zurück-Taste: erst in der App zurück (Editor → Liste), sonst App in den Hintergrund
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge().getWebView();
                wv.evaluateJavascript("(window.federBack && window.federBack()) ? '1' : '0'", value -> {
                    if (value == null || !value.contains("1")) moveTaskToBack(true);
                });
            }
        });
    }
}
