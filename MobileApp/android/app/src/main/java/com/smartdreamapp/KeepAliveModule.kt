package com.smartdreamapp

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native bridge for the lightweight KeepAliveService.
 * No permissions needed beyond FOREGROUND_SERVICE (manifest-only, auto-granted).
 */
class KeepAliveModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "KeepAliveModule"

    @ReactMethod
    fun start() {
        val intent = Intent(reactContext, KeepAliveService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @ReactMethod
    fun stop() {
        try {
            val intent = Intent(reactContext, KeepAliveService::class.java)
            reactContext.stopService(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
