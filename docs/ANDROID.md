# ORC Torrent for Android

The Android app lives in `ui/android` and uses the shared React renderer from `ui/desktop`. Capacitor exposes Android lifecycle, Storage Access Framework, intent, file open/share, connectivity, and transfer-scheduling services. `crates/orc-android` loads the Rust daemon as a JNI `cdylib` and serves the existing API on a random authenticated loopback port.

For installing the published APK on a phone or tablet, see the [Android installation guide](../Install-Instructions/Android.md).

## Requirements

- Android Studio or command-line SDK 36
- NDK `28.2.13676358`
- Java 21
- Node.js 22+
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

Android 14+ schedules active work as a user-initiated data-transfer job. Android 10–13 use a `dataSync` foreground service. Both default to unmetered networking and share the same authenticated native API. VPN state comes from `ConnectivityManager`; the opt-in VPN transfer-pause control closes ORC networking and pauses transfers after VPN loss. It is not presented as an OS-wide firewall. After reconnection, ORC binds to the new VPN and recreates transfer sockets only when the user resumes manually.

## Local release APK (signed)

Production Android APKs are **signed on a trusted local machine**. The keystore and passwords are never stored in the repository or in GitHub Actions secrets.

```sh
rustup target add aarch64-linux-android
cargo install cargo-ndk --locked
npm ci --prefix ui/desktop
npm ci --prefix ui/android
npm run sync:web --prefix ui/android

export ORC_ANDROID_KEYSTORE_PATH=/absolute/path/to/orc-release.jks
export ORC_ANDROID_KEYSTORE_PASSWORD='…'
export ORC_ANDROID_KEY_ALIAS='…'
export ORC_ANDROID_KEY_PASSWORD='…'
export ORC_ANDROID_RUST_TARGETS=arm64-v8a

cd ui/android/android
./gradlew --no-daemon assembleRelease
```

The signed APK is written to `app/build/outputs/apk/release/ORC-TORRENT-<version>-android-arm64-v8a.apk`.

After CI publishes the desktop release for tag `vX.Y.Z`, attach the APK (and its PGP signature) to that release:

```sh
VERSION=2.5.0
APK="ui/android/android/app/build/outputs/apk/release/ORC-TORRENT-${VERSION}-android-arm64-v8a.apk"
gpg --armor --detach-sign "$APK"
gh release upload "v${VERSION}" "$APK" "${APK}.asc"
```

Optionally refresh `SHA256SUMS` / `SHA256SUMS.asc` on the release so the manifest includes the APK. The x86_64 split is for emulator verification only and is not published.

## CI

The release workflow compiles an **unsigned** Android release APK and runs API 29/33/34/36 emulator tests as a gate. It does not receive the Android keystore. Desktop packages are PGP-signed in CI with `RELEASE_GPG_PRIVATE_KEY` and `RELEASE_GPG_PASSPHRASE`.
