// CRITICAL: This must run immediately to show something on screen
// Add a visible indicator that the script is running
(function() {
  'use strict';
  
  // Immediately show something on screen
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  function init() {
    // Set body styles immediately
    if (document.body) {
      document.body.style.cssText = "background: #000000; color: #ffffff; margin: 0; padding: 0; font-family: system-ui, sans-serif; width: 100%; min-height: 100vh;";
    }
    if (document.documentElement) {
      document.documentElement.style.cssText = "background: #000000; width: 100%; height: 100%;";
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
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; color: #ffffff; font-family: system-ui, sans-serif; background: #000000; flex-direction: column; gap: 24px; position: relative; overflow: hidden;">
        <!-- Background glow -->
        <div style="position: absolute; top: 50%; left: 50%; width: 300px; height: 300px; transform: translate(-50%, -50%); background: radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%); animation: bgPulse 2.5s ease-in-out infinite;"></div>
        
        <!-- Spinner container -->
        <div style="position: relative; animation: spinnerEnter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; opacity: 0;">
          <div style="width: 56px; height: 56px; border: 3px solid rgba(255,255,255,0.15); border-top-color: rgba(255,255,255,0.9); border-radius: 50%; animation: spin 1s linear infinite; filter: drop-shadow(0 0 10px rgba(255,255,255,0.15));"></div>
        </div>
        
        <!-- Title -->
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; animation: titleEnter 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.2s forwards; opacity: 0; position: relative;">
          ORC TORRENT
        </div>
        
        <!-- Subtitle -->
        <div style="font-size: 12px; color: rgba(255,255,255,0.5); letter-spacing: 2px; text-transform: uppercase; animation: subtitleEnter 0.5s ease 0.4s forwards; opacity: 0;">
          Loading
        </div>
        
        <!-- Loading dots -->
        <div style="display: flex; gap: 8px; animation: dotsEnter 0.4s ease 0.6s forwards; opacity: 0;">
          <div style="width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.4); animation: dotBounce 1.4s ease-in-out infinite;"></div>
          <div style="width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.4); animation: dotBounce 1.4s ease-in-out 0.2s infinite;"></div>
          <div style="width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.4); animation: dotBounce 1.4s ease-in-out 0.4s infinite;"></div>
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

// Import logger after it's defined (will be available after module load)
// Note: We use console.error here because this runs before React mounts and logger may not be available
// These are critical errors that should always be logged
window.addEventListener("unhandledrejection", (event) => {
  console.error("[Renderer] Unhandled promise rejection:", event.reason);
  const errorMessage = event.reason instanceof Error 
    ? event.reason.stack || event.reason.message 
    : String(event.reason);
  console.error("[Renderer] Rejection details:", errorMessage);
  event.preventDefault();
});

// Safe HTML escaping function to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle any errors during React rendering
// Note: We use console.error here because this runs before React mounts and logger may not be available
// These are critical errors that should always be logged
window.addEventListener("error", (event) => {
  console.error("[Renderer] Global error:", event.error || event.message);
  console.error("[Renderer] Error details:", event.error?.stack || event.message);
  
  // Show error on screen (safely escaped to prevent XSS)
  const root = document.getElementById("root");
  if (root) {
    const errorText = event.error?.stack || event.message || "Unknown error";
    const safeErrorText = escapeHtml(String(errorText));
    root.innerHTML = `
      <div style="padding: 40px; color: #ffffff; background: #000000; font-family: monospace; min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column;">
        <h1 style="color: #ff4444; margin-bottom: 20px;">JavaScript Error</h1>
        <pre style="background: #111; padding: 20px; border-radius: 4px; max-width: 800px; overflow-x: auto; text-align: left; font-size: 12px;">${safeErrorText}</pre>
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
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = "padding: 40px; color: #ffffff; background: #000000; font-family: monospace; min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column;";
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
    const AppWrapper = isDevelopment ? (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    ) : (
      <App />
    );
    root.render(AppWrapper);
  } catch (error) {
    // Critical error - always log even before logger is available
    console.error("[Renderer] Failed to mount React app:", error);
    const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
    const safeErrorMessage = escapeHtml(errorMessage);
    rootElement.innerHTML = `
      <div style="padding: 40px; color: #ffffff; background: #000000; font-family: monospace; min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column;">
        <h1 style="color: #ff4444; margin-bottom: 20px; font-size: 24px;">Error: Failed to mount React app</h1>
        <pre style="background: #111; padding: 20px; border-radius: 4px; max-width: 800px; overflow-x: auto; text-align: left; font-size: 12px; color: #ffaaaa; white-space: pre-wrap;">${safeErrorMessage}</pre>
        <p style="margin-top: 20px; opacity: 0.7; font-size: 14px;">Check the console for more details.</p>
      </div>
    `;
  }
}

// Mount when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  // DOM already ready, mount immediately
  mountApp();
}
