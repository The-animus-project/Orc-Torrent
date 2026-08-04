# ORC Torrent v2.5.1

Emergency bugfix: daemon startup no longer fails on legacy search provider configs — with signed builds for Android, Windows, macOS, and Linux.

## Downloads

- **Android 10+ (64-bit ARM):** `ORC-TORRENT-2.5.1-android-arm64-v8a.apk`
- **Windows x64:** `ORC-TORRENT-Setup-2.5.1.exe` or portable `ORC-TORRENT-2.5.1-win-x64.zip`
- **macOS Apple Silicon:** ARM64 DMG/PKG or portable ZIP
- **macOS Intel:** x64 DMG/PKG or portable ZIP
- **Linux x64:** AppImage or Debian package
- **Source:** signed `.tar.gz` and `.zip` archives are included; GitHub also generates source archives from the exact release tag.

## Signature verification

The Android APK is app-signed locally with the ORC release certificate (the keystore is not stored in CI). Every uploaded asset also has a matching armored detached PGP signature, and `SHA256SUMS` is PGP-signed.

ORC release-key fingerprint:

```text
094F 3796 D3B6 99DB 5E69 A278 6D0D 5CE9 E0DA 5A92
```

Import [`ORC-Torrent-Release-Key.asc`](https://github.com/The-animus-project/Orc-Torrent/blob/v2.5.1/ORC-Torrent-Release-Key.asc), then verify:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

PGP signatures establish file integrity and publisher identity; they are separate from Windows Authenticode and Apple Developer ID signing, so those operating systems may still show an unverified-developer warning.

## Highlights

- **Emergency fix:** migrate removed built-in search providers before config validation so older desktop `config.json` files (for example `yts` without `feed_url`) no longer prevent the daemon from becoming healthy.
- All other v2.5.0 engine, privacy, and API behavior is unchanged.

**Full changelog:** https://github.com/The-animus-project/Orc-Torrent/blob/v2.5.1/CHANGELOG.md

### Credit

- **Vurzumm**
