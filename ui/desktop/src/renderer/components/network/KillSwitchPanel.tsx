import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import type { KillSwitchConfig, KillSwitchTriggers, NetPosture } from "../../types";
import { patchJson } from "../../utils/api";

interface KillSwitchPanelProps {
  netPosture: NetPosture | null;
  online: boolean;
  onUpdate: () => void;
  onRefreshVpn?: () => Promise<void>;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

const DEFAULT_TRIGGERS: KillSwitchTriggers = {
  pause_all_torrents: true,
  stop_seeding: false,
  disable_dht_pex_lpd: false,
  block_outbound: false,
};

function triggersFromPosture(netPosture: NetPosture | null): KillSwitchTriggers {
  return netPosture?.kill_switch?.triggers ?? DEFAULT_TRIGGERS;
}

export const KillSwitchPanel = memo<KillSwitchPanelProps>(
  ({ netPosture, online, onUpdate, onRefreshVpn, onError, onSuccess }) => {
    const [enabled, setEnabled] = useState(netPosture?.leak_proof_enabled ?? false);
    const [triggers, setTriggers] = useState<KillSwitchTriggers>(() => triggersFromPosture(netPosture));
    const [loading, setLoading] = useState(false);
    const dirtyRef = useRef(false);

    useEffect(() => {
      if (dirtyRef.current) return;
      setEnabled(netPosture?.leak_proof_enabled ?? false);
      setTriggers(triggersFromPosture(netPosture));
    }, [netPosture?.leak_proof_enabled, netPosture?.kill_switch?.triggers]);

    const patchKillSwitch = useCallback(
      async (body: Record<string, unknown>, successMessage: string) => {
        if (!online || loading) return false;
        try {
          setLoading(true);
          await patchJson<KillSwitchConfig>("/net/kill-switch", body);
          if (onRefreshVpn) {
            await onRefreshVpn();
          }
          onUpdate();
          onSuccess(successMessage);
          dirtyRef.current = false;
          return true;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Failed to update kill switch";
          onError(message);
          return false;
        } finally {
          setLoading(false);
        }
      },
      [online, loading, onRefreshVpn, onUpdate, onError, onSuccess]
    );

    const handleEnabledToggle = useCallback(
      async (nextEnabled: boolean) => {
        const previousEnabled = enabled;
        setEnabled(nextEnabled);
        const ok = await patchKillSwitch({ enabled: nextEnabled }, `Kill switch ${nextEnabled ? "enabled" : "disabled"}`);
        if (!ok) {
          setEnabled(previousEnabled);
        }
      },
      [enabled, patchKillSwitch]
    );

    const handleTriggerChange = useCallback(
      async (key: keyof KillSwitchTriggers, checked: boolean) => {
        const previous = triggers;
        const nextTriggers = { ...triggers, [key]: checked };
        dirtyRef.current = true;
        setTriggers(nextTriggers);

        const ok = await patchKillSwitch({ triggers: nextTriggers }, "Kill switch triggers updated");
        if (!ok) {
          dirtyRef.current = false;
          setTriggers(previous);
        }
      },
      [triggers, patchKillSwitch]
    );

    return (
      <div className="networkWidget">
        <div className="networkWidgetTitle">Kill Switch</div>
        <div className="networkWidgetContent">
          <label className="toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => void handleEnabledToggle(e.target.checked)}
              disabled={!online || loading}
            />
            <span className="slider" />
            <span className="tText">{enabled ? "ENABLED" : "DISABLED"}</span>
          </label>
          {enabled && (
            <div className="networkWidgetSection">
              <div className="networkWidgetLabel">When triggered:</div>
              <div className="networkWidgetTriggers">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={triggers.pause_all_torrents}
                    onChange={(e) => void handleTriggerChange("pause_all_torrents", e.target.checked)}
                    disabled={!online || loading}
                  />
                  <span>Pause all torrents</span>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={triggers.stop_seeding}
                    onChange={(e) => void handleTriggerChange("stop_seeding", e.target.checked)}
                    disabled={!online || loading}
                  />
                  <span>Stop seeding</span>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={triggers.disable_dht_pex_lpd}
                    onChange={(e) => void handleTriggerChange("disable_dht_pex_lpd", e.target.checked)}
                    disabled={!online || loading}
                  />
                  <span>Disable DHT/PEX/LPD</span>
                </label>
                {netPosture?.kill_switch?.scope === "app_level" && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={triggers.block_outbound}
                      onChange={(e) => void handleTriggerChange("block_outbound", e.target.checked)}
                      disabled={!online || loading}
                    />
                    <span>Block outbound</span>
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

KillSwitchPanel.displayName = "KillSwitchPanel";
