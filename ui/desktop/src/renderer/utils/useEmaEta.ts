// EMA-based ETA calculation hook for stable time estimates
// Uses Exponential Moving Average to smooth out rate fluctuations

import { useRef, useEffect, useState } from "react";

const MIN_RATE_BPS = 100; // 100 B/s minimum to show ETA (lowered to show ETA more often)
const EMA_ALPHA = 0.3; // Smoothing factor (0-1, higher = more responsive)

export function useEmaEta(
  downloadedBytes: number,
  totalBytes: number,
  currentRateBps: number,
  state: string,
  updateIntervalMs: number = 1000
): number | null {
  const [smoothedRate, setSmoothedRate] = useState<number>(0);
  const lastRateRef = useRef<number>(0);
  const lastEtaRef = useRef<number | null>(null);

  // Update smoothed rate using EMA
  useEffect(() => {
    if (state !== "downloading" || currentRateBps <= 0) {
      setSmoothedRate(0);
      lastRateRef.current = 0;
      return;
    }

    // Initialize or update EMA
    if (lastRateRef.current === 0) {
      lastRateRef.current = currentRateBps;
      setSmoothedRate(currentRateBps);
    } else {
      // EMA formula: new_value = alpha * current + (1 - alpha) * previous
      const newRate = EMA_ALPHA * currentRateBps + (1 - EMA_ALPHA) * lastRateRef.current;
      lastRateRef.current = newRate;
      setSmoothedRate(newRate);
    }
  }, [currentRateBps, state]);

  // Calculate ETA from smoothed rate
  useEffect(() => {
    if (state !== "downloading") {
      lastEtaRef.current = null;
      return;
    }

    if (totalBytes === 0 || downloadedBytes >= totalBytes) {
      lastEtaRef.current = null;
      return;
    }

    const remainingBytes = totalBytes - downloadedBytes;
    
    // If rate is too low, return null (will display as ∞)
    if (smoothedRate < MIN_RATE_BPS) {
      lastEtaRef.current = null;
      return;
    }

    const etaSeconds = Math.ceil(remainingBytes / smoothedRate);
    lastEtaRef.current = etaSeconds > 0 ? etaSeconds : null;
  }, [downloadedBytes, totalBytes, smoothedRate, state]);

  // Return cached ETA, update periodically for stability
  const [eta, setEta] = useState<number | null>(null);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setEta(lastEtaRef.current);
    }, updateIntervalMs);

    // Initial update
    setEta(lastEtaRef.current);

    return () => clearInterval(interval);
  }, [updateIntervalMs]);

  return eta;
}
