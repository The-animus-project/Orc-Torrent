import React, { memo, useRef, useEffect, useState, useCallback } from "react";
import type { TorrentRowSnapshot, PieceBin } from "../../types";
import { fetchRowSnapshot } from "../../utils/torrentFetcher";

interface TorrentRowSignalProps {
  torrentId: string;
  height?: number;
  piecesWidth?: number;
  heartbeatWidth?: number;
  onPiecesClick?: () => void;
  onHeartbeatClick?: () => void;
}

export const TorrentRowSignal = memo<TorrentRowSignalProps>(({
  torrentId,
  height = 16,
  piecesWidth = 200,
  heartbeatWidth = 120,
  onPiecesClick,
  onHeartbeatClick,
}) => {
  const [snapshot, setSnapshot] = useState<TorrentRowSnapshot | null>(null);
  const piecesCanvasRef = useRef<HTMLCanvasElement>(null);
  const heartbeatCanvasRef = useRef<HTMLCanvasElement>(null);
  const piecesIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBinsRef = useRef<PieceBin[] | null>(null);
  const prevSamplesRef = useRef<number[] | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const data = await fetchRowSnapshot(torrentId, { retries: 1, retryDelay: 200 });
      setSnapshot(data);
    } catch (error) {
      // Silently handle errors - component will show empty state
    }
  }, [torrentId]);

  // Fetch pieces data at 1-2Hz (every 500-1000ms)
  useEffect(() => {
    fetchSnapshot();
    piecesIntervalRef.current = setInterval(fetchSnapshot, 800); // ~1.25Hz
    
    return () => {
      if (piecesIntervalRef.current) {
        clearInterval(piecesIntervalRef.current);
      }
    };
  }, [fetchSnapshot]);

  // Fetch heartbeat data at 5-10Hz (every 100-200ms)
  useEffect(() => {
    const fetchHeartbeat = async () => {
      try {
        const data = await fetchRowSnapshot(torrentId, { retries: 0 });
        setSnapshot(prev => {
          // Only update heartbeat samples, keep pieces bins if they haven't changed
          if (prev && data.pieces_bins.length === prev.pieces_bins.length) {
            return {
              ...prev,
              heartbeat_samples: data.heartbeat_samples,
            };
          }
          return data;
        });
      } catch (error) {
        // Silently handle errors
      }
    };
    
    fetchHeartbeat();
    heartbeatIntervalRef.current = setInterval(fetchHeartbeat, 150); // ~6.7Hz
    
    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [torrentId]);

  // Render pieces strip
  useEffect(() => {
    const canvas = piecesCanvasRef.current;
    if (!canvas || !snapshot) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bins = snapshot.pieces_bins;
    if (bins.length === 0) {
      ctx.clearRect(0, 0, piecesWidth, height);
      return;
    }

    // Diff redraw: only redraw if bins changed
    const binsChanged = !prevBinsRef.current || 
      prevBinsRef.current.length !== bins.length ||
      prevBinsRef.current.some((bin, i) => 
        bins[i] && (bin.have_ratio !== bins[i].have_ratio || bin.min_avail !== bins[i].min_avail)
      );

    if (!binsChanged && prevBinsRef.current) {
      return; // Skip redraw if nothing changed
    }

    ctx.clearRect(0, 0, piecesWidth, height);
    
    const binWidth = piecesWidth / bins.length;
    
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      if (bin.pieces_in_bin === 0) continue;
      
      const x = i * binWidth;
      
      // Color coding
      let color: string;
      if (bin.have_ratio >= 1.0) {
        color = "#4ade80"; // Green - complete
      } else if (bin.min_avail === 0) {
        color = "#ef4444"; // Red - unavailable
      } else if (bin.min_avail <= 2) {
        color = "#fbbf24"; // Yellow - rare
      } else {
        color = "#3b82f6"; // Blue - available
      }
      
      ctx.fillStyle = color;
      ctx.fillRect(x, 0, binWidth, height);
    }
    
    prevBinsRef.current = bins;
  }, [snapshot, piecesWidth, height]);

  // Render heartbeat bar
  useEffect(() => {
    const canvas = heartbeatCanvasRef.current;
    if (!canvas || !snapshot) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) return;

    const samples = snapshot.heartbeat_samples;
    if (samples.length === 0) {
      ctx.clearRect(0, 0, heartbeatWidth, height);
      // Draw a subtle "no data" indicator
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.font = "10px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("—", heartbeatWidth / 2, height / 2);
      return;
    }

    // Check if samples changed
    const samplesChanged = !prevSamplesRef.current ||
      prevSamplesRef.current.length !== samples.length ||
      prevSamplesRef.current.some((s, i) => samples[i] !== s);

    if (!samplesChanged && prevSamplesRef.current) {
      return; // Skip redraw if nothing changed
    }

    ctx.clearRect(0, 0, heartbeatWidth, height);
    
    // Apply light smoothing (2-3 sample moving average) to reduce noise while preserving spikes
    const smoothed = samples.map((s, i) => {
      if (samples.length <= 2) return s; // No smoothing needed for very few samples
      if (i === 0) return (s + samples[1]) / 2; // First sample: average with next
      if (i === samples.length - 1) return (samples[i - 1] + s) / 2; // Last sample: average with previous
      // Middle samples: 3-sample average
      return (samples[i - 1] + s + samples[i + 1]) / 3;
    });
    
    // Auto-scale Y-axis
    const maxSample = Math.max(...smoothed, 1); // At least 1 to avoid division by zero
    const padding = maxSample * 0.1; // 10% padding
    const scale = maxSample + padding;
    
    // Color based on state
    let color: string;
    if (snapshot.state === "downloading") {
      color = "#3b82f6"; // Blue
    } else if (snapshot.state === "seeding") {
      color = "#8b5cf6"; // Purple
    } else {
      color = "rgba(255, 255, 255, 0.3)"; // Dim for stopped/idle
    }
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    // Use fixed sample count for consistent scaling (pad with zeros if needed)
    const FIXED_SAMPLE_COUNT = 120;
    const sampleWidth = heartbeatWidth / FIXED_SAMPLE_COUNT;
    
    for (let i = 0; i < FIXED_SAMPLE_COUNT; i++) {
      const x = i * sampleWidth;
      const sampleValue = i < smoothed.length ? smoothed[i] : 0;
      const normalized = sampleValue / scale;
      const y = height * (1 - normalized);
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();
    
    prevSamplesRef.current = samples;
  }, [snapshot, heartbeatWidth, height]);

  if (!snapshot) {
    return (
      <div style={{ display: "flex", gap: "8px", height: `${height}px`, alignItems: "center" }}>
        <div 
          style={{ 
            width: `${piecesWidth}px`, 
            height: `${height}px`, 
            background: "var(--bg-secondary)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Loading pieces data..."
        >
          <div style={{ 
            width: "4px", 
            height: "4px", 
            background: "var(--text-muted)",
            borderRadius: "50%",
            opacity: 0.5,
          }} />
        </div>
        <div 
          style={{ 
            width: `${heartbeatWidth}px`, 
            height: `${height}px`, 
            background: "var(--bg-secondary)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Loading activity data..."
        >
          <div style={{ 
            width: "4px", 
            height: "4px", 
            background: "var(--text-muted)",
            borderRadius: "50%",
            opacity: 0.5,
          }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", height: `${height}px` }}>
      <canvas
        ref={piecesCanvasRef}
        width={piecesWidth}
        height={height}
        onClick={onPiecesClick}
        style={{
          cursor: onPiecesClick ? "pointer" : "default",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
        }}
        title="Pieces availability (click to view details)"
      />
      <canvas
        ref={heartbeatCanvasRef}
        width={heartbeatWidth}
        height={height}
        onClick={onHeartbeatClick}
        style={{
          cursor: onHeartbeatClick ? "pointer" : "default",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--bg-secondary)",
        }}
        title="Throughput activity (click to view details)"
      />
    </div>
  );
});

TorrentRowSignal.displayName = "TorrentRowSignal";
