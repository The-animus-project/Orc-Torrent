import React, { useEffect, useRef, useState } from "react";
import "../ui/themes/animus-boot.css";

const BOOT_STAGES = [
  { at: 0.08, text: "INITIALIZING DAEMON..." },
  { at: 0.28, text: "LOADING SWARM MAPS..." },
  { at: 0.52, text: "CONNECTING TO THE SWARM..." },
  { at: 0.76, text: "LOCKING PROTECTION..." },
  { at: 1.0, text: "READY." },
] as const;

const DEFAULT_LOGO = "./images/animus/loading-logo.png";
const DEFAULT_BACKGROUND = "./images/animus/loading-screen.png";
const DEFAULT_EMBLEM = "./images/animus/splash-emblem.svg";

function curve(x: number): number {
  if (x < 0.6) return (x / 0.6) * 0.78;
  return 0.78 + ((x - 0.6) / 0.4) * 0.22;
}

function AnimusEmblemSvg() {
  return (
    <svg viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M24 2L46 52H2L24 2Z" stroke="#9dff00" strokeWidth="2.2" strokeLinejoin="round" />
      <path
        d="M24 14c-4.8 0-8.6 3.2-9.8 7.6 2.4 1.2 5.2 1.9 8.2 1.9s5.8-.7 8.2-1.9C32.6 17.2 28.8 14 24 14Z"
        fill="#9dff00"
      />
      <path d="M16.5 34.5c2.2 3.4 5.8 5.6 9.8 5.6h-4.8c-3.2 0-6-1.6-7.8-4.1l2.8-1.5Z" fill="#9dff00" />
      <path d="M31.5 34.5c-2.2 3.4-5.8 5.6-9.8 5.6h4.8c3.2 0 6-1.6 7.8-4.1l-2.8-1.5Z" fill="#9dff00" />
    </svg>
  );
}

export interface AnimusBootScreenProps {
  durationMs?: number;
  completionGate?: boolean;
  splashLogoUrl?: string;
  splashBackgroundUrl?: string;
  splashEmblemUrl?: string;
}

export function AnimusBootScreen({
  durationMs = 4000,
  completionGate = false,
  splashLogoUrl = DEFAULT_LOGO,
  splashBackgroundUrl = DEFAULT_BACKGROUND,
  splashEmblemUrl = DEFAULT_EMBLEM,
}: AnimusBootScreenProps) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>(BOOT_STAGES[0].text);
  const progressRef = useRef(0);
  const stageIdxRef = useRef(0);
  const startedAtRef = useRef(0);
  const rafRef = useRef(0);
  const completionGateRef = useRef(completionGate);
  const gateOpenedAtRef = useRef<number | null>(null);

  useEffect(() => {
    completionGateRef.current = completionGate;
    if (completionGate && gateOpenedAtRef.current == null) {
      gateOpenedAtRef.current = performance.now();
    }
  }, [completionGate]);

  useEffect(() => {
    const startDelay = window.setTimeout(() => {
      startedAtRef.current = performance.now();
      progressRef.current = 1;
      setProgress(1);

      const tick = (now: number) => {
        const elapsed = now - startedAtRef.current;
        const gateOpen = completionGateRef.current;
        const completionElapsed = gateOpen && gateOpenedAtRef.current != null ? now - gateOpenedAtRef.current : 0;
        const t = gateOpen
          ? Math.max(0.92, Math.min(1, 0.92 + completionElapsed / 650))
          : Math.max(0, Math.min(0.92, elapsed / durationMs));
        const target = curve(t) * 100;
        const delta = target - progressRef.current;

        if (Math.abs(delta) > 0.05) {
          progressRef.current += delta * (gateOpen ? 0.2 : 0.12);
        } else {
          progressRef.current = target;
        }

        setProgress(progressRef.current);

        const stageT = gateOpen ? 1 : t / 0.92;
        while (stageIdxRef.current < BOOT_STAGES.length - 1 && stageT >= BOOT_STAGES[stageIdxRef.current + 1].at) {
          stageIdxRef.current += 1;
        }
        setStatus(BOOT_STAGES[stageIdxRef.current].text);

        if (!gateOpen || progressRef.current < 99.5) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          progressRef.current = 100;
          setProgress(100);
          setStatus(BOOT_STAGES[BOOT_STAGES.length - 1].text);
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    }, 650);

    return () => {
      window.clearTimeout(startDelay);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [durationMs]);

  const grungeStyle = {
    "--boot-grunge-image": splashBackgroundUrl ? `url("${splashBackgroundUrl}")` : "none",
  } as React.CSSProperties;

  return (
    <div
      className="animus-boot-screen boot-screen"
      style={grungeStyle}
      role="status"
      aria-live="polite"
      aria-label="ORC Torrent AnimUS Edition loading"
    >
      <div className="animus-boot-bg">
        <div className="animus-boot-drips" aria-hidden="true">
          <span className="animus-boot-drip animus-boot-drip-1" />
          <span className="animus-boot-drip animus-boot-drip-2" />
          <span className="animus-boot-drip animus-boot-drip-3 is-muted" />
          <span className="animus-boot-drip animus-boot-drip-4" />
          <span className="animus-boot-drip animus-boot-drip-5" />
          <span className="animus-boot-drip animus-boot-drip-6" />
          <span className="animus-boot-drip animus-boot-drip-7 is-muted" />
          <span className="animus-boot-drip animus-boot-drip-8" />
          <span className="animus-boot-drip animus-boot-drip-9" />
          <span className="animus-boot-drip animus-boot-drip-10" />
          <span className="animus-boot-splat animus-boot-splat-1" />
          <span className="animus-boot-splat animus-boot-splat-2" />
          <span className="animus-boot-splat animus-boot-splat-3 is-muted" />
          <span className="animus-boot-splat animus-boot-splat-4" />
          <span className="animus-boot-splat animus-boot-splat-5" />
          <span className="animus-boot-splat animus-boot-splat-6" />
          <span className="animus-boot-splat animus-boot-splat-7 is-muted" />
          <span className="animus-boot-splat animus-boot-splat-8" />
          <span className="animus-boot-burst animus-boot-burst-1" />
          <span className="animus-boot-burst animus-boot-burst-2" />
          <span className="animus-boot-burst animus-boot-burst-3" />
          <span className="animus-boot-burst animus-boot-burst-4 is-muted" />
        </div>
      </div>

      <div className="animus-boot-wrap">
        <div className="animus-boot-brand">
          <div className="animus-boot-brand-splats" aria-hidden="true">
            <span className="animus-boot-brand-splat animus-boot-brand-splat-1" />
            <span className="animus-boot-brand-splat animus-boot-brand-splat-2 is-muted" />
            <span className="animus-boot-brand-splat animus-boot-brand-splat-3" />
            <span className="animus-boot-brand-burst animus-boot-brand-burst-1" />
            <span className="animus-boot-brand-burst animus-boot-brand-burst-2" />
          </div>
          <img className="animus-boot-logo" src={splashLogoUrl} alt="ORC Torrent AnimUS Edition" />
        </div>

        <div className="animus-boot-loader-zone">
          <div className="animus-boot-bar" aria-label="Loading progress">
            <div className="animus-boot-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="animus-boot-status">{status}</div>
          <div className="animus-boot-website">ORCLABS.IO</div>
          <div className="animus-boot-emblem" aria-hidden="true">
            {splashEmblemUrl ? <img src={splashEmblemUrl} alt="" /> : <AnimusEmblemSvg />}
          </div>
        </div>
      </div>
    </div>
  );
}
