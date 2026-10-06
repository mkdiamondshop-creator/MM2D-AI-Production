package com.mm2d.app;

import android.annotation.SuppressLint;
import android.content.res.AssetManager;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends AppCompatActivity {
    private WebView webView;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(true);

        final WebViewAssetLoader.PathHandler assetPathHandler = new WebViewAssetLoader.PathHandler() {
            @Override
            public WebResourceResponse handle(@NonNull String path) {
                try {
                    AssetManager assets = getAssets();
                    InputStream is;
                    try {
                        is = assets.open(path);
                    } catch (IOException e) {
                        is = assets.open("assets/" + path);
                    }
                    String mimeType = "text/html";
                    if (path.endsWith(".js")) mimeType = "application/javascript";
                    else if (path.endsWith(".css")) mimeType = "text/css";
                    else if (path.endsWith(".png")) mimeType = "image/png";
                    else if (path.endsWith(".svg")) mimeType = "image/svg+xml";
                    else if (path.endsWith(".json")) mimeType = "application/json";
                    else if (path.endsWith(".webp")) mimeType = "image/webp";
                    else if (path.endsWith(".ico")) mimeType = "image/x-icon";
                    else if (path.endsWith(".woff2")) mimeType = "font/woff2";
                    else if (path.endsWith(".woff")) mimeType = "font/woff";
                    else if (path.endsWith(".ttf")) mimeType = "font/ttf";
                    return new WebResourceResponse(mimeType, "UTF-8", is);
                } catch (IOException e) {
                    return null;
                }
            }
        };

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", assetPathHandler)
            .addPathHandler("/", assetPathHandler)
            .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
