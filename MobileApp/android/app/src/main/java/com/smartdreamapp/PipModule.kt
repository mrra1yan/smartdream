package com.smartdreamapp

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native bridge module for Android's native Picture-in-Picture API.
 *
 * Unlike SYSTEM_ALERT_WINDOW (which requires the user to manually enable
 * "Display over other apps" in system settings), native PiP needs NO runtime
 * permission — just a manifest declaration (`supportsPictureInPicture="true"`).
 *
 * When [setPipReady] is called with active=true + ads, the next time the user
 * presses Home, [MainActivity.onUserLeaveHint] calls enterPictureInPictureMode()
 * and the entire Activity shrinks into a system-managed floating window that
 * stays on top of other apps.
 */
class PipModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        /** Whether the React Native layer has indicated that PiP is ready
         *  (Auto-Like active AND ads present). Checked by MainActivity's
         *  onUserLeaveHint() before calling enterPictureInPictureMode(). */
        var pipReady = false

        /** Serialised ad data (JSON array of {url, linkId}) — kept for
         *  potential future use (e.g. PiP custom actions), not consumed
         *  by the PiP enter/exit flow itself. */
        var adsJson: String = "[]"

        /** Singleton reference so MainActivity can emit PiP-change events
         *  back to React Native without requiring a Context lookup. */
        var instance: PipModule? = null
    }

    override fun getName(): String = "PipModule"

    init {
        instance = this
    }

    // ── React Native → Native ───────────────────────────────────────────

    /**
     * Called from React Native whenever Auto-Like active status or ad list
     * changes. When [active] is true and [ads] is non-empty, MainActivity's
     * onUserLeaveHint() will enter PiP mode on the next Home press.
     */
    @ReactMethod
    fun setPipReady(active: Boolean, ads: String) {
        pipReady = active
        adsJson = ads
    }

    /**
     * Called from React Native to programmatically exit PiP mode (e.g. when
     * Auto-Like is paused). Equivalent to the user tapping the PiP window
     * to return to full-screen, but without user interaction.
     */
    @ReactMethod
    fun exitPip() {
        val activity = currentActivity ?: reactContext.currentActivity ?: return
        // moveTaskToBack sends the activity behind all other tasks, which
        // also exits PiP mode since the system only keeps one PiP window.
        activity.moveTaskToBack(true)
    }

    // ── Native → React Native ───────────────────────────────────────────

    /**
     * Called by MainActivity.onPictureInPictureModeChanged() to notify the
     * React Native layer that PiP mode has changed. The JS side uses this
     * event to hide/show the main UI so the PiP window only shows ad content.
     */
    fun emitPipModeChanged(isInPip: Boolean) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onPipModeChanged", isInPip)
    }
}
