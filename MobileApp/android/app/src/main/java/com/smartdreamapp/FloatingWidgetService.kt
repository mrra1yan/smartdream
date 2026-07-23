package com.smartdreamapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONArray

class FloatingWidgetService : Service() {

    private lateinit var windowManager: WindowManager
    private var floatingView: View? = null
    private var webViewContainer: LinearLayout? = null
    private var windowParams: WindowManager.LayoutParams? = null
    private val slotViews = mutableListOf<SlotView>()
    private var isCollapsed = false
    private var activeSlotCount = 0

    private data class SlotView(
        val container: LinearLayout,
        val webView: WebView,
        val titleView: TextView,
        var currentLinkId: String = "",
        var currentUrl: String = ""
    )

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundServiceNotification()
        setupFloatingWindow()
    }

    private fun startForegroundServiceNotification() {
        val channelId = "floating_autolike_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Smart Dream Auto-Like Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Smart Dream Auto-Liker")
            .setContentText("Floating 3-slot auto-like is running in background")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(1001, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(1001, notification)
        }
    }

    private fun setupFloatingWindow() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            dpToPx(110), // 110dp width footprint (matching Ad Container width)
            dpToPx(178), // Default 1 slot height (16dp header + 2dp padding + 160dp slot)
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 20
            y = 100
        }
        windowParams = params

        // Rounded background drawable for main container
        val mainBg = GradientDrawable().apply {
            setColor(Color.parseColor("#18181B"))
            cornerRadius = dpToPx(5).toFloat()
            setStroke(dpToPx(1), Color.parseColor("#3F3F46"))
        }

        // Main Container
        val mainContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = mainBg
            elevation = dpToPx(3).toFloat()
            setPadding(dpToPx(1), dpToPx(1), dpToPx(1), dpToPx(1))
        }

        // Header Bar (Draggable, Collapse, Close)
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#09090B"))
            setPadding(dpToPx(4), dpToPx(1), dpToPx(4), dpToPx(1))
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(16)
            )
        }

        val titleText = TextView(this).apply {
            text = "⚡ SD Auto"
            setTextColor(Color.parseColor("#A855F7"))
            textSize = 8f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val toggleBtn = TextView(this).apply {
            text = "━"
            setTextColor(Color.LTGRAY)
            textSize = 9f
            setPadding(dpToPx(2), 0, dpToPx(2), 0)
            setOnClickListener {
                toggleCollapse()
            }
        }

        val closeBtn = TextView(this).apply {
            text = "✕"
            setTextColor(Color.parseColor("#EF4444"))
            textSize = 9f
            setPadding(dpToPx(1), 0, dpToPx(1), 0)
            setOnClickListener {
                stopSelf()
            }
        }

        header.addView(titleText)
        header.addView(toggleBtn)
        header.addView(closeBtn)

        // WebViews Container (Stacked vertically one below another)
        webViewContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dpToPx(1), 0, dpToPx(1))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
        }

        mainContainer.addView(header)
        mainContainer.addView(webViewContainer)

        floatingView = mainContainer
        try {
            windowManager.addView(floatingView, params)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Dragging Touch Listener
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f

        header.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = initialX + (event.rawX - initialTouchX).toInt()
                    params.y = initialY + (event.rawY - initialTouchY).toInt()
                    windowManager.updateViewLayout(floatingView, params)
                    true
                }
                else -> false
            }
        }
    }

    private fun createSlotView(url: String, linkId: String): SlotView {
        val cardContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f // Distribute height evenly among active slots inside fixed 160dp container area
            ).apply {
                setMargins(0, dpToPx(1), 0, dpToPx(1))
            }
            setBackgroundColor(Color.parseColor("#27272A"))
        }

        val cardHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#18181B"))
            setPadding(dpToPx(1), 0, dpToPx(1), 0)
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dpToPx(14)
            )
        }

        val slotTitle = TextView(this).apply {
            text = "#1"
            setTextColor(Color.WHITE)
            textSize = 7f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        cardHeader.addView(slotTitle)

        val wv = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.userAgentString =
                "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 SmartDreamApp/1.0"
            // Block all navigation — floating ads must never redirect away
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: android.webkit.WebResourceRequest?,
                ): Boolean = true
            }
        }

        if (!url.isNullOrEmpty()) {
            wv.loadUrl(url)
        }

        cardContainer.addView(cardHeader)
        cardContainer.addView(wv)

        return SlotView(cardContainer, wv, slotTitle, linkId, url)
    }

    private fun updateWindowDimensions() {
        val params = windowParams ?: return
        params.width = dpToPx(110)
        if (isCollapsed) {
            params.height = dpToPx(16)
        } else {
            // Fixed total height: 16dp header + 2dp padding + 160dp ad container area = 178dp
            params.height = dpToPx(178)
        }
        if (floatingView != null) {
            try {
                windowManager.updateViewLayout(floatingView, params)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun toggleCollapse() {
        isCollapsed = !isCollapsed
        webViewContainer?.visibility = if (isCollapsed) View.GONE else View.VISIBLE
        updateWindowDimensions()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val adsJson = intent?.getStringExtra("ads_json")
        if (adsJson.isNullOrEmpty() || adsJson == "[]") {
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            val jsonArray = JSONArray(adsJson)
            val count = jsonArray.length()

            if (count == 0) {
                stopSelf()
                return START_NOT_STICKY
            }

            activeSlotCount = count

            for (i in 0 until count) {
                val obj = jsonArray.optJSONObject(i) ?: continue
                val url = obj.optString("url")
                val linkId = obj.optString("linkId")

                if (i < slotViews.size) {
                    val slot = slotViews[i]
                    slot.container.visibility = View.VISIBLE
                    slot.titleView.text = "Ad #${i + 1}"
                    if (slot.currentUrl != url) {
                        slot.currentUrl = url
                        slot.currentLinkId = linkId
                        slot.webView.loadUrl(url)
                    }
                } else {
                    val slot = createSlotView(url, linkId)
                    slot.titleView.text = "Ad #${i + 1}"
                    slotViews.add(slot)
                    webViewContainer?.addView(slot.container)
                }
            }

            // Hide unused slots if current ad count is less than created slots
            for (i in count until slotViews.size) {
                val slot = slotViews[i]
                slot.container.visibility = View.GONE
                if (slot.currentUrl != "about:blank") {
                    slot.webView.loadUrl("about:blank")
                    slot.currentUrl = "about:blank"
                }
            }

            updateWindowDimensions()
        } catch (e: Exception) {
            e.printStackTrace()
        }

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        for (slot in slotViews) {
            slot.webView.stopLoading()
            slot.webView.destroy()
        }
        slotViews.clear()
        if (floatingView != null) {
            try {
                windowManager.removeView(floatingView)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            floatingView = null
        }
    }

    private fun dpToPx(dp: Int): Int {
        val density = resources.displayMetrics.density
        return (dp * density).toInt()
    }
}
