package de.feder.notes;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Natives HTTP für den Nextcloud-Sync.
 * Der eingebaute Android-HTTP-Client kennt keine WebDAV-Befehle (MKCOL), OkHttp schon.
 * Außerdem gilt hier keine Browser-CORS-Sperre.
 */
@CapacitorPlugin(name = "FederHttp")
public class FederHttpPlugin extends Plugin {

    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .build();

    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        final String method = call.getString("method", "GET").toUpperCase();
        final String body = call.getString("body");
        final JSObject headers = call.getObject("headers", new JSObject());
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Ungültige Adresse");
            return;
        }
        new Thread(() -> {
            try {
                Request.Builder rb = new Request.Builder().url(url);
                String contentType = null;
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    String v = headers.getString(k);
                    if (v == null) continue;
                    if (k.equalsIgnoreCase("content-type")) contentType = v;
                    else rb.header(k, v);
                }
                RequestBody rbody = null;
                if (body != null) {
                    MediaType mt = MediaType.parse(contentType != null ? contentType : "application/octet-stream");
                    rbody = RequestBody.create(body.getBytes(StandardCharsets.UTF_8), mt);
                } else if (method.equals("POST") || method.equals("PUT") || method.equals("PATCH")) {
                    rbody = RequestBody.create(new byte[0], null);
                }
                rb.method(method, rbody);
                try (Response r = client.newCall(rb.build()).execute()) {
                    JSObject h = new JSObject();
                    for (String name : r.headers().names()) h.put(name.toLowerCase(), r.header(name));
                    JSObject ret = new JSObject();
                    ret.put("status", r.code());
                    ret.put("headers", h);
                    ret.put("text", r.body() != null ? r.body().string() : "");
                    call.resolve(ret);
                }
            } catch (Exception ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : ex.toString());
            }
        }).start();
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Ungültige Adresse");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
