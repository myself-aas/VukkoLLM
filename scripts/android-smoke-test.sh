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

# How long a cold start on a software-rendered emulator may take before the leg
# gives up. The check below is about the app being alive, not about the clock.
START_TIMEOUT=30

diagnostics() {
  echo "--- fatal exceptions (logcat crash buffer) ---"
  adb logcat -d -b crash -v brief | tail -n 100 || true
  echo "--- logcat for $PACKAGE ---"
  adb logcat -d -v brief | grep -iE "vukko|AndroidRuntime|FATAL" | tail -n 150 || true
  echo "--- processes matching the package ---"
  adb shell ps -A | grep -i vukko || echo "(none)"
  echo "--- logcat (last 100 lines) ---"
  adb logcat -d -v brief | tail -n 100 || true
  # Picked up by the "Keep the emulator screenshot of a failure" step.
  adb exec-out screencap -p > emulator-failure.png || true
}

fail() {
  echo "::error::$1"
  diagnostics
  exit 1
}

package_pid() {
  adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true
}

adb wait-for-device
adb install -r "$APK" || fail "the debug APK did not install"

adb logcat -c
launch=$(adb shell am start -W -n "$ACTIVITY") || fail "the launcher activity did not start"
echo "$launch"
echo "$launch" | grep -q 'Status: ok' ||
  fail "the launcher activity did not report a successful start"

# A cold start on this emulator is slow, so wait for the process instead of
# assuming it is already there — but bound the wait, because a process that never
# appears is exactly the crash this test exists to catch.
waited=0
pid=$(package_pid)
while [ -z "$pid" ] && [ "$waited" -lt "$START_TIMEOUT" ]; do
  sleep 2
  waited=$((waited + 2))
  pid=$(package_pid)
done
if [ -z "$pid" ]; then
  fail "the app process never appeared after launching (waited ${START_TIMEOUT}s)"
fi
echo "the app is running as pid $pid"

# A launch that dies immediately still reports `Status: ok`, and a crash loop
# leaves a process behind with nothing on screen, so the app has to still be
# running, and resumed, a few seconds after it came up.
sleep 5
pid=$(package_pid)
[ -n "$pid" ] || fail "the app process exited after launching"
echo "the app is still running as pid $pid"

adb shell dumpsys activity activities | grep -E "ResumedActivity.*$PACKAGE" ||
  fail "no Vukko activity is resumed after launching"

echo "smoke test passed: $PACKAGE installed, launched and resumed"
