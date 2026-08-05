# React Native standard ProGuard keep rules
# https://reactnative.dev/docs/signed-apk-android#enabling-proguard

# Keep React Native bridge and native modules
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Keep native module methods annotated with @ReactMethod
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}

# Hermes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.hermes.**

# react-native-webview
-keep class com.reactnativecommunity.webview.** { *; }
-dontwarn com.reactnativecommunity.webview.**

# Keep application classes
-keep class com.smartdreamapp.MainActivity { *; }
-keep class com.smartdreamapp.MainApplication { *; }
