// EMA-based ETA calculation hook for stable time estimates
// Uses Exponential Moving Average to smooth out rate fluctuations

import { useRef, useMemo } from "react";

const MIN_RATE_BPS = 100;
const EMA_ALPHA = 0.3;

export function useEmaEta(
  downloadedBytes: number,
  totalBytes: number,
  currentRateBps: number,
  state: string,
  _updateIntervalMs: number = 1000
): number | null {
  const emaRef = useRef<number>(0);

  // Derive ETA synchronously from props — no intervals or extra effects needed.
  // The parent already re-renders this cell every 2s via the polling cycle.
  return useMemo(() => {
    if (state !== "downloading" || currentRateBps <= 0) {
      emaRef.current = 0;
      return null;
    }

    if (emaRef.current === 0) {
      emaRef.current = currentRateBps;
    } else {
      emaRef.current = EMA_ALPHA * currentRateBps + (1 - EMA_ALPHA) * emaRef.current;
    }

    if (totalBytes === 0 || downloadedBytes >= totalBytes) return null;
    if (emaRef.current < MIN_RATE_BPS) return null;

    const eta = Math.ceil((totalBytes - downloadedBytes) / emaRef.current);
    return eta > 0 ? eta : null;
  }, [downloadedBytes, totalBytes, currentRateBps, state]);
}
