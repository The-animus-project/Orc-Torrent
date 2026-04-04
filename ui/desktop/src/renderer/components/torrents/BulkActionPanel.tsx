import React, { memo, useCallback, useState, useEffect, useRef } from "react";

interface BulkActionPanelProps {
  selectedCount: number;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onRemove: () => void;
  onSetPriority: (priority: "low" | "normal" | "high") => void;
  onMoveData: () => void;
  onExportTorrent: () => void;
  onSetLimits: () => void;
  onApplyLabel: (label: string) => void;
  onSetVpnPolicy: (policy: "standard" | "private" | "anonymous") => void;
  availableLabels: string[];
  online: boolean;
}

export const BulkActionPanel = memo<BulkActionPanelProps>(({
  selectedCount,
  onStart,
  onPause,
  onStop,
  onRemove,
  onSetPriority,
  onMoveData,
  onExportTorrent,
  onSetLimits,
  onApplyLabel,
  onSetVpnPolicy,
  availableLabels,
  online,
}) => {
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [showLabelMenu, setShowLabelMenu] = useState(false);
  const [showVpnMenu, setShowVpnMenu] = useState(false);
  
  const priorityMenuRef = useRef<HTMLDivElement>(null);
  const labelMenuRef = useRef<HTMLDivElement>(null);
  const vpnMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      if (showPriorityMenu && priorityMenuRef.current && !priorityMenuRef.current.contains(target)) {
        setShowPriorityMenu(false);
      }
      if (showLabelMenu && labelMenuRef.current && !labelMenuRef.current.contains(target)) {
        setShowLabelMenu(false);
      }
      if (showVpnMenu && vpnMenuRef.current && !vpnMenuRef.current.contains(target)) {
        setShowVpnMenu(false);
      }
    };

    if (showPriorityMenu || showLabelMenu || showVpnMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showPriorityMenu, showLabelMenu, showVpnMenu]);

  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="bulkActionPanel">
      <div className="bulkActionPanelHeader">
        <div className="bulkActionPanelTitle">
          {selectedCount} torrent{selectedCount !== 1 ? "s" : ""} selected
        </div>
      </div>
      <div className="bulkActionPanelActions">
        <button
          className="btn"
          onClick={onStart}
          disabled={!online}
          aria-label="Start Selected Torrents"
        >
          START
        </button>
        <button
          className="btn"
          onClick={onPause}
          disabled={!online}
          aria-label="Pause Selected Torrents"
        >
          PAUSE
        </button>
        <button
          className="btn"
          onClick={onStop}
          disabled={!online}
          aria-label="Stop Selected Torrents"
        >
          STOP
        </button>
        <div className="divider" />
        <div className="bulkActionMenu" ref={priorityMenuRef}>
          <button
            className="btn ghost"
            onClick={() => setShowPriorityMenu(!showPriorityMenu)}
            aria-expanded={showPriorityMenu}
            aria-haspopup="true"
            aria-label="Set Priority"
            title="Set Priority"
          >
            PRIORITY ▼
          </button>
          {showPriorityMenu && (
            <div className="bulkActionDropdown" role="menu">
              <button 
                role="menuitem"
                onClick={() => { onSetPriority("low"); setShowPriorityMenu(false); }}
                aria-label="Set Priority to Low"
              >
                Low
              </button>
              <button 
                role="menuitem"
                onClick={() => { onSetPriority("normal"); setShowPriorityMenu(false); }}
                aria-label="Set Priority to Normal"
              >
                Normal
              </button>
              <button 
                role="menuitem"
                onClick={() => { onSetPriority("high"); setShowPriorityMenu(false); }}
                aria-label="Set Priority to High"
              >
                High
              </button>
            </div>
          )}
        </div>
        <button
          className="btn ghost"
          onClick={onMoveData}
          disabled={!online}
        >
          MOVE DATA
        </button>
        <button
          className="btn ghost"
          onClick={onExportTorrent}
          disabled={!online}
        >
          EXPORT .TORRENT
        </button>
        <button
          className="btn ghost"
          onClick={onSetLimits}
          disabled={!online}
        >
          SET LIMITS
        </button>
        <div className="bulkActionMenu" ref={labelMenuRef}>
          <button
            className="btn ghost"
            onClick={() => setShowLabelMenu(!showLabelMenu)}
            aria-expanded={showLabelMenu}
            aria-haspopup="true"
            aria-label="Apply Label"
            title="Apply Label"
          >
            APPLY LABEL ▼
          </button>
          {showLabelMenu && (
            <div className="bulkActionDropdown" role="menu">
              {availableLabels.length > 0 ? (
                availableLabels.map(label => (
                  <button
                    key={label}
                    role="menuitem"
                    onClick={() => { onApplyLabel(label); setShowLabelMenu(false); }}
                    aria-label={`Apply label: ${label}`}
                  >
                    {label}
                  </button>
                ))
              ) : (
                <div className="bulkActionDropdownEmpty" role="status">No labels available</div>
              )}
            </div>
          )}
        </div>
        <div className="bulkActionMenu" ref={vpnMenuRef}>
          <button
            className="btn ghost"
            onClick={() => setShowVpnMenu(!showVpnMenu)}
            aria-expanded={showVpnMenu}
            aria-haspopup="true"
            aria-label="Set VPN Policy"
            title="Set VPN Policy"
          >
            VPN POLICY ▼
          </button>
          {showVpnMenu && (
            <div className="bulkActionDropdown" role="menu">
              <button 
                role="menuitem"
                onClick={() => { onSetVpnPolicy("standard"); setShowVpnMenu(false); }}
                aria-label="Set VPN Policy to Standard"
              >
                Standard
              </button>
              <button 
                role="menuitem"
                onClick={() => { onSetVpnPolicy("private"); setShowVpnMenu(false); }}
                aria-label="Set VPN Policy to Private"
              >
                Private
              </button>
              <button 
                role="menuitem"
                onClick={() => { onSetVpnPolicy("anonymous"); setShowVpnMenu(false); }}
                aria-label="Set VPN Policy to Anonymous"
              >
                Anonymous
              </button>
            </div>
          )}
        </div>
        <div className="divider" />
        <button
          className="btn"
          onClick={onRemove}
          disabled={!online}
          aria-label="Remove Selected Torrents"
        >
          REMOVE
        </button>
      </div>
    </div>
  );
});

BulkActionPanel.displayName = "BulkActionPanel";
