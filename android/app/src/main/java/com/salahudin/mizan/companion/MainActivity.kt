package com.salahudin.mizan.companion

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Hosts the companion page (the same file the desktop serves) from local assets, so it opens
 * instantly and works offline. The page talks to the desktop over the LAN with its pairing code.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var pageReady = false
    private var pendingLink: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
        }
        web.addJavascriptInterface(Bridge(), "MizanAndroid")
        // Without a WebChromeClient, confirm() silently returns false (e.g. "Forget this desktop").
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            // Only the bundled page may load in this WebView: it is the only page that gets the bridge.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "file") return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                pendingLink?.let { pair(it) }
                pendingLink = null
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("file:///android_asset/index.html")
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    // Pausing the WebView fires `visibilitychange`, which the page reports as a phone check during focus.
    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private fun handleIntent(intent: Intent?) {
        val link = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data?.let { uri: Uri ->
                if (uri.scheme == "mizan") uri.getQueryParameter("link") else uri.toString()
            }
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        } ?: return
        if (pageReady) pair(link) else pendingLink = link
    }

    private fun pair(link: String) {
        web.evaluateJavascript("window.mizanPair && window.mizanPair(${JSONObject.quote(link.trim())})") { result ->
            if (result != "true") Toast.makeText(this, "That is not a Mizan pairing link.", Toast.LENGTH_LONG).show()
        }
    }

    private inner class Bridge {
        /**
         * IPv4 addresses of this phone's local links, so the page can find the desktop after
         * the hotspot or USB tethering hands out a new subnet. Mobile data and VPNs are skipped.
         */
        @JavascriptInterface
        fun localAddresses(): String {
            val out = JSONArray()
            val local = Regex("^(wlan|swlan|ap|softap|rndis|usb|ncm|eth|bt-pan|bnep)\\d*")
            runCatching {
                for (iface in NetworkInterface.getNetworkInterfaces()) {
                    if (!iface.isUp || iface.isLoopback || !local.containsMatchIn(iface.name)) continue
                    for (address in iface.inetAddresses) {
                        if (address !is Inet4Address || !address.isSiteLocalAddress) continue
                        out.put(JSONObject().put("name", iface.name).put("ip", address.hostAddress))
                    }
                }
            }
            return out.toString()
        }

        @JavascriptInterface
        fun keepScreenOn(on: Boolean) = runOnUiThread {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        @JavascriptInterface
        fun setImmersive(on: Boolean) = runOnUiThread {
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            if (on) {
                controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsetsCompat.Type.systemBars())
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars())
            }
        }

        @JavascriptInterface
        fun hasScanner(): Boolean = QrScanner.AVAILABLE

        @JavascriptInterface
        fun scanQr() = runOnUiThread {
            QrScanner.scan(this@MainActivity, { pair(it) }) { message ->
                Toast.makeText(this@MainActivity, "$message Paste the link instead.", Toast.LENGTH_LONG).show()
            }
        }
    }
}
