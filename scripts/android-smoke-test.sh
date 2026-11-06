#!/bin/sh
# Emulator smoke test for the shipped Android app.
#
# Run by `e2e.yml` inside `reactivecircus/android-emulator-runner` once the AVD has
# booted. It is a separate file rather than an inline `script:` because the action
# feeds the script to `/usr/bin/sh` one line at a time: functions, `set` flags and
# variables do not survive from one line to the next, so a multi-line inline script
# fails with "Syntax error: end of file unexpected".
#
# What it proves that `assembleDebug` cannot: the APK installs on a device, the
# launcher activity starts, and the app is still running and on screen seconds
# later. A crash on startup otherwise only shows up in a user's crash report.
set -eu

PACKAGE=com.aistudio.vukko.kzmp
ACTIVITY="$PACKAGE/com.vukko.MainActivity"
APK=app/build/outputs/apk/debug/app-debug.apk

diagnostics() {
  echo "--- logcat (last 300 lines) ---"
  adb logcat -d -v brief | tail -n 300 || true
  # Picked up by the "Keep the emulator screenshot of a failure" step.
  adb exec-out screencap -p > emulator-failure.png || true
}

fail() {
  echo "::error::$1"
  diagnostics
  exit 1
}

adb wait-for-device
adb install -r "$APK" || fail "the debug APK did not install"

adb logcat -c
launch=$(adb shell am start -W -n "$ACTIVITY") || fail "the launcher activity did not start"
echo "$launch"
echo "$launch" | grep -q 'Status: ok' ||
  fail "the launcher activity did not report a successful start"

# A launch that dies immediately still reports `Status: ok`, so the process has to
# be alive afterwards — and the resumed activity has to be ours, because a
# crash-and-restart loop can leave a process behind with nothing on screen.
sleep 5
pid=$(adb shell pidof "$PACKAGE" | tr -d '\r' || true)
[ -n "$pid" ] || fail "the app process exited after launching"
echo "the app is running as pid $pid"

adb shell dumpsys activity activities | grep -E "ResumedActivity.*$PACKAGE" ||
  fail "no Vukko activity is resumed after launching"

echo "smoke test passed: $PACKAGE installed, launched and resumed"
