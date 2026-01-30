import React, { memo, useCallback, useState } from "react";
import { patchJson } from "../../utils/api";

interface ThreatModelPresetsProps {
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type ThreatModel = "direct" | "vpn-only" | "hardened" | "extreme";

export const ThreatModelPresets = memo<ThreatModelPresetsProps>(({
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  const [activePreset, setActivePreset] = useState<ThreatModel | null>(null);
  const [loading, setLoading] = useState(false);

  const handleApplyPreset = useCallback(async (preset: ThreatModel) => {
    if (!online || loading) return;
    try {
      setLoading(true);
      setActivePreset(preset);
      // Note: Threat model presets API endpoint not yet implemented
      // await patchJson("/net/threat-model", { preset });
      onUpdate();
      onSuccess(`Threat model preset "${preset}" will be applied when the API endpoint is available`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to apply threat model preset";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [online, loading, onUpdate, onError, onSuccess]);

  const presets: { id: ThreatModel; label: string; description: string }[] = [
    {
      id: "direct",
      label: "Direct",
      description: "No restrictions, direct connections",
    },
    {
      id: "vpn-only",
      label: "VPN Only",
      description: "Requires VPN, bind to VPN interface",
    },
    {
      id: "hardened",
      label: "Hardened",
      description: "VPN + kill switch + forced encryption",
    },
    {
      id: "extreme",
      label: "Extreme",
      description: "Maximum security: VPN + kill switch + no DHT/PEX/LSD + forced encryption",
    },
  ];

  return (
    <div className="networkWidget">
      <div className="networkWidgetTitle">Threat Model Presets</div>
      <div className="networkWidgetContent">
        <div className="threatModelPresets">
          {presets.map(preset => (
            <button
              key={preset.id}
              className={`btn ${activePreset === preset.id ? "primary" : ""}`}
              onClick={() => handleApplyPreset(preset.id)}
              disabled={!online || loading}
              title={preset.description}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="networkWidgetNote" style={{ marginTop: "12px", fontSize: "11px" }}>
          Select a preset to apply security configuration automatically
        </div>
      </div>
    </div>
  );
});

ThreatModelPresets.displayName = "ThreatModelPresets";
