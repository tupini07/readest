---
name: android-emulator-testing
description: Guide for building the Android debug APK, installing it on the emulator, and checking logs. Use this when asked to test, run, or debug the app on Android.
---

# Android Emulator Testing

## Environment Setup

Android SDK and Java 17 are managed by mise (see `mise.toml` in repo root). Always set up the environment first:

```bash
eval "$(mise env)"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

## Check for Running Emulator

```bash
adb devices
```

If no emulator is running, start one. List available AVDs first, then launch:

```bash
$ANDROID_HOME/emulator/emulator -list-avds
$ANDROID_HOME/emulator/emulator -avd <avd_name> &
```

Wait ~30 seconds for it to boot, then verify with `adb devices`.

## Build the Debug APK

From the repo root:

```bash
task build-android-debug
```

The APK is output to:
`apps/readest-app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

## Install and Launch

```bash
adb install -r apps/readest-app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n "com.bilingify.readest/.MainActivity"
```

**Important:** The package name is `com.bilingify.readest`, NOT `com.readest.app`.

## Check Logs

View recent webview console output and errors:

```bash
adb logcat -d -t 200 | grep -iE "(Tauri/Console|readeck|readest)" | tail -30
```

Clear logs before a test run to get clean output:

```bash
adb logcat -c
```

Then reproduce the issue, and read:

```bash
adb logcat -d | grep "Tauri/Console" | tail -30
```

## Uninstall (if needed)

```bash
adb uninstall com.bilingify.readest
```

## Taskfile Shortcut

Build, install, and launch in one go:

```bash
task build-android-debug && task emulator
```

Or just install+launch (if APK already built):

```bash
task emulator
```
