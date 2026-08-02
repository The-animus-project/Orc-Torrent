import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.orc.torrent",
  appName: "ORC TORRENT",
  webDir: "../desktop/dist/android",
  server: {
    androidScheme: "https",
    hostname: "localhost",
  },
  android: {
    allowMixedContent: true,
    minWebViewVersion: 83,
  },
};

export default config;
