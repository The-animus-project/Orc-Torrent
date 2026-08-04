# Install ORC Torrent on Android

ORC Torrent is available as a signed APK for 64-bit ARM phones and tablets running Android 10 or newer. The Android build is distributed through the project's official GitHub Releases page; it is not currently available from Google Play.

## 1. Download the APK

1. On the Android device, open the [latest ORC Torrent release](https://github.com/The-animus-project/Orc-Torrent/releases/latest).
2. Under **Assets**, download `ORC-TORRENT-<version>-android-arm64-v8a.apk`.
3. Download `SHA256SUMS`, `SHA256SUMS.asc`, and the APK's matching `.asc` file if you want to verify the release before installation.

Only install an APK downloaded from the official `The-animus-project/Orc-Torrent` repository. The production build supports `arm64-v8a`; Android emulators and older 32-bit-only devices are not supported by the published APK.

## 2. Verify the download (recommended)

The APK is signed locally with the Android release keystore (not in CI). The release also includes a detached PGP signature for the APK and a PGP-signed SHA-256 manifest.

On a computer with GnuPG, download [`ORC-Torrent-Release-Key.asc`](../ORC-Torrent-Release-Key.asc), import it, and confirm the fingerprint:

```sh
gpg --import ORC-Torrent-Release-Key.asc
gpg --fingerprint 6D0D5CE9E0DA5A92
```

The fingerprint must be:

```text
094F 3796 D3B6 99DB 5E69 A278 6D0D 5CE9 E0DA 5A92
```

Place the APK, its `.asc` file, `SHA256SUMS`, and `SHA256SUMS.asc` in the same directory, then run:

```sh
gpg --verify ORC-TORRENT-<version>-android-arm64-v8a.apk.asc ORC-TORRENT-<version>-android-arm64-v8a.apk
gpg --verify SHA256SUMS.asc SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

On Linux, `sha256sum -c SHA256SUMS` can be used instead of `shasum`. A valid PGP signature and an `OK` checksum confirm that the downloaded file matches the published release.

## 3. Allow installation from the download source

Android will ask for permission the first time an APK is installed outside Google Play.

1. Open the downloaded APK from the browser's Downloads screen or the Files app.
2. If Android blocks the install, tap **Settings** on the prompt.
3. Enable **Allow from this source** for the app that opened the APK, such as Chrome, Firefox, GitHub, or Files.
4. Return to the installer, tap **Install**, then open **ORC Torrent**.
5. For tighter security, turn **Allow from this source** off again after installation. The exact setting name and location can vary by device manufacturer.

## 4. Complete first-run setup

1. Tap **Choose download folder** during onboarding.
2. In Android's system folder picker, create or select a dedicated subfolder such as `Downloads/ORC`, then tap **Use this folder**.
3. Approve notifications when prompted so Android can show transfer progress and keep background work visible. On Android 12 and older, notification permission is granted automatically.
4. Choose whether to enable the VPN kill switch. It is opt-in and can be changed later under **Privacy**.

Android does not allow some broad roots, including the top-level Downloads directory, to be selected. Choose or create an ORC subfolder instead. ORC requests access only to that selected folder and does not request broad storage permission.

## Using the Android build

- Add a magnet link from ORC's Add sheet, or open a magnet link in another app and choose ORC Torrent.
- Import a `.torrent` file through the Add sheet, Android's Share/Open With menu, or a file manager.
- Transfers use unmetered Wi-Fi by default. Enable cellular data explicitly in **Settings → Transfer policy** if required.
- Android shows one persistent transfer notification with aggregate progress and actions to pause all transfers or reopen ORC.
- Completed files can be opened or shared from the torrent details screen.
- With the kill switch enabled, VPN loss pauses transfers immediately. Reconnect the VPN, return to ORC, and resume manually.

## Updating ORC Torrent

Download the newer APK from the official release and install it over the existing app. Android verifies that the update uses the same signing key and preserves app settings and queue state. You do not need to uninstall the previous version.

Downloaded files are stored in the shared folder you selected and remain there after an uninstall. Android removes ORC's private settings and queue database when the app is uninstalled, so uninstall only when you are prepared to set the app up again.

## Troubleshooting

### “App not installed”

- Confirm the device runs Android 10 or newer and supports 64-bit ARM (`arm64-v8a`).
- Download the APK again and verify its checksum; partial browser downloads cannot be installed.
- Install the new version over the existing official build. An APK signed by a different key cannot replace it; uninstalling that other build removes its private settings.

### The folder cannot be selected or written

- Select a subfolder rather than the storage root or top-level Downloads directory.
- Reinsert an SD card before reopening ORC if that folder is on removable storage.
- If access was revoked, use ORC's storage recovery prompt to select the same folder again.
- Cloud-backed document providers that do not support reliable seekable access cannot be used for torrent storage.

### Transfers stop in the background

- Allow ORC notifications and do not force-stop the app.
- Check that the active network matches **Settings → Transfer policy**; cellular and metered networks are blocked by default.
- Some vendor battery savers may defer work. Exempt ORC from aggressive battery optimization if the device repeatedly interrupts an active transfer.
- If the VPN kill switch paused the queue, reconnect the VPN and resume the queue manually.

For build-from-source instructions, see the [Android developer guide](../docs/ANDROID.md).
