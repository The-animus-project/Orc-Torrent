import React, { useEffect, useState } from "react";
import { Spinner } from "./Spinner";

type BootState =
  | { phase: "booting" }
  | { phase: "ready" }
  | { phase: "daemon_down" }
  | { phase: "connectivity_restricted" };

async function pingDaemon(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    try {
      const r = await fetch("http://127.0.0.1:8733/health", { 
        cache: "no-store",
        signal: controller.signal
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

interface BootGateProps {
  children: React.ReactNode;
}

/**
 * BootGate component - handles app boot sequence
 * Always shows startup animation, then checks daemon health
 * No firewall-specific animations or prompts
 */
export function BootGate({ children }: BootGateProps) {
  const [state, setState] = useState<BootState>({ phase: "booting" });

  useEffect(() => {
    let alive = true;

    (async () => {
      // Always show startup animation for at least 4000ms for a cool loading experience
      const minDelay = new Promise((res) => setTimeout(res, 4000));

      const daemonOk = await pingDaemon();
      await minDelay;

      if (!alive) return;

      if (!daemonOk) {
        setState({ phase: "daemon_down" });
        return;
      }

      setState({ phase: "ready" });
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (state.phase === "booting") {
    // Startup animation - always shown during boot
    return (
      <div className="boot-screen" style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg, #000000)",
        color: "var(--text, #ffffff)",
        position: "relative",
        overflow: "hidden"
      }}>
        {/* Animated background with multiple layers */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "600px",
          height: "600px",
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 40%, transparent 70%)",
          animation: "startupBgPulse 4.5s ease-in-out infinite",
          pointerEvents: "none",
          filter: "blur(40px)"
        }} />
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "400px",
          height: "400px",
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 60%)",
          animation: "startupBgPulse 3.5s ease-in-out infinite 0.7s",
          pointerEvents: "none",
          filter: "blur(30px)"
        }} />
        
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

        <div style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "28px",
          animation: "startupFadeIn 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards"
        }}>
          <div style={{
            animation: "startupSpinnerEnter 3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s forwards",
            opacity: 0,
            filter: "drop-shadow(0 0 40px rgba(255, 255, 255, 0.3)) drop-shadow(0 0 80px rgba(255, 255, 255, 0.15)) drop-shadow(0 0 120px rgba(255, 255, 255, 0.08))"
          }}>
            <Spinner size={90} />
          </div>
          
          <div style={{
            fontSize: "48px",
            fontWeight: 900,
            letterSpacing: "10px",
            textTransform: "uppercase",
            color: "#fff",
            animation: "startupFadeIn 1.6s cubic-bezier(0.16, 1, 0.3, 1) 1.1s forwards",
            opacity: 0,
            textShadow: "0 2px 32px rgba(0,0,0,0.5), 0 0 30px rgba(255,255,255,0.1)"
          }}>
            ORC TORRENT
          </div>
          
          <div style={{
            fontSize: "14px",
            fontWeight: 700,
            color: "rgba(255, 255, 255, 0.65)",
            letterSpacing: "5px",
            textTransform: "uppercase",
            animation: "startupFadeIn 1.4s cubic-bezier(0.16, 1, 0.3, 1) 1.6s forwards",
            opacity: 0,
            marginTop: "-4px"
          }}>
            Initializing runtime...
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === "daemon_down") {
    return (
      <div className="boot-screen" style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg, #000000)",
        color: "var(--text, #ffffff)",
        gap: "24px"
      }}>
        <Spinner size={64} />
        <div style={{ fontSize: "24px", fontWeight: 700, textAlign: "center" }}>
          ORC TORRENT
        </div>
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
              fontWeight: 600
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ready state - show main app
  return <>{children}</>;
}
