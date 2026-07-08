import { useCallback, useEffect, useRef, useState } from "react";
import {
  getIntervalsForTier,
  resolvePollingTier,
  type PollingTier,
  type TierIntervals,
  type WindowVisibilityState,
} from "../utils/pollingController";

const DEFAULT_VISIBILITY: WindowVisibilityState = {
  focused: document.hasFocus(),
  minimized: false,
  visible: true,
};

export function usePollingController(): { tier: PollingTier; intervals: TierIntervals } {
  const [visibility, setVisibility] = useState<WindowVisibilityState>(DEFAULT_VISIBILITY);

  const updateVisibility = useCallback((partial: Partial<WindowVisibilityState>) => {
    setVisibility((prev) => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    const onFocus = () => updateVisibility({ focused: true });
    const onBlur = () => updateVisibility({ focused: false });
    const onVisibilityChange = () => {
      updateVisibility({ visible: !document.hidden });
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const cleanupIpc = window.orc?.onWindowVisibility?.((state) => {
      updateVisibility(state);
    });

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cleanupIpc?.();
    };
  }, [updateVisibility]);

  const tier = resolvePollingTier(visibility);
  const intervals = getIntervalsForTier(tier);

  return { tier, intervals };
}

/**
 * Runs callback on an adaptive interval that updates when the polling tier changes.
 * Pass intervalMs=0 to pause polling.
 */
export function useAdaptiveInterval(callback: () => void, intervalMs: number, enabled = true): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) {
      return;
    }

    callbackRef.current();
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}
