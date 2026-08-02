# ORC Torrent for Android

The Android app lives in `ui/android` and uses the shared React renderer from `ui/desktop`. Capacitor exposes Android lifecycle, Storage Access Framework, intent, file open/share, connectivity, and transfer-scheduling services. `crates/orc-android` loads the Rust daemon as a JNI `cdylib` and serves the existing API on a random authenticated loopback port.

For installing the published APK on a phone or tablet, see the [Android installation guide](../Install-Instructions/Android.md).

## Requirements

- Android Studio or command-line SDK 36
- NDK `28.2.13676358`
- Java 21
- Node.js 20+
- Rust stable, `cargo-ndk`, and the `aarch64-linux-android` and `x86_64-linux-android` targets

## Local build

```sh
rustup target add aarch64-linux-android x86_64-linux-android
cargo install cargo-ndk --locked
npm ci --prefix ui/desktop
npm ci --prefix ui/android
npm run sync:web --prefix ui/android
cd ui/android/android
./gradlew assembleDebug
```

`buildRustAndroid` builds both 64-bit Rust libraries before the Android build. Set `ORC_SKIP_RUST_ANDROID=1` only when checking Kotlin against libraries already present under `app/src/main/jniLibs`.

## Storage and networking

The first-run system folder picker persists read/write permission to one user-selected tree. ORC validates that the provider is writable and seekable, rejects unsafe relative paths, and uses positional I/O through duplicated file descriptors. No broad storage permission is requested.

Android 14+ schedules active work as a user-initiated data-transfer job. Android 10–13 use a `dataSync` foreground service. Both default to unmetered networking and share the same authenticated native API. VPN state comes from `ConnectivityManager`; when the opt-in kill switch loses its VPN network, Android prevents fallback to a clear network and pauses actual rqbit transfers. After reconnection, ORC binds to the new VPN and recreates transfer sockets only when the user resumes manually.

## Release secrets

The release workflow expects `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `RELEASE_GPG_PRIVATE_KEY`, and `RELEASE_GPG_PASSPHRASE`. It publishes the arm64 APK, a detached PGP signature for every release asset, and a PGP-signed SHA-256 manifest. The x86_64 split is built for emulator verification but is not published as the production APK.
