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

  private val pipHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private var pipResumeRunnable: Runnable? = null
  // Android (or the device's battery optimizer) can re-pause WebView JS
  // timers at any point during a long PiP session, not just once right after
  // entry -- a single burst of resume calls right after onPictureInPictureModeChanged
  // fires only covers the first few seconds. Auto-like's loop, the ad-view
  // commit timers, and the native visual timer's web-side counterpart all
  // live in that JS, so a re-pause without a matching resume silently stops
  // everything until the user manually reopens the app. Keep re-resuming on
  // an interval for as long as we're actually still in PiP.
  private val PIP_RESUME_INTERVAL_MS = 3000L

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

  private fun startPipResumeLoop() {
    stopPipResumeLoop()
    val runnable = object : Runnable {
      override fun run() {
        if (isFinishing || isDestroyed || !isInPictureInPictureMode) return
        resumeAllWebViews(window.decorView)
        pipHandler.postDelayed(this, PIP_RESUME_INTERVAL_MS)
      }
    }
    pipResumeRunnable = runnable
    pipHandler.post(runnable)
  }

  private fun stopPipResumeLoop() {
    pipResumeRunnable?.let { pipHandler.removeCallbacks(it) }
    pipResumeRunnable = null
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)

    if (isInPictureInPictureMode) {
      startPipResumeLoop()
    } else {
      stopPipResumeLoop()
    }

    val reactApplication = application as? ReactApplication
    val reactContext = reactApplication?.reactHost?.currentReactContext
    if (reactContext != null) {
      PipModule.sendPiPModeChangedEvent(reactContext as com.facebook.react.bridge.ReactApplicationContext, isInPictureInPictureMode)
    }
  }

  override fun onDestroy() {
    stopPipResumeLoop()
    super.onDestroy()
  }

  override fun getMainComponentName(): String = "SmartDreamApp"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
