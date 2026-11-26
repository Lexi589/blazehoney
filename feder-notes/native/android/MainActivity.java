package de.feder.notes;

import android.os.Bundle;
import android.view.MotionEvent;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Samsung S Pen: bei gedrückter Seitentaste kommen eigene Event-Codes statt DOWN/UP/MOVE
    private static final int SPEN_ACTION_DOWN = 211;
    private static final int SPEN_ACTION_UP = 212;
    private static final int SPEN_ACTION_MOVE = 213;

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

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        MotionEvent converted = convertPenButton(ev);
        boolean handled = super.dispatchTouchEvent(converted);
        if (converted != ev) converted.recycle();
        return handled;
    }

    /**
     * S-Pen-Seitentaste → Radierer: Samsung-Codes (211–213) in normale Ereignisse umwandeln und
     * die Taste als „zweite Taste" melden. Im WebView kommt das als pointerType "pen" mit buttons & 2 an,
     * was die App als Radierer auswertet.
     */
    private static MotionEvent convertPenButton(MotionEvent ev) {
        int action = ev.getAction();
        boolean samsung = action == SPEN_ACTION_DOWN || action == SPEN_ACTION_UP || action == SPEN_ACTION_MOVE;
        boolean stylusButton = (ev.getButtonState() & MotionEvent.BUTTON_STYLUS_PRIMARY) != 0;
        if (!samsung && !stylusButton) return ev;
        if (!samsung && (ev.getButtonState() & MotionEvent.BUTTON_SECONDARY) != 0) return ev;   // schon passend

        int newAction = action;
        if (action == SPEN_ACTION_DOWN) newAction = MotionEvent.ACTION_DOWN;
        else if (action == SPEN_ACTION_UP) newAction = MotionEvent.ACTION_UP;
        else if (action == SPEN_ACTION_MOVE) newAction = MotionEvent.ACTION_MOVE;

        int n = ev.getPointerCount();
        MotionEvent.PointerProperties[] props = new MotionEvent.PointerProperties[n];
        MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[n];
        for (int i = 0; i < n; i++) {
            props[i] = new MotionEvent.PointerProperties();
            ev.getPointerProperties(i, props[i]);
            if (samsung) props[i].toolType = MotionEvent.TOOL_TYPE_STYLUS;
            coords[i] = new MotionEvent.PointerCoords();
            ev.getPointerCoords(i, coords[i]);
        }
        int buttons = ev.getButtonState() | MotionEvent.BUTTON_STYLUS_PRIMARY | MotionEvent.BUTTON_SECONDARY;
        if (newAction == MotionEvent.ACTION_UP) buttons = 0;
        return MotionEvent.obtain(ev.getDownTime(), ev.getEventTime(), newAction, n, props, coords,
                ev.getMetaState(), buttons, ev.getXPrecision(), ev.getYPrecision(), ev.getDeviceId(),
                ev.getEdgeFlags(), ev.getSource(), ev.getFlags());
    }
}
