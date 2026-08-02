//! Network introspection helpers for the desktop Network page.

use std::process::Command;

use network_interface::{NetworkInterface, NetworkInterfaceConfig};
use serde::{Deserialize, Serialize};

use crate::{now_ms, vpn_status};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkAdapter {
    pub name: String,
    pub interface_type: String,
    pub status: String,
    pub gateway: Option<String>,
    pub is_default_route: bool,
    pub is_vpn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkAdaptersResponse {
    pub adapters: Vec<NetworkAdapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultRoute {
    pub interface: Option<String>,
    pub gateway: Option<String>,
    pub metric: Option<u32>,
    pub last_update_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsConfig {
    pub primary: Option<String>,
    pub secondary: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TorStatusState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TorSource {
    Embedded,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorState {
    pub status: TorStatusState,
    pub socks_addr: Option<String>,
    pub source: TorSource,
    pub last_check_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn list_network_adapters() -> NetworkAdaptersResponse {
    let default_iface = default_route_info().interface;
    let vpn_iface = vpn_status().interface_name;

    let adapters = match NetworkInterface::show() {
        Ok(interfaces) => interfaces
            .into_iter()
            .map(|iface| {
                adapter_from_interface(&iface, default_iface.as_deref(), vpn_iface.as_deref())
            })
            .collect(),
        Err(_) => Vec::new(),
    };

    NetworkAdaptersResponse { adapters }
}

pub fn default_route_info() -> DefaultRoute {
    let now = now_ms();
    #[cfg(target_os = "macos")]
    {
        if let Some((interface, gateway, metric)) = macos_default_route() {
            return DefaultRoute {
                interface: Some(interface),
                gateway,
                metric,
                last_update_ms: now,
            };
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Some((interface, gateway, metric)) = linux_default_route() {
            return DefaultRoute {
                interface: Some(interface),
                gateway,
                metric,
                last_update_ms: now,
            };
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some((interface, gateway, metric)) = windows_default_route() {
            return DefaultRoute {
                interface: Some(interface),
                gateway,
                metric,
                last_update_ms: now,
            };
        }
    }

    DefaultRoute {
        interface: vpn_status().default_route_interface,
        gateway: None,
        metric: None,
        last_update_ms: now,
    }
}

pub fn dns_config() -> DnsConfig {
    #[cfg(target_os = "macos")]
    {
        if let Some(config) = macos_dns_config() {
            return config;
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(config) = linux_dns_config() {
            return config;
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(config) = windows_dns_config() {
            return config;
        }
    }

    DnsConfig {
        primary: None,
        secondary: None,
        source: "unavailable".to_string(),
    }
}

pub fn tor_status() -> TorState {
    TorState {
        status: TorStatusState::Disconnected,
        socks_addr: None,
        source: TorSource::External,
        last_check_ms: now_ms(),
        error: None,
    }
}

fn adapter_from_interface(
    iface: &NetworkInterface,
    default_iface: Option<&str>,
    vpn_iface: Option<&str>,
) -> NetworkAdapter {
    let name = iface.name.clone();
    let lowered = name.to_lowercase();
    let has_addr = !iface.addr.is_empty();
    let is_vpn = vpn_iface == Some(name.as_str()) || is_likely_vpn_name(&lowered);

    NetworkAdapter {
        gateway: None,
        is_default_route: default_iface == Some(name.as_str()),
        is_vpn,
        interface_type: classify_interface_type(&lowered, is_vpn),
        status: if has_addr {
            "up".to_string()
        } else {
            "down".to_string()
        },
        name,
    }
}

fn classify_interface_type(name: &str, is_vpn: bool) -> String {
    if is_vpn {
        return "vpn".to_string();
    }
    if name.starts_with("lo") || name.contains("loopback") {
        return "loopback".to_string();
    }
    if name.starts_with("en")
        || name.starts_with("eth")
        || name.contains("ethernet")
        || name.starts_with("bridge")
    {
        return "ethernet".to_string();
    }
    if name.starts_with("wl") || name.contains("wifi") || name.contains("wlan") {
        return "wifi".to_string();
    }
    if name.starts_with("utun") || name.starts_with("tun") || name.starts_with("tap") {
        return "tunnel".to_string();
    }
    "other".to_string()
}

fn is_likely_vpn_name(name: &str) -> bool {
    name.contains("nord")
        || name.contains("mullvad")
        || name.contains("wireguard")
        || name.contains("openvpn")
        || name.contains("proton")
        || name.contains("tailscale")
        || name.contains("wintun")
        || name.starts_with("utun")
        || name.starts_with("tun")
        || name.starts_with("tap")
        || name.starts_with("wg")
}

#[cfg(target_os = "macos")]
fn macos_default_route() -> Option<(String, Option<String>, Option<u32>)> {
    let output = Command::new("route")
        .args(["-n", "get", "default"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let mut interface = None;
    let mut gateway = None;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("interface:") {
            let value = rest.trim();
            if !value.is_empty() {
                interface = Some(value.to_string());
            }
        } else if let Some(rest) = trimmed.strip_prefix("gateway:") {
            let value = rest.trim();
            if !value.is_empty() {
                gateway = Some(value.to_string());
            }
        }
    }
    interface.map(|iface| (iface, gateway, None))
}

#[cfg(not(target_os = "macos"))]
fn macos_default_route() -> Option<(String, Option<String>, Option<u32>)> {
    None
}

#[cfg(target_os = "linux")]
fn linux_default_route() -> Option<(String, Option<String>, Option<u32>)> {
    let output = Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let line = stdout.lines().next()?;
    let mut gateway = None;
    let mut interface = None;
    let mut metric = None;
    let mut parts = line.split_whitespace();
    while let Some(part) = parts.next() {
        match part {
            "via" => gateway = parts.next().map(str::to_string),
            "dev" => interface = parts.next().map(str::to_string),
            "metric" => metric = parts.next().and_then(|v| v.parse().ok()),
            _ => {}
        }
    }
    interface.map(|iface| (iface, gateway, metric))
}

#[cfg(not(target_os = "linux"))]
fn linux_default_route() -> Option<(String, Option<String>, Option<u32>)> {
    None
}

#[cfg(target_os = "windows")]
fn windows_default_route() -> Option<(String, Option<String>, Option<u32>)> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1 InterfaceAlias,NextHop,RouteMetric | ConvertTo-Json -Compress",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    let interface = value.get("InterfaceAlias")?.as_str()?.to_string();
    let gateway = value
        .get("NextHop")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let metric = value
        .get("RouteMetric")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    Some((interface, gateway, metric))
}

#[cfg(not(target_os = "windows"))]
fn windows_default_route() -> Option<(String, Option<String>, Option<u32>)> {
    None
}

#[cfg(target_os = "macos")]
fn macos_dns_config() -> Option<DnsConfig> {
    let output = Command::new("scutil").args(["--dns"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let servers: Vec<String> = stdout
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix("nameserver[")
                .and_then(|rest| rest.split(':').nth(1))
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .collect();
    if servers.is_empty() {
        return None;
    }
    Some(DnsConfig {
        primary: servers.first().cloned(),
        secondary: servers.get(1).cloned(),
        source: "scutil".to_string(),
    })
}

#[cfg(not(target_os = "macos"))]
fn macos_dns_config() -> Option<DnsConfig> {
    None
}

#[cfg(target_os = "linux")]
fn linux_dns_config() -> Option<DnsConfig> {
    let content = std::fs::read_to_string("/etc/resolv.conf").ok()?;
    let servers: Vec<String> = content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix("nameserver")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .collect();
    if servers.is_empty() {
        return None;
    }
    Some(DnsConfig {
        primary: servers.first().cloned(),
        secondary: servers.get(1).cloned(),
        source: "resolv.conf".to_string(),
    })
}

#[cfg(not(target_os = "linux"))]
fn linux_dns_config() -> Option<DnsConfig> {
    None
}

#[cfg(target_os = "windows")]
fn windows_dns_config() -> Option<DnsConfig> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count -gt 0 } | Select-Object -First 1 -ExpandProperty ServerAddresses | ConvertTo-Json -Compress",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let servers: Vec<String> = match serde_json::from_str(stdout.trim()) {
        Ok(serde_json::Value::Array(values)) => values
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        Ok(serde_json::Value::String(value)) => vec![value],
        _ => Vec::new(),
    };
    if servers.is_empty() {
        return None;
    }
    Some(DnsConfig {
        primary: servers.first().cloned(),
        secondary: servers.get(1).cloned(),
        source: "Get-DnsClientServerAddress".to_string(),
    })
}

#[cfg(not(target_os = "windows"))]
fn windows_dns_config() -> Option<DnsConfig> {
    None
}
