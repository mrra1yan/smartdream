package com.smartdreamapp

import android.app.PictureInPictureParams
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
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

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "SmartDreamApp"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // ── Native Picture-in-Picture (zero-permission floating window) ────────
  //
  // When the user presses Home while Auto-Like is active with ads, we enter
  // Android's native PiP mode instead of fully backgrounding. Unlike the
  // old SYSTEM_ALERT_WINDOW overlay approach, this requires NO runtime
  // permission — just the manifest declaration supportsPictureInPicture.
  //
  // PipModule.setPipReady() must have been called from JS (with active=true
  // + non-empty ads) BEFORE onUserLeaveHint fires, otherwise Home behaves
  // normally (full background).

  /**
   * Called when the user presses Home (or triggers an activity-leave gesture).
   * If [PipModule.pipReady] is true, we enter PiP mode so the activity
   * continues running in a system-managed floating window.
   */
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && PipModule.pipReady) {
      try {
        val params = PictureInPictureParams.Builder().build()
        enterPictureInPictureMode(params)
      } catch (e: Exception) {
        // OEMs may reject PiP under certain conditions (e.g. device policy,
        // low-RAM devices). Silently fall back to normal backgrounding.
        e.printStackTrace()
      }
    }
  }

  /**
   * Called by the system whenever PiP mode changes. We forward the state to
   * React Native so the JS layer can show/hide the main UI — the PiP window
   * should only display ad content, not the full app chrome.
   */
  override fun onPictureInPictureModeChanged(
    isInPictureInPictureMode: Boolean,
    newConfig: Configuration,
  ) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    PipModule.instance?.emitPipModeChanged(isInPictureInPictureMode)
  }
}
