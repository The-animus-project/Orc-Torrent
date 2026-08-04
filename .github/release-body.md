# ORC Torrent v2.5.0

ORC Engine boundary, hardened localhost API isolation, opt-in MSE/PE peer-traffic obfuscation, BEP 6 Fast Extension, and adaptive request scheduling beta — with signed builds for Android, Windows, macOS, and Linux.

## Downloads

- **Android 10+ (64-bit ARM):** `ORC-TORRENT-2.5.0-android-arm64-v8a.apk`
- **Windows x64:** `ORC-TORRENT-Setup-2.5.0.exe` or portable `ORC-TORRENT-2.5.0-win-x64.zip`
- **macOS Apple Silicon:** ARM64 DMG/PKG or portable ZIP
- **macOS Intel:** x64 DMG/PKG or portable ZIP
- **Linux x64:** AppImage or Debian package
- **Source:** signed `.tar.gz` and `.zip` archives are included; GitHub also generates source archives from the exact release tag.

## Signature verification

The Android APK is app-signed with the ORC release certificate. Every uploaded asset also has a matching armored detached PGP signature, and `SHA256SUMS` is PGP-signed.

ORC release-key fingerprint:

```text
094F 3796 D3B6 99DB 5E69 A278 6D0D 5CE9 E0DA 5A92
```

Import [`ORC-Torrent-Release-Key.asc`](https://github.com/The-animus-project/Orc-Torrent/blob/v2.5.0/ORC-Torrent-Release-Key.asc), then verify:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

PGP signatures establish file integrity and publisher identity; they are separate from Windows Authenticode and Apple Developer ID signing, so those operating systems may still show an unverified-developer warning.

## Highlights

- ORC-owned `orc-engine` contract shared by desktop and Android, with a private backend derived from tagged rqbit `v9.0.0-beta.2`.
- Opt-in MSE/PE (RC4) peer-traffic obfuscation via `orc-mse`, with `off`, `prefer`, and `require` modes.
- Adaptive request scheduler beta (`orc-scheduler`) and bounded endgame recovery.
- BEP 6 Fast Extension support (`suggest piece`, `have all`/`none`, `reject request`, `allowed fast`).
- Hardened localhost API: required admin token, exact Origin allowlist, desktop token isolation, fail-closed configuration, and path confinement.
- Legacy v8.1.1 session and fast-resume compatibility preserved in place.

**Full changelog:** https://github.com/The-animus-project/Orc-Torrent/blob/v2.5.0/CHANGELOG.md

### Credit

- **Vurzumm**
