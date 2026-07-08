import React, { useCallback, useEffect, useState } from "react";
import type { WatchFolderEntry, WatchFoldersResponse } from "../types";
import { getWatchFolders, patchWatchFolders, testWatchFolder } from "../utils/watchFoldersApi";

interface WatchFoldersSettingsProps {
  online: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const WatchFoldersSettings: React.FC<WatchFoldersSettingsProps> = ({ online, onError, onSuccess }) => {
  const [data, setData] = useState<WatchFoldersResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!online) return;
    try {
      setData(await getWatchFolders());
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to load watch folders");
    }
  }, [online, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Parameters<typeof patchWatchFolders>[0]) => {
    setSaving(true);
    try {
      const resp = await patchWatchFolders(patch);
      setData(resp);
      onSuccess("Watch folder settings saved");
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to save watch folders");
    } finally {
      setSaving(false);
    }
  };

  const addFolder = () => {
    if (!data) return;
    const entry: WatchFolderEntry = {
      id: crypto.randomUUID(),
      enabled: true,
      folder_path: "",
      auto_start: true,
      delete_after_import: false,
    };
    void save({ folders: [...data.settings.folders, entry] });
  };

  const updateEntry = (id: string, patch: Partial<WatchFolderEntry>) => {
    if (!data) return;
    const folders = data.settings.folders.map((f) => (f.id === id ? { ...f, ...patch } : f));
    setData({ ...data, settings: { ...data.settings, folders } });
  };

  const removeEntry = (id: string) => {
    if (!data) return;
    void save({ folders: data.settings.folders.filter((f) => f.id !== id) });
  };

  const handleSaveAll = () => {
    if (!data) return;
    void save({ enabled: data.settings.enabled, folders: data.settings.folders });
  };

  const handleBrowseFolder = async (id: string, field: "folder_path" | "default_save_path" | "archive_folder") => {
    const path = await window.orc?.showSaveFolderDialog?.();
    if (path) {
      updateEntry(id, { [field]: path });
    }
  };

  const handleTest = async (path: string) => {
    try {
      const r = await testWatchFolder(path);
      if (r.ok) onSuccess(r.message);
      else onError(r.message);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Folder test failed");
    }
  };

  if (!data) {
    return <p className="settingsSummaryNote">Loading watch folder settings…</p>;
  }

  return (
    <div className="settingsSectionCard settingsSectionCardWide">
      <h2 className="settingsSectionCardTitle">Watch folders</h2>
      <p className="settingsSummaryNote">
        Drop <code>.torrent</code> files into a watched folder to import them automatically.
      </p>

      <label className="settingsRateLimitToggleRow">
        <span className="settingsRateLimitLabel">Enable watch folders</span>
        <input
          type="checkbox"
          checked={data.settings.enabled}
          onChange={(e) =>
            setData({
              ...data,
              settings: { ...data.settings, enabled: e.target.checked },
            })
          }
        />
      </label>

      {data.settings.folders.map((entry) => (
        <div key={entry.id} className="watchFolderEntry">
          <label>
            <input
              type="checkbox"
              checked={entry.enabled}
              onChange={(e) => updateEntry(entry.id, { enabled: e.target.checked })}
            />
            Enabled
          </label>
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">Folder path</span>
            <div className="settingsQuickActions">
              <input
                className="settingsNumberInput"
                value={entry.folder_path}
                onChange={(e) => updateEntry(entry.id, { folder_path: e.target.value })}
                placeholder="/path/to/watch"
              />
              <button type="button" className="btn" onClick={() => void handleBrowseFolder(entry.id, "folder_path")}>
                Browse
              </button>
            </div>
          </label>
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">Default save path (optional)</span>
            <div className="settingsQuickActions">
              <input
                className="settingsNumberInput"
                value={entry.default_save_path ?? ""}
                onChange={(e) =>
                  updateEntry(entry.id, {
                    default_save_path: e.target.value || null,
                  })
                }
              />
              <button
                type="button"
                className="btn"
                onClick={() => void handleBrowseFolder(entry.id, "default_save_path")}
              >
                Browse
              </button>
            </div>
          </label>
          <label>
            <input
              type="checkbox"
              checked={entry.auto_start}
              onChange={(e) => updateEntry(entry.id, { auto_start: e.target.checked })}
            />
            Auto-start after import
          </label>
          <label>
            <input
              type="checkbox"
              checked={entry.delete_after_import}
              onChange={(e) => updateEntry(entry.id, { delete_after_import: e.target.checked })}
            />
            Delete .torrent after import
          </label>
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">Archive folder (optional)</span>
            <div className="settingsQuickActions">
              <input
                className="settingsNumberInput"
                value={entry.archive_folder ?? ""}
                onChange={(e) => updateEntry(entry.id, { archive_folder: e.target.value || null })}
              />
              <button type="button" className="btn" onClick={() => void handleBrowseFolder(entry.id, "archive_folder")}>
                Browse
              </button>
            </div>
          </label>
          <div className="settingsQuickActions">
            <button type="button" className="btn" onClick={() => void handleTest(entry.folder_path)}>
              Test access
            </button>
            <button type="button" className="btn ghost" onClick={() => removeEntry(entry.id)}>
              Remove
            </button>
          </div>
        </div>
      ))}

      <div className="settingsQuickActions">
        <button type="button" className="btn" onClick={addFolder} disabled={!online}>
          Add folder
        </button>
        <button type="button" className="btn primary" onClick={handleSaveAll} disabled={!online || saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>

      {data.events.length > 0 && (
        <>
          <h3 className="settingsSectionCardTitle">Recent imports</h3>
          <table className="watchImportTable">
            <thead>
              <tr>
                <th>Time</th>
                <th>File</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {[...data.events]
                .reverse()
                .slice(0, 20)
                .map((ev, i) => (
                  <tr key={`${ev.at_ms}-${i}`}>
                    <td>{new Date(ev.at_ms).toLocaleString()}</td>
                    <td>{ev.torrent_path}</td>
                    <td>{ev.status}</td>
                    <td>{ev.message}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};
