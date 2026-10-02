# Mizan companion for Android

A small native wrapper around the phone companion page
([../companion/index.html](../companion/index.html)). The desktop serves the same page in a phone browser. The app adds:

- **True full screen:** the **Full** button hides the status and navigation bars.
  Swipe from an edge to see them briefly. Tap the timer three times to leave.
- **Screen stays on** while a focus session runs.
- **QR pairing in the app:** Play services provides the scanner, so no camera permission is needed.
- **Works offline:** the page loads from the app itself, and your tasks are stored on the phone.
  Changes sync the next time the phone and the desktop are on the same network.

## Get the APK

The quickest way, from the repository root:

```sh
pnpm android             # → releases/Mizan-companion.apk
pnpm android --install   # also installs it on a phone with USB debugging
```

Then follow the pairing steps in the [main README](../README.md#phone-app-android).

## Build by hand

You need JDK 17 and the Android SDK (platform 35 and build-tools 35). Android Studio
installs both. With only the command-line tools:

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
cd android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

Install on a phone with USB debugging enabled:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to the phone and open it. You need to allow installs from that app.

No local SDK? Run the **Android companion APK** workflow on GitHub (Actions tab →
*Run workflow*) and download `mizan-companion-apk` from the run's artifacts.

The build copies `companion/index.html` into the app's assets each time. Rebuild
after changing the page. The release build type uses the debug signing key to
make sideloading simple. Set up your own keystore before sharing the APK with anyone else.

## Pairing

1. On the desktop, open **Settings → Phone companion** and click **Turn on**.
2. In the app, open **Pair** and tap **Scan QR code**. You can also paste the link
   shown under **Show pairing link**, or share the link to the app from any other app.
3. Pairing works on any shared link: the same Wi-Fi, the phone's hotspot, or USB
   tethering. If they cannot connect, check the desktop firewall. The Settings panel
   shows a `ufw` example.

## No Wi-Fi

You only pair once. The app keeps the desktop's ID and addresses, and when the
desktop stops answering it searches again: known addresses, then the USB link
(`127.0.0.1`), then every address on the phone's own Wi-Fi, hotspot and tethering
networks. **Find desktop again** on the Pair screen starts a search right away.

- **Hotspot:** connect the computer to the phone's hotspot.
- **USB tethering:** plug in and turn on USB tethering on the phone.
- **Cable only:** turn on USB debugging and click **Link phone over USB debugging**
  in the desktop's Settings (this uses `adb reverse`).

Only the bundled page can load inside the app's WebView, and only that page can use
the native bridge (`MizanAndroid`). Any other link opens in your normal browser.
