package com.smartdreamapp

import android.app.Activity
import android.app.PictureInPictureParams
import android.os.Build
import android.util.Rational
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

class PipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName(): String {
        return "PipModule"
    }

    @ReactMethod
    fun setPiPEnabled(enabled: Boolean) {
        isPiPEnabled = enabled
        val activity = reactApplicationContext.currentActivity ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.runOnUiThread {
                try {
                    val builder = PictureInPictureParams.Builder()
                    val aspectRatio = Rational(4, 3)
                    builder.setAspectRatio(aspectRatio)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        builder.setAutoEnterEnabled(enabled)
                    }
                    activity.setPictureInPictureParams(builder.build())
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }

    /** Lets the JS layer tell native whether auto-like is currently active.
     *  PiP auto-enter (onUserLeaveHint) checks this so the PiP window stays
     *  available even during the brief gap between auto-like batches where
     *  all 3 display slots happen to be empty. */
    @ReactMethod
    fun setAutoLikeActive(active: Boolean) {
        isAutoLikeActive = active
    }

    @ReactMethod
    fun enterPiP() {
        val activity = reactApplicationContext.currentActivity ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.runOnUiThread {
                try {
                    val builder = PictureInPictureParams.Builder()
                    val aspectRatio = Rational(4, 3)
                    builder.setAspectRatio(aspectRatio)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        builder.setAutoEnterEnabled(isPiPEnabled)
                    }
                    activity.enterPictureInPictureMode(builder.build())
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }

    companion object {
        private var instance: PipModule? = null
        var isPiPEnabled: Boolean = false
        var isAutoLikeActive: Boolean = false

        fun sendPiPModeChangedEvent(reactContext: ReactApplicationContext?, isInPiP: Boolean) {
            val params = Arguments.createMap()
            params.putBoolean("isInPiP", isInPiP)
            reactContext
                ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("onPiPModeChanged", params)
        }
    }
}
