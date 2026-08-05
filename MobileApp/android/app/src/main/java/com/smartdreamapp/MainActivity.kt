package com.smartdreamapp

import android.app.PictureInPictureParams
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.WindowManager
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
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
    // Enter PiP when either:
    // 1. Ads are currently displayed (the normal case), OR
    // 2. Auto-like is active (even if all 3 display slots are momentarily
    //    empty between batches — without this the PiP window would close
    //    during the gap and the user would have to re-open the app).
    val shouldEnterPiP = PipModule.isPiPEnabled || PipModule.isAutoLikeActive
    if (shouldEnterPiP && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
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

  private fun resumeAllWebViews(view: View) {
    if (view is WebView) {
      try {
        view.onResume()
        view.resumeTimers()
      } catch (e: Exception) {
        e.printStackTrace()
      }
    } else if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        resumeAllWebViews(view.getChildAt(i))
      }
    }
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)

    if (isInPictureInPictureMode) {
      val handler = android.os.Handler(android.os.Looper.getMainLooper())
      try {
        resumeAllWebViews(window.decorView)
        handler.postDelayed({
          if (!isFinishing && !isDestroyed && isInPictureInPictureMode) {
            resumeAllWebViews(window.decorView)
          }
        }, 500)
        handler.postDelayed({
          if (!isFinishing && !isDestroyed && isInPictureInPictureMode) {
            resumeAllWebViews(window.decorView)
          }
        }, 1500)
        handler.postDelayed({
          if (!isFinishing && !isDestroyed && isInPictureInPictureMode) {
            resumeAllWebViews(window.decorView)
          }
        }, 3000)
      } catch (e: Exception) {
        e.printStackTrace()
      }
    }

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
