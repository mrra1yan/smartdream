package com.smartdreamapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Minimal foreground service that keeps the process alive during PiP mode and
 * background auto-like. Shows ONLY a notification — no floating window, no
 * overlay permission needed (SYSTEM_ALERT_WINDOW NOT required).
 *
 * Why this exists: without a foreground service, Android throttles (Chrome)
 * and may kill the process when the app is backgrounded. When the WebView JS
 * thread is throttled, the 9-second ad-view timers stop firing → ads appear
 * "stuck" in PiP mode. This service tells Android the process is doing
 * important work → timers keep running.
 */
class KeepAliveService : Service() {

    companion object {
        private const val CHANNEL_ID = "smartdream_keepalive"
        private const val NOTIFICATION_ID = 2001
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Auto-Like",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Smart Dream Auto-Like background service"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java).let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Smart Dream")
                .setContentText("Auto-Like running in background")
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setContentIntent(openIntent)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("Smart Dream")
                .setContentText("Auto-Like running in background")
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setContentIntent(openIntent)
                .setOngoing(true)
                .setPriority(Notification.PRIORITY_LOW)
                .build()
        }
    }
}
