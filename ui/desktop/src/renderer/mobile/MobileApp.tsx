import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SeedingSettings, Torrent, TorrentStatus } from "../types";
import { configureDaemonApi, getJson, patchJson, postJson } from "../utils/api";
import { addMagnetToDaemon, addTorrentB64ToDaemon } from "../utils/torrentImport";
import { getPlatformBridge, type AndroidBootstrap, type PickedTorrentFile } from "../platform/bridge";
import "./mobile.css";

type Tab = "downloads" | "add" | "privacy" | "settings";
type ContentFile = { path: string[]; size: number; priority: "skip" | "low" | "normal" | "high"; downloaded: boolean };
type Content = { files: ContentFile[] };

const bridge = getPlatformBridge();

function bytes(value = 0): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power]}`;
}

function speed(value = 0): string {
  return `${bytes(value)}/s`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForDaemon(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await getJson("/health");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The on-device torrent engine did not start");
}

export default function MobileApp() {
  const [bootstrap, setBootstrap] = useState<AndroidBootstrap | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("downloads");
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [statuses, setStatuses] = useState<Record<string, TorrentStatus>>({});
  const [selected, setSelected] = useState<Torrent | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [magnet, setMagnet] = useState("");
  const [pendingFile, setPendingFile] = useState<PickedTorrentFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboardingKillSwitch, setOnboardingKillSwitch] = useState(false);
  const [seeding, setSeeding] = useState<SeedingSettings>({
    ratio_limit_enabled: true,
    ratio_limit: 1,
    seed_time_limit_enabled: false,
    seed_time_minutes: 0,
    action: "stop_torrent",
  });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!ready) return;
    try {
      const response = await getJson<{ items: Torrent[] }>("/torrents");
      const items = response.items ?? [];
      const pairs = await Promise.all(
        items.map(async (torrent) => {
          try {
            return [torrent.id, await getJson<TorrentStatus>(`/torrents/${torrent.id}/status`)] as const;
          } catch {
            return null;
          }
        })
      );
      if (!alive.current) return;
      setTorrents(items);
      setStatuses(Object.fromEntries(pairs.filter((pair): pair is readonly [string, TorrentStatus] => pair !== null)));
      setSelected((current) => (current ? items.find((item) => item.id === current.id) ?? null : null));
    } catch (reason) {
      if (alive.current) setError(messageOf(reason));
    }
  }, [ready]);

  const finishBootstrap = useCallback(async (value: AndroidBootstrap) => {
    setBootstrap(value);
    if (!value.storageReady) return;
    configureDaemonApi({ baseUrl: value.baseUrl, adminToken: value.adminToken });
    await waitForDaemon();
    const defaultSeeding: SeedingSettings = {
      ratio_limit_enabled: true,
      ratio_limit: 1,
      seed_time_limit_enabled: false,
      seed_time_minutes: 0,
      action: "stop_torrent",
    };
    try {
      const current = await getJson<SeedingSettings>("/seeding");
      if (!localStorage.getItem("orc-android-seeding-initialized")) {
        await patchJson("/seeding", defaultSeeding);
        localStorage.setItem("orc-android-seeding-initialized", "1");
        setSeeding(defaultSeeding);
      } else {
        setSeeding(current);
      }
    } catch {
      setSeeding(defaultSeeding);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    alive.current = true;
    void bridge
      .bootstrap()
      .then((value) => value && finishBootstrap(value))
      .catch((reason) => setError(messageOf(reason)));
    return () => {
      alive.current = false;
    };
  }, [finishBootstrap]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [ready, refresh]);

  useEffect(() => bridge.onAppStateChange((active) => {
    if (!active) return;
    void bridge.bootstrap().then((value) => {
      if (value) setBootstrap(value);
      void refresh();
    });
  }), [refresh]);

  const addTorrent = useCallback(
    async (file?: PickedTorrentFile, magnetUri?: string) => {
      setBusy(true);
      setError(null);
      try {
        if (bootstrap?.killSwitchEnabled && !bootstrap.vpnActive) {
          throw new Error("Connect your VPN before adding a torrent while the kill switch is enabled");
        }
        const added = file
          ? await addTorrentB64ToDaemon(file.base64, undefined, file.name.replace(/\.torrent$/i, ""), undefined, true)
          : magnetUri?.trim()
            ? await addMagnetToDaemon(magnetUri.trim(), undefined, undefined, true)
            : null;
        if (!added) throw new Error("Paste a magnet link or choose a .torrent file");
        await bridge.setTransferPolicy({
          allowCellular: bootstrap?.allowCellular ?? false,
          killSwitchEnabled: bootstrap?.killSwitchEnabled ?? false,
        });
        setMagnet("");
        setNotice("Torrent added paused. Choose file priorities, then resume.");
        setTab("downloads");
        await refresh();
        setSelected(await getJson<Torrent>(`/torrents/${added.id}`));
      } catch (reason) {
        setError(messageOf(reason));
      } finally {
        setBusy(false);
      }
    },
    [bootstrap, refresh]
  );

  useEffect(() => {
    const removeMagnet = bridge.onMagnetLink((uri) => {
      setMagnet(uri);
      setTab("add");
    });
    const removeTorrent = bridge.onTorrentFile((file) => {
      if (ready) void addTorrent(file);
      else setPendingFile(file);
    });
    return () => {
      removeMagnet();
      removeTorrent();
    };
  }, [addTorrent, ready]);

  useEffect(() => {
    if (!ready || !pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    void addTorrent(file);
  }, [addTorrent, pendingFile, ready]);

  useEffect(() => {
    if (!selected || !ready) {
      setContent(null);
      return;
    }
    void getJson<Content>(`/torrents/${selected.id}/content`)
      .then(setContent)
      .catch((reason) => setError(messageOf(reason)));
  }, [ready, selected]);

  useEffect(() => {
    const goBack = () => {
      if (selected) setSelected(null);
      else if (tab !== "downloads") setTab("downloads");
    };
    window.addEventListener("popstate", goBack);
    return () => window.removeEventListener("popstate", goBack);
  }, [selected, tab]);

  const openTab = (next: Tab) => {
    if (next !== tab || selected) history.pushState({ orcMobile: next }, "");
    setSelected(null);
    setTab(next);
  };

  const chooseStorage = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.chooseDownloadTree();
      if (!result.granted) return;
      const value = await bridge.bootstrap();
      if (!value) throw new Error("Android bootstrap is unavailable");
      await finishBootstrap(value);
      const next = { allowCellular: false, killSwitchEnabled: onboardingKillSwitch };
      await bridge.setTransferPolicy(next);
      setBootstrap({ ...value, ...next });
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const act = async (torrent: Torrent, action: "start" | "stop") => {
    setBusy(true);
    try {
      if (action === "start" && bootstrap?.killSwitchEnabled && !bootstrap.vpnActive) {
        throw new Error("Connect your VPN, refresh Privacy status, then resume manually");
      }
      await postJson(`/torrents/${torrent.id}/${action}`);
      if (action === "start" && bootstrap) {
        await bridge.setTransferPolicy(bootstrap);
      }
      await refresh();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (torrent: Torrent, deleteData: boolean) => {
    const wording = deleteData ? "remove this torrent and permanently delete its downloaded files" : "remove this torrent but keep its files";
    if (!window.confirm(`Do you want to ${wording}?`)) return;
    setBusy(true);
    try {
      await postJson(`/torrents/${torrent.id}/remove`, { delete_data: deleteData });
      setSelected(null);
      await refresh();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const updatePolicy = async (changes: Partial<Pick<AndroidBootstrap, "allowCellular" | "killSwitchEnabled">>) => {
    if (!bootstrap) return;
    const next = { ...bootstrap, ...changes };
    setBootstrap(next);
    try {
      await bridge.setTransferPolicy(next);
    } catch (reason) {
      setBootstrap(bootstrap);
      setError(messageOf(reason));
    }
  };

  const updateSeeding = async (next: SeedingSettings) => {
    const previous = seeding;
    setSeeding(next);
    try {
      await patchJson("/seeding", next);
    } catch (reason) {
      setSeeding(previous);
      setError(messageOf(reason));
    }
  };

  const totals = useMemo(
    () => Object.values(statuses).reduce((sum, status) => sum + status.down_rate_bps, 0),
    [statuses]
  );

  if (!bootstrap) {
    return <main className="mobile-shell mobile-centered"><div className="orc-spinner" /><p>Starting ORC…</p>{error && <p className="mobile-error">{error}</p>}</main>;
  }

  if (!bootstrap.storageReady) {
    return (
      <main className="mobile-shell onboarding">
        <div className="brand-mark">O</div>
        <p className="eyebrow">ORC TORRENT · ANDROID</p>
        <h1>Your downloads.<br />Your folder.</h1>
        <p className="lead">Choose an ORC subfolder in shared storage. Android keeps the files there even if the app is removed.</p>
        <div className="onboarding-note"><strong>Choose a subfolder</strong><span>Android does not allow apps to use the top-level Downloads folder. Create or select something like Downloads/ORC.</span></div>
        <label className="switch-row">
          <span><strong>VPN kill switch</strong><small>Pause all peer traffic when the VPN disconnects</small></span>
          <input type="checkbox" checked={onboardingKillSwitch} onChange={(event) => setOnboardingKillSwitch(event.target.checked)} />
        </label>
        <button className="primary-button" onClick={() => void chooseStorage()} disabled={busy}>{busy ? "Opening…" : "Choose download folder"}</button>
        {error && <p className="mobile-error">{error}</p>}
      </main>
    );
  }

  const selectedStatus = selected ? statuses[selected.id] : null;

  return (
    <main className="mobile-shell">
      <header className="mobile-header">
        <div><p className="eyebrow">ORC TORRENT</p><h1>{selected ? selected.name : tab === "downloads" ? "Downloads" : tab[0].toUpperCase() + tab.slice(1)}</h1></div>
        {selected ? <button className="icon-button" aria-label="Back" onClick={() => setSelected(null)}>←</button> : <div className={`connection-dot ${bootstrap.vpnActive ? "protected" : ""}`} title={bootstrap.vpnActive ? "VPN connected" : "VPN not connected"} />}
      </header>

      {notice && <button className="notice" onClick={() => setNotice(null)}>{notice}</button>}
      {error && <button className="mobile-error error-banner" onClick={() => setError(null)}>{error}</button>}

      <section className="mobile-content">
        {selected ? (
          <TorrentDetail torrent={selected} status={selectedStatus} content={content} busy={busy} onAction={act} onRemove={remove} onPriority={async (file, priority) => {
            await patchJson(`/torrents/${selected.id}/file-priority`, { path: file.path, priority });
            setContent((current) => current ? { files: current.files.map((item) => item.path.join("/") === file.path.join("/") ? { ...item, priority } : item) } : current);
          }} onOpen={(index) => bridge.openDownloadedFile(selected.id, index)} onShare={(index) => bridge.shareDownloadedFile(selected.id, index)} />
        ) : tab === "downloads" ? (
          <>
            <div className="summary-card"><span>{torrents.length} torrents</span><strong>↓ {speed(totals)}</strong></div>
            <div className="torrent-list">
              {torrents.map((torrent) => <TorrentCard key={torrent.id} torrent={torrent} status={statuses[torrent.id]} onOpen={() => { history.pushState({ torrent: torrent.id }, ""); setSelected(torrent); }} onAction={act} />)}
              {!torrents.length && <div className="empty-state"><div>↓</div><h2>No torrents yet</h2><p>Add a magnet link or a .torrent file to begin.</p><button onClick={() => openTab("add")}>Add torrent</button></div>}
            </div>
          </>
        ) : tab === "add" ? (
          <div className="panel-stack">
            <section className="mobile-panel"><h2>Add magnet link</h2><textarea value={magnet} onChange={(event) => setMagnet(event.target.value)} placeholder="magnet:?xt=urn:btih:…" /><button className="primary-button" onClick={() => void addTorrent(undefined, magnet)} disabled={busy || !magnet.trim()}>{busy ? "Adding…" : "Add magnet"}</button></section>
            <div className="or-rule"><span>or</span></div>
            <button className="file-picker" onClick={() => void bridge.pickTorrentFile().then((file) => file && addTorrent(file))}><strong>Choose .torrent file</strong><span>Open from Files, Drive, or another app</span></button>
          </div>
        ) : tab === "privacy" ? (
          <div className="panel-stack">
            <section className="privacy-hero"><span className={bootstrap.vpnActive ? "shield active" : "shield"}>◆</span><h2>{bootstrap.vpnActive ? "VPN protected" : "VPN not detected"}</h2><p>{bootstrap.killSwitchEnabled ? "Kill switch is armed. Transfers pause if this VPN disappears." : "Transfers use the active Android network."}</p></section>
            <label className="switch-row mobile-panel"><span><strong>VPN kill switch</strong><small>Requires a connected Android VPN before transfers can run</small></span><input type="checkbox" checked={bootstrap.killSwitchEnabled} onChange={(event) => void updatePolicy({ killSwitchEnabled: event.target.checked })} /></label>
            <button className="secondary-button" onClick={() => void bridge.bootstrap().then((value) => value && setBootstrap(value))}>Refresh VPN status</button>
          </div>
        ) : (
          <div className="panel-stack">
            <section className="mobile-panel"><h2>Network</h2><label className="switch-row"><span><strong>Allow cellular data</strong><small>Off by default. Active work is rescheduled when changed.</small></span><input type="checkbox" checked={bootstrap.allowCellular} onChange={(event) => void updatePolicy({ allowCellular: event.target.checked })} /></label></section>
            <section className="mobile-panel"><h2>Seeding</h2><label className="switch-row"><span><strong>Stop at ratio</strong><small>Default is 1.0, on Wi-Fi</small></span><input type="checkbox" checked={seeding.ratio_limit_enabled} onChange={(event) => void updateSeeding({ ...seeding, ratio_limit_enabled: event.target.checked })} /></label><label className="number-row"><span>Ratio limit</span><input type="number" min="0" step="0.1" value={seeding.ratio_limit} onChange={(event) => void updateSeeding({ ...seeding, ratio_limit: Math.max(0, Number(event.target.value)) })} /></label><label className="switch-row"><span><strong>Time limit</strong><small>Optionally stop after a number of minutes</small></span><input type="checkbox" checked={seeding.seed_time_limit_enabled} onChange={(event) => void updateSeeding({ ...seeding, seed_time_limit_enabled: event.target.checked })} /></label>{seeding.seed_time_limit_enabled && <label className="number-row"><span>Minutes</span><input type="number" min="1" value={seeding.seed_time_minutes} onChange={(event) => void updateSeeding({ ...seeding, seed_time_minutes: Math.max(1, Number(event.target.value)) })} /></label>}</section>
            <section className="mobile-panel"><h2>Storage</h2><p>{bootstrap.storageLabel || "ORC folder"}</p><button className="secondary-button" onClick={() => void chooseStorage()}>Reconnect or change folder</button><small>Changing folders requires an empty torrent queue. Reselect the same folder to restore access.</small></section>
            <section className="mobile-panel about"><h2>About</h2><p>ORC Torrent for Android</p><a href="https://github.com/The-animus-project/Orc-Torrent/releases" target="_blank" rel="noreferrer">GitHub releases ↗</a></section>
          </div>
        )}
      </section>

      {!selected && <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton active={tab === "downloads"} label="Downloads" icon="↓" onClick={() => openTab("downloads")} />
        <NavButton active={tab === "add"} label="Add" icon="＋" onClick={() => openTab("add")} />
        <NavButton active={tab === "privacy"} label="Privacy" icon="◆" onClick={() => openTab("privacy")} />
        <NavButton active={tab === "settings"} label="Settings" icon="⚙" onClick={() => openTab("settings")} />
      </nav>}
    </main>
  );
}

function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: string; onClick(): void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span><small>{label}</small></button>;
}

function TorrentCard({ torrent, status, onOpen, onAction }: { torrent: Torrent; status?: TorrentStatus; onOpen(): void; onAction(torrent: Torrent, action: "start" | "stop"): void }) {
  const progress = Math.max(0, Math.min(100, (status?.progress ?? 0) * 100));
  return <article className="torrent-card"><button className="card-main" onClick={onOpen}><div className="card-title"><strong>{torrent.name}</strong><span>{Math.round(progress)}%</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="card-meta"><span className={`state ${status?.state ?? "stopped"}`}>{status?.state ?? "stopped"}</span><span>↓ {speed(status?.down_rate_bps)} · ↑ {speed(status?.up_rate_bps)}</span></div></button><button className="round-action" aria-label={torrent.running ? "Pause" : "Resume"} onClick={() => void onAction(torrent, torrent.running ? "stop" : "start")}>{torrent.running ? "Ⅱ" : "▶"}</button></article>;
}

function TorrentDetail({ torrent, status, content, busy, onAction, onRemove, onPriority, onOpen, onShare }: { torrent: Torrent; status: TorrentStatus | null | undefined; content: Content | null; busy: boolean; onAction(torrent: Torrent, action: "start" | "stop"): void; onRemove(torrent: Torrent, deleteData: boolean): void; onPriority(file: ContentFile, priority: ContentFile["priority"]): Promise<void>; onOpen(index: number): Promise<boolean>; onShare(index: number): Promise<boolean> }) {
  const progress = Math.max(0, Math.min(100, (status?.progress ?? 0) * 100));
  return <div className="panel-stack detail"><section className="detail-hero"><div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><span>{Math.round(progress)}%</span></div><div><span className={`state ${status?.state ?? "stopped"}`}>{status?.state ?? "stopped"}</span><p>{bytes(status?.downloaded_bytes)} of {bytes(status?.total_bytes)}</p><p>↓ {speed(status?.down_rate_bps)} · ↑ {speed(status?.up_rate_bps)}</p><p>Ratio {(status?.ratio ?? 0).toFixed(2)} · {status?.peers_seen ?? 0} peers</p></div></section><div className="detail-actions"><button className="primary-button" disabled={busy} onClick={() => void onAction(torrent, torrent.running ? "stop" : "start")}>{torrent.running ? "Pause" : "Resume"}</button><button className="secondary-button" onClick={() => void onRemove(torrent, false)}>Remove</button></div><section className="mobile-panel"><h2>Files</h2>{content?.files.map((file, index) => <div className="file-row" key={`${index}-${file.path.join("/")}`}><div><strong>{file.path.at(-1)}</strong><small>{bytes(file.size)} · {file.downloaded ? "Complete" : file.priority}</small></div><select aria-label={`Priority for ${file.path.at(-1)}`} value={file.priority} onChange={(event) => void onPriority(file, event.target.value as ContentFile["priority"])}><option value="skip">Skip</option><option value="normal">Normal</option><option value="high">High</option></select>{file.downloaded && <div className="file-actions"><button onClick={() => void onOpen(index)}>Open</button><button onClick={() => void onShare(index)}>Share</button></div>}</div>)}{!content && <p>Loading files…</p>}</section><section className="danger-zone"><button onClick={() => void onRemove(torrent, true)}>Remove and delete data</button></section></div>;
}
