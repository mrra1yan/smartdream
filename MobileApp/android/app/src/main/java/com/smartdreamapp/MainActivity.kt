package com.smartdreamapp

import android.app.PictureInPictureParams
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  // Keeps the screen from auto-locking/sleeping while the app is in the
  // foreground -- auto-like's timers, the ad-view countdown, and the
  // realtime like-count subscription all live in the main WebView's JS
  // context, which Android throttles/suspends once the screen locks.
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (PipModule.isPiPEnabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val builder = PictureInPictureParams.Builder()
        val aspectRatio = Rational(4, 3)
        builder.setAspectRatio(aspectRatio)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          builder.setAutoEnterEnabled(true)
        }
        enterPictureInPictureMode(builder.build())
      } catch (e: Exception) {
        e.printStackTrace()
      }
    }
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    val reactApplication = application as? ReactApplication
    val reactContext = reactApplication?.reactHost?.currentReactContext
    if (reactContext != null) {
      PipModule.sendPiPModeChangedEvent(reactContext as com.facebook.react.bridge.ReactApplicationContext, isInPictureInPictureMode)
    }
  }

  override fun getMainComponentName(): String = "SmartDreamApp"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
