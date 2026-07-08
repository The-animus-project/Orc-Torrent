import { useCallback, useState } from "react";
import type { Health, Version } from "../types";
import { getJson } from "../utils/api";

export function useDaemonHealth() {
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [version, setVersion] = useState<string>("—");

  const ping = useCallback(async () => {
    try {
      const h = await getJson<Health>("/health");
      setOnline(Boolean(h?.ok));
      setHealth(h);
      const v = await getJson<Version>("/version");
      setVersion(v?.version ?? "—");
      return true;
    } catch {
      setOnline(false);
      setHealth(null);
      setVersion("—");
      return false;
    }
  }, []);

  return {
    online,
    health,
    version,
    ping,
  };
}
