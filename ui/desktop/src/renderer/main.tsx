// CRITICAL: This must run immediately to show something on screen
// Add a visible indicator that the script is running
type BootstrapTheme = "light" | "dark";

function getBootstrapTheme(): BootstrapTheme {
  const snapshot = window.orc?.theme?.getSnapshot?.();
  if (snapshot?.resolved === "light" || snapshot?.resolved === "dark") {
    return snapshot.resolved;
  }
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyBootstrapTheme(theme: BootstrapTheme) {
  const root = document.documentElement;
  const body = document.body;
  root.dataset.appTheme = theme;
  root.style.colorScheme = theme;

  const background =
    theme === "dark"
      ? "radial-gradient(circle at top, rgba(255, 255, 255, 0.05), transparent 38%), linear-gradient(180deg, #111318 0%, #0b0d11 100%)"
      : "radial-gradient(circle at top, rgba(255, 255, 255, 0.8), transparent 38%), linear-gradient(180deg, #f8f3ea 0%, #f1eadf 100%)";
  const text = theme === "dark" ? "#f5f7fb" : "#1b1a17";

  root.style.cssText = `${root.style.cssText}; background: ${background}; width: 100%; height: 100%; color-scheme: ${theme};`;
  if (body) {
    body.dataset.appTheme = theme;
    body.style.cssText = `background: ${background}; color: ${text}; margin: 0; padding: 0; font-family: system-ui, sans-serif; width: 100%; min-height: 100vh;`;
  }

  return { background, text, theme };
}

(function () {
  "use strict";
  const palette = applyBootstrapTheme(getBootstrapTheme());

  // Immediately show something on screen
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    applyBootstrapTheme(getBootstrapTheme());
    if (document.body) {
      document.body.classList.add("js-loaded");
    }

    // Ensure root exists and show loading
    let root = document.getElementById("root");
    if (!root) {
      console.error("[Renderer] Root element missing, creating it...");
      root = document.createElement("div");
      root.id = "root";
      if (document.body) {
        document.body.appendChild(root);
      } else {
        document.documentElement.appendChild(root);
      }
    }

    // Show immediate loading state with enhanced animations
    root.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; color: ${palette.text}; font-family: system-ui, sans-serif; background: ${palette.background}; flex-direction: column; gap: 24px; position: relative; overflow: hidden;">
        <!-- Background glow -->
        <div style="position: absolute; top: 50%; left: 50%; width: 300px; height: 300px; transform: translate(-50%, -50%); background: ${palette.theme === "dark" ? "radial-gradient(circle, rgba(255,255,255,0.16) 0%, transparent 72%)" : "radial-gradient(circle, rgba(255,255,255,0.55) 0%, transparent 72%)"}; animation: bgPulse 2.5s ease-in-out infinite;"></div>

        <!-- Spinner container -->
        <div style="position: relative; animation: spinnerEnter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; opacity: 0;">
          <div style="width: 56px; height: 56px; border: 3px solid ${palette.theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(31,29,26,0.12)"}; border-top-color: ${palette.theme === "dark" ? "rgba(255,255,255,0.85)" : "rgba(31,29,26,0.85)"}; border-radius: 50%; animation: spin 1s linear infinite; filter: drop-shadow(0 0 10px ${palette.theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(31,29,26,0.08)"});"></div>
        </div>

        <!-- Title -->
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; animation: titleEnter 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.2s forwards; opacity: 0; position: relative;">
          ORC TORRENT
        </div>

        <!-- Subtitle -->
        <div style="font-size: 12px; color: ${palette.theme === "dark" ? "rgba(245,247,251,0.6)" : "rgba(27,26,23,0.55)"}; letter-spacing: 2px; text-transform: uppercase; animation: subtitleEnter 0.5s ease 0.4s forwards; opacity: 0;">
          Loading
        </div>

        <!-- Loading dots -->
        <div style="display: flex; gap: 8px; animation: dotsEnter 0.4s ease 0.6s forwards; opacity: 0;">
          <div style="width: 6px; height: 6px; border-radius: 50%; background: ${palette.theme === "dark" ? "rgba(245,247,251,0.35)" : "rgba(27,26,23,0.3)"}; animation: dotBounce 1.4s ease-in-out infinite;"></div>
          <div style="width: 6px; height: 6px; border-radius: 50%; background: ${palette.theme === "dark" ? "rgba(245,247,251,0.35)" : "rgba(27,26,23,0.3)"}; animation: dotBounce 1.4s ease-in-out 0.2s infinite;"></div>
          <div style="width: 6px; height: 6px; border-radius: 50%; background: ${palette.theme === "dark" ? "rgba(245,247,251,0.35)" : "rgba(27,26,23,0.3)"}; animation: dotBounce 1.4s ease-in-out 0.4s infinite;"></div>
        </div>

        <style>
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes bgPulse {
            0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
            50% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
          }
          @keyframes spinnerEnter {
            from { opacity: 0; transform: scale(0.5) rotate(-20deg); }
            to { opacity: 1; transform: scale(1) rotate(0deg); }
          }
          @keyframes titleEnter {
            from { opacity: 0; transform: translateY(15px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes subtitleEnter {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes dotsEnter {
            to { opacity: 1; }
          }
          @keyframes dotBounce {
            0%, 80%, 100% { transform: scale(1); opacity: 0.4; }
            40% { transform: scale(1.3); opacity: 1; }
          }
        </style>
      </div>
    `;
  }
})();

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ui/App";
import MobileApp from "./mobile/MobileApp";

// Import logger after it's defined (will be available after module load)
// Note: We use console.error here because this runs before React mounts and logger may not be available
// These are critical errors that should always be logged
window.addEventListener("unhandledrejection", (event) => {
  console.error("[Renderer] Unhandled promise rejection:", event.reason);
  const errorMessage =
    event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason);
  console.error("[Renderer] Rejection details:", errorMessage);
  event.preventDefault();
});

// Safe HTML escaping function to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Handle any errors during React rendering
// Note: We use console.error here because this runs before React mounts and logger may not be available
// These are critical errors that should always be logged
window.addEventListener("error", (event) => {
  console.error("[Renderer] Global error:", event.error || event.message);
  console.error("[Renderer] Error details:", event.error?.stack || event.message);
  const palette = applyBootstrapTheme(getBootstrapTheme());

  // Show error on screen (safely escaped to prevent XSS)
  const root = document.getElementById("root");
  if (root) {
    const errorText = event.error?.stack || event.message || "Unknown error";
    const safeErrorText = escapeHtml(String(errorText));
    root.innerHTML = `
      <div style="padding: 40px; color: ${palette.text}; background: ${palette.background}; font-family: monospace; min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column;">
        <h1 style="color: #ff4444; margin-bottom: 20px;">JavaScript Error</h1>
        <pre style="background: ${palette.theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.82)"}; padding: 20px; border-radius: 4px; max-width: 800px; overflow-x: auto; text-align: left; font-size: 12px;">${safeErrorText}</pre>
      </div>
    `;
  }
});

// Mount React app
// Wait for DOM to be fully ready
function mountApp() {
  const rootElement = document.getElementById("root");

  if (!rootElement) {
    // Critical error - always log even before logger is available
    console.error("[Renderer] Root element not found! Cannot mount React app.");
    const palette = applyBootstrapTheme(getBootstrapTheme());
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = `padding: 40px; color: ${palette.text}; background: ${palette.background}; font-family: monospace; min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column;`;
    // Safe: Static error message, no user input
    errorDiv.innerHTML = `
      <h1 style="color: #ff4444; margin-bottom: 20px; font-size: 24px;">Error: Root element not found</h1>
      <p style="font-size: 16px; margin-bottom: 10px;">The #root element is missing from the HTML.</p>
      <p style="font-size: 14px; opacity: 0.7;">Check the HTML file structure.</p>
    `;
    if (document.body) {
      document.body.appendChild(errorDiv);
    } else {
      document.documentElement.appendChild(errorDiv);
    }
    return;
  }

  try {
    const root = ReactDOM.createRoot(rootElement);
    // Only use StrictMode in development to avoid hook order issues in production
    // In production builds, Vite sets import.meta.env.PROD to true
    const isDevelopment = import.meta.env.DEV;
    const RootApp = window.Capacitor?.getPlatform?.() === "android" ? MobileApp : App;
    const AppWrapper = isDevelopment ? (
      <React.StrictMode>
        <RootApp />
      </React.StrictMode>
    ) : (
      <RootApp />
    );
    root.render(AppWrapper);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.orc?.signalRendererReady?.();
      });
    });
  } catch (error) {
    // Critical error - always log even before logger is available
    console.error("[Renderer] Failed to mount React app:", error);
    const palette = applyBootstrapTheme(getBootstrapTheme());
    const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
    const safeErrorMessage = escapeHtml(errorMessage);
    rootElement.innerHTML = `
      <div style="padding: 40px; color: ${palette.text}; background: ${palette.background}; font-family: monospace; min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column;">
        <h1 style="color: #ff4444; margin-bottom: 20px; font-size: 24px;">Error: Failed to mount React app</h1>
        <pre style="background: ${palette.theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.82)"}; padding: 20px; border-radius: 4px; max-width: 800px; overflow-x: auto; text-align: left; font-size: 12px; color: ${palette.theme === "dark" ? "#ffd2a8" : "#a63b00"}; white-space: pre-wrap;">${safeErrorMessage}</pre>
        <p style="margin-top: 20px; opacity: 0.7; font-size: 14px;">Check the console for more details.</p>
      </div>
    `;
  }
}

// Mount when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountApp);
} else {
  // DOM already ready, mount immediately
  mountApp();
}
