# Bundled notification sounds

MP3 files in this folder are copied into the app build (`dist/renderer/notification-sounds`) and listed in Settings.

The canonical manifest (filenames, labels, and sort order) lives in:

`ui/desktop/src/shared/notificationSoundRegistry.ts`

When adding or renaming a bundled sound, update that registry and place the matching `.mp3` file here.
