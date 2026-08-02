# Search providers

Orc Torrent search is display-only until you explicitly add a torrent. Phase 1 adds native **Torznab** providers so you can connect self-hosted indexers such as Jackett or Prowlarr without embedding scrapers or running unrestricted Python plugins.

## What Torznab is

Torznab is an HTTP API (RSS/XML based, Newznab-compatible) used by aggregator tools. A Torznab endpoint accepts query parameters such as `t=search`, `q=…`, optional `cat=…`, and usually an `apikey`. Orc talks to that endpoint, normalises results into the existing `SearchResult` model, and shows them in Search.

## Why Torznab instead of Python search plugins

qBittorrent-style `.py` search plugins execute arbitrary code. Orc deliberately does **not** run unrestricted scripts in the daemon. Torznab gives broad indexer coverage through services you control, while keeping network, timeout, SSRF, and secret-handling policy inside Orc.

## Connecting Jackett

1. Install and start [Jackett](https://github.com/Jackett/Jackett) locally (commonly `http://127.0.0.1:9117`).
2. In Jackett, open an indexer (or “All”) and copy the **Torznab feed** URL.
3. Copy the Jackett **API Key**.
4. In Orc: **Settings → Search → Add Torznab provider**.
5. Paste the endpoint URL and API key.
6. Enable **Allow local/private endpoint** when using loopback or LAN addresses.
7. Save, then click **Test**.

Example endpoint shape:

```text
http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/
```

## Connecting Prowlarr

1. Install and start [Prowlarr](https://github.com/Prowlarr/Prowlarr).
2. Open an indexer’s Torznab URL (or the aggregated Torznab endpoint).
3. Copy the Prowlarr API key.
4. Add a Torznab provider in Orc as above, including local/private consent for loopback/LAN hosts.
5. Save and **Test**.

## API keys and storage

- API keys are **not** stored in `config.json`.
- Keys are stored in the OS credential store when available, otherwise in an encrypted file under the Orc config directory.
- GET settings responses only expose `has_credentials` / “API key saved”.
- Keys are never returned to the UI after save and must not be logged.

Credential routes:

- `PUT /search/providers/:name/credentials`
- `DELETE /search/providers/:name/credentials`
- `POST /search/providers/:name/test`
- `DELETE /search/providers/:name` (custom providers only; also deletes the stored secret)

## Local / private endpoints

Private URL access is **off by default** and is per Torznab provider (`allow_private_url`).

Enable this only for a Jackett, Prowlarr or Torznab service you control.

When disabled, Orc rejects loopback, RFC1918, and link-local hosts for that provider endpoint. When enabled, Orc still:

- rejects embedded URL credentials
- validates redirects
- blocks redirects from the approved host to an unrelated private host

A separate global setting (`allow_private_remote_urls`) continues to control private URLs for non-Torznab custom feeds / result links and is not a global Torznab bypass.

## Categories

Torznab categories are numeric IDs (for example `2000` movies, `5000` TV). Enter them as a comma-separated list in the provider form. Orc sends them as `cat=…` on search requests.

## Testing a provider

**Test** calls `t=caps` and reports:

- reachability
- XML validity / Torznab capabilities
- authentication success/failure
- whether search is advertised
- category count
- latency

Failures are sanitised (no API keys, raw XML, or full secret-bearing URLs).

## Provider failures during search

Searches fan out concurrently (bounded). One timed-out or failing provider does not cancel others. The Search page shows per-provider status (including latency / timeout) while still displaying successful results.

## Legal use and endorsement

- Orc does **not** maintain or endorse third-party torrent indexes.
- Users are responsible for lawful use of any indexer they configure.
- Search never automatically downloads content; adding a torrent always requires an explicit user action.

## Related docs

- [Search plugin architecture (future)](SEARCH_PLUGIN_ARCHITECTURE.md)
- [Configuration](CONFIGURATION.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
