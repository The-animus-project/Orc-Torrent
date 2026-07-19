import React, { useEffect, useMemo, useState } from "react";
import type { EditionBranding } from "../../shared/appEdition";
import { AnimusBootScreen } from "./AnimusBootScreen";
import { Spinner } from "./Spinner";

type BootState =
  { phase: "booting" } | { phase: "ready" } | { phase: "daemon_down" } | { phase: "connectivity_restricted" };

const ANIMUS_BOOT_ASSETS = {
  splashLogoUrl: "./images/animus/loading-logo.png",
  splashBackgroundUrl: "./images/animus/loading-screen.png",
  splashEmblemUrl: "./images/animus/splash-emblem.svg",
} as const;

const BOOT_MIN_MS = 4000;
const DAEMON_POLL_MS = 350;
const DAEMON_BOOT_TIMEOUT_MS = 90_000;
const COMPLETION_ANIMATION_MS = 450;

async function pingDaemon(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
      const r = await fetch("http://127.0.0.1:8733/health", {
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return r.ok;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  } catch {
    return false;
  }
}

async function waitForDaemonReady(): Promise<boolean> {
  const deadline = Date.now() + DAEMON_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await pingDaemon()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, DAEMON_POLL_MS));
  }
  return false;
}

function isAnimusBootEdition(): boolean {
  return document.documentElement.dataset.appEdition === "animus";
}

interface BootGateProps {
  children: React.ReactNode;
}

/**
 * BootGate component - handles app boot sequence
 * AnimUS edition uses the graffiti splash loading screen during runtime boot.
 */
export function BootGate({ children }: BootGateProps) {
  const [state, setState] = useState<BootState>({ phase: "booting" });
  const [completionGate, setCompletionGate] = useState(false);
  const [isAnimusEdition, setIsAnimusEdition] = useState(isAnimusBootEdition);
  const [bootAssets, setBootAssets] = useState<{
    splashLogoUrl: string;
    splashBackgroundUrl: string;
    splashEmblemUrl: string;
  }>(ANIMUS_BOOT_ASSETS);

  useEffect(() => {
    if (typeof window.orc?.edition?.getBranding !== "function") {
      return;
    }

    void window.orc.edition.getBranding().then((branding: EditionBranding) => {
      const animus = branding.edition === "animus";
      setIsAnimusEdition(animus);
      if (animus) {
        document.documentElement.dataset.appEdition = "animus";
        document.body.dataset.appEdition = "animus";
        setBootAssets({
          splashLogoUrl: branding.splashLogoUrl || ANIMUS_BOOT_ASSETS.splashLogoUrl,
          splashBackgroundUrl: branding.splashBackgroundUrl || ANIMUS_BOOT_ASSETS.splashBackgroundUrl,
          splashEmblemUrl: branding.splashEmblemUrl || ANIMUS_BOOT_ASSETS.splashEmblemUrl,
        });
      }
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const bootStartedAt = Date.now();

    (async () => {
      const daemonOk = await waitForDaemonReady();
      if (!alive) return;

      const elapsed = Date.now() - bootStartedAt;
      const remainingMin = BOOT_MIN_MS - elapsed;
      if (remainingMin > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingMin));
      }
      if (!alive) return;

      if (!daemonOk) {
        setState({ phase: "daemon_down" });
        return;
      }

      setCompletionGate(true);
      await new Promise((resolve) => setTimeout(resolve, COMPLETION_ANIMATION_MS));
      if (!alive) return;

      setState({ phase: "ready" });
    })();

    return () => {
      alive = false;
    };
  }, []);

  const animusBootScreen = useMemo(
    () => (
      <AnimusBootScreen
        durationMs={BOOT_MIN_MS}
        completionGate={completionGate}
        splashLogoUrl={bootAssets.splashLogoUrl}
        splashBackgroundUrl={bootAssets.splashBackgroundUrl}
        splashEmblemUrl={bootAssets.splashEmblemUrl}
      />
    ),
    [bootAssets, completionGate]
  );

  if (state.phase === "booting") {
    if (isAnimusEdition) {
      return animusBootScreen;
    }

    return (
      <div
        className="boot-screen"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--bg, #000000)",
          color: "var(--text, #ffffff)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "600px",
            height: "600px",
            transform: "translate(-50%, -50%)",
            background:
              "radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 40%, transparent 70%)",
            animation: "startupBgPulse 4.5s ease-in-out infinite",
            pointerEvents: "none",
            filter: "blur(40px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "400px",
            height: "400px",
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 60%)",
            animation: "startupBgPulse 3.5s ease-in-out infinite 0.7s",
            pointerEvents: "none",
            filter: "blur(30px)",
          }}
        />

        <style>{`
          @keyframes startupBgPulse {
            0%, 100% { 
              opacity: 0.5; 
              transform: translate(-50%, -50%) scale(1) rotate(0deg); 
            }
            33% { 
              opacity: 0.9; 
              transform: translate(-50%, -50%) scale(1.2) rotate(120deg); 
            }
            66% { 
              opacity: 0.7; 
              transform: translate(-50%, -50%) scale(1.1) rotate(240deg); 
            }
          }
          @keyframes startupFadeIn {
            from { 
              opacity: 0; 
              transform: translateY(24px); 
              filter: blur(4px);
            }
            to { 
              opacity: 1; 
              transform: translateY(0); 
              filter: blur(0);
            }
          }
          @keyframes startupSpinnerEnter {
            from { 
              opacity: 0; 
              transform: scale(0.2) rotate(-25deg); 
              filter: blur(15px) brightness(0.5);
            }
            40% {
              opacity: 0.6;
              transform: scale(0.8) rotate(-5deg);
              filter: blur(5px) brightness(0.8);
            }
            70% { 
              transform: scale(1.12) rotate(3deg); 
              filter: blur(0) brightness(1.1);
            }
            85% {
              transform: scale(0.98) rotate(-1deg);
              filter: blur(0) brightness(1);
            }
            to { 
              opacity: 1; 
              transform: scale(1) rotate(0deg); 
              filter: blur(0) brightness(1);
            }
          }
        `}</style>

        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "28px",
            animation: "startupFadeIn 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          }}
        >
          <div
            style={{
              animation: "startupSpinnerEnter 3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s forwards",
              opacity: 0,
              filter:
                "drop-shadow(0 0 40px rgba(255, 255, 255, 0.3)) drop-shadow(0 0 80px rgba(255, 255, 255, 0.15)) drop-shadow(0 0 120px rgba(255, 255, 255, 0.08))",
            }}
          >
            <Spinner size={90} />
          </div>

          <div
            style={{
              fontSize: "48px",
              fontWeight: 900,
              letterSpacing: "10px",
              textTransform: "uppercase",
              color: "#fff",
              animation: "startupFadeIn 1.6s cubic-bezier(0.16, 1, 0.3, 1) 1.1s forwards",
              opacity: 0,
              textShadow: "0 2px 32px rgba(0,0,0,0.5), 0 0 30px rgba(255,255,255,0.1)",
            }}
          >
            ORC TORRENT
          </div>

          <div
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "rgba(255, 255, 255, 0.65)",
              letterSpacing: "5px",
              textTransform: "uppercase",
              animation: "startupFadeIn 1.4s cubic-bezier(0.16, 1, 0.3, 1) 1.6s forwards",
              opacity: 0,
              marginTop: "-4px",
            }}
          >
            Initializing runtime...
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === "daemon_down") {
    if (isAnimusEdition) {
      return (
        <div className="animus-boot-screen boot-screen" role="alert">
          <div className="animus-boot-bg" />
          <div className="animus-boot-wrap" style={{ justifyContent: "center", gap: 24 }}>
            <img
              className="animus-boot-logo"
              src={bootAssets.splashLogoUrl}
              alt="ORC Torrent AnimUS Edition"
              style={{ maxHeight: 280, animation: "none", opacity: 1, transform: "none" }}
            />
            <div className="animus-boot-status">DAEMON NOT RESPONDING ON 127.0.0.1:8733</div>
            <button
              type="button"
              className="btn primary"
              onClick={() => window.location.reload()}
              style={{ minHeight: 42 }}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="boot-screen"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--bg, #000000)",
          color: "var(--text, #ffffff)",
          gap: "24px",
        }}
      >
        <Spinner size={64} />
        <div style={{ fontSize: "24px", fontWeight: 700, textAlign: "center" }}>ORC TORRENT</div>
        <div style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.7)", textAlign: "center", maxWidth: "400px" }}>
          Daemon is not responding on 127.0.0.1:8733
        </div>
        <div style={{ marginTop: "16px" }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 20px",
              background: "rgba(255, 255, 255, 0.1)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "6px",
              color: "var(--text, #ffffff)",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
