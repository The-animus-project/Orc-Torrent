import React, { memo } from "react";
import type { Health, Version } from "../types";

interface HeaderProps {
  online: boolean;
  version: string;
  health: Health | null;
  onRefresh: () => void;
}

export const Header = memo<HeaderProps>(({ online, version, health, onRefresh }) => {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <img 
            src="./icons/icon.ico" 
            alt="ORC TORRENT logo" 
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              const altText = target.alt;
              target.style.display = "none";
              if (target.parentElement) {
                const logoEl = target.parentElement;
                logoEl.textContent = "O";
                logoEl.style.display = "grid";
                logoEl.style.placeItems = "center";
                logoEl.setAttribute("aria-label", altText);
                logoEl.setAttribute("role", "img");
              }
            }}
          />
        </div>
        <div className="titles">
          <div className="name"><span className="name-orc">ORC</span> TORRENT</div>
          <div className="tag">The Apex Downloader</div>
        </div>
      </div>

      <div className="right">
        <div className={`chip ${online ? "ok" : "bad"}`}>
          <span className="dot" />
          {online ? "Connected" : "Offline"}
        </div>
        <div className="chip neutral">
          <span style={{ opacity: 0.7 }}>v</span>{version}
        </div>
        <button className="btn ghost" onClick={onRefresh} aria-label="Refresh">
          REFRESH
        </button>
      </div>
    </header>
  );
});

Header.displayName = "Header";
