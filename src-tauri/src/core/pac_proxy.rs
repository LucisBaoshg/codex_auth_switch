use super::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const PAC_PROXY_URL: &str = "http://10.12.0.24/proxy.pac";
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;
const WINDOWS_PROXY_SCRIPT_SERVICE: &str = "Windows 设置脚本";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PacProxyStatus {
    pub supported: bool,
    pub enabled: bool,
    pub pac_url: String,
    pub available_services: Vec<String>,
    pub selected_services: Vec<String>,
    pub services: Vec<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PacProxySettings {
    #[serde(default)]
    selected_services: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MacosAutoProxyStatus {
    pub service: String,
    pub enabled: bool,
    pub url: Option<String>,
}

pub fn parse_macos_auto_proxy_status(
    service: impl Into<String>,
    output: &str,
) -> MacosAutoProxyStatus {
    let mut url = None;
    let mut enabled = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("URL:") {
            let value = value.trim();
            if !value.is_empty() {
                url = Some(value.to_string());
            }
        } else if let Some(value) = trimmed.strip_prefix("Enabled:") {
            let value = value.trim();
            enabled = matches!(
                value.to_ascii_lowercase().as_str(),
                "yes" | "on" | "true" | "1"
            );
        }
    }

    MacosAutoProxyStatus {
        service: service.into(),
        enabled,
        url,
    }
}

pub fn pac_proxy_status_from_macos_services(services: Vec<MacosAutoProxyStatus>) -> PacProxyStatus {
    pac_proxy_status_from_macos_services_with_selection(services, Vec::new())
}

pub fn pac_proxy_status_from_macos_services_with_selection(
    services: Vec<MacosAutoProxyStatus>,
    selected_services: Vec<String>,
) -> PacProxyStatus {
    let available_services = services
        .iter()
        .map(|service| service.service.clone())
        .collect::<Vec<_>>();
    let selected_services = normalize_selected_services(selected_services, &available_services);
    let active_services = services
        .into_iter()
        .filter(|service| {
            selected_services.contains(&service.service)
                && service.enabled
                && service.url.as_deref() == Some(PAC_PROXY_URL)
        })
        .map(|service| service.service)
        .collect::<Vec<_>>();

    PacProxyStatus {
        supported: true,
        enabled: !active_services.is_empty(),
        pac_url: PAC_PROXY_URL.into(),
        available_services,
        selected_services,
        services: active_services,
        message: None,
    }
}

pub fn parse_windows_auto_config_url(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let trimmed = line.trim();
        if !trimmed.starts_with("AutoConfigURL") {
            return None;
        }

        let parts = trimmed.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 3 || parts[0] != "AutoConfigURL" {
            return None;
        }

        let value = parts[2..].join(" ");
        if value.trim().is_empty() {
            None
        } else {
            Some(value)
        }
    })
}

pub fn windows_pac_proxy_status_from_auto_config_url(
    auto_config_url: Option<String>,
) -> PacProxyStatus {
    let enabled = auto_config_url.as_deref().map(str::trim) == Some(PAC_PROXY_URL);
    let service = WINDOWS_PROXY_SCRIPT_SERVICE.to_string();

    PacProxyStatus {
        supported: true,
        enabled,
        pac_url: PAC_PROXY_URL.into(),
        available_services: vec![service.clone()],
        selected_services: vec![service.clone()],
        services: if enabled { vec![service] } else { Vec::new() },
        message: None,
    }
}

pub fn windows_registry_command_creation_flags() -> u32 {
    WINDOWS_CREATE_NO_WINDOW
}

pub fn unsupported_pac_proxy_status() -> PacProxyStatus {
    PacProxyStatus {
        supported: false,
        enabled: false,
        pac_url: PAC_PROXY_URL.into(),
        available_services: Vec::new(),
        selected_services: Vec::new(),
        services: Vec::new(),
        message: Some("当前平台暂不支持自动切换 PAC。".into()),
    }
}

pub fn get_pac_proxy_status(app_data_dir: PathBuf) -> Result<PacProxyStatus, AppError> {
    platform_pac_proxy_status(&app_data_dir)
}

pub fn set_pac_proxy_enabled(
    app_data_dir: PathBuf,
    enabled: bool,
) -> Result<PacProxyStatus, AppError> {
    platform_set_pac_proxy_enabled(&app_data_dir, enabled)
}

pub fn set_pac_proxy_selected_services(
    app_data_dir: PathBuf,
    selected_services: Vec<String>,
) -> Result<PacProxyStatus, AppError> {
    platform_set_pac_proxy_selected_services(&app_data_dir, selected_services)
}

#[cfg(target_os = "macos")]
fn platform_pac_proxy_status(app_data_dir: &Path) -> Result<PacProxyStatus, AppError> {
    let services = macos_network_services()?;
    if services.is_empty() {
        return Ok(PacProxyStatus {
            supported: true,
            enabled: false,
            pac_url: PAC_PROXY_URL.into(),
            available_services: Vec::new(),
            selected_services: Vec::new(),
            services: Vec::new(),
            message: Some("未找到可配置的网络服务。".into()),
        });
    }

    let statuses = services
        .into_iter()
        .filter_map(|service| {
            macos_auto_proxy_status(&service)
                .map_err(|error| {
                    eprintln!("Failed to read PAC status for {service}: {error}");
                    error
                })
                .ok()
        })
        .collect::<Vec<_>>();

    let selected_services = read_pac_proxy_settings(app_data_dir)?.selected_services;
    Ok(pac_proxy_status_from_macos_services_with_selection(
        statuses,
        selected_services,
    ))
}

#[cfg(target_os = "macos")]
fn platform_set_pac_proxy_enabled(
    app_data_dir: &Path,
    enabled: bool,
) -> Result<PacProxyStatus, AppError> {
    let services = macos_network_services()?;
    if services.is_empty() {
        return Ok(PacProxyStatus {
            supported: true,
            enabled: false,
            pac_url: PAC_PROXY_URL.into(),
            available_services: Vec::new(),
            selected_services: Vec::new(),
            services: Vec::new(),
            message: Some("未找到可配置的网络服务。".into()),
        });
    }

    let selected_services = normalize_selected_services(
        read_pac_proxy_settings(app_data_dir)?.selected_services,
        &services,
    );
    if enabled {
        for service in &services {
            if selected_services.contains(service) {
                run_networksetup(&["-setautoproxyurl", service, PAC_PROXY_URL])?;
                run_networksetup(&["-setautoproxystate", service, "on"])?;
            } else if let Ok(status) = macos_auto_proxy_status(service) {
                if status.enabled && status.url.as_deref() == Some(PAC_PROXY_URL) {
                    run_networksetup(&["-setautoproxystate", service, "off"])?;
                }
            }
        }
    } else {
        for status in services
            .iter()
            .filter_map(|service| macos_auto_proxy_status(service).ok())
        {
            if status.enabled && status.url.as_deref() == Some(PAC_PROXY_URL) {
                run_networksetup(&["-setautoproxystate", &status.service, "off"])?;
            }
        }
    }

    platform_pac_proxy_status(app_data_dir)
}

#[cfg(target_os = "macos")]
fn platform_set_pac_proxy_selected_services(
    app_data_dir: &Path,
    selected_services: Vec<String>,
) -> Result<PacProxyStatus, AppError> {
    let services = macos_network_services()?;
    let selected_services = normalize_selected_services(selected_services, &services);
    write_pac_proxy_settings(
        app_data_dir,
        &PacProxySettings {
            selected_services: selected_services.clone(),
        },
    )?;

    let currently_enabled = services
        .iter()
        .filter_map(|service| macos_auto_proxy_status(service).ok())
        .any(|status| status.enabled && status.url.as_deref() == Some(PAC_PROXY_URL));

    if currently_enabled {
        platform_set_pac_proxy_enabled(app_data_dir, true)
    } else {
        platform_pac_proxy_status(app_data_dir)
    }
}

#[cfg(target_os = "windows")]
fn platform_pac_proxy_status(_app_data_dir: &Path) -> Result<PacProxyStatus, AppError> {
    Ok(windows_pac_proxy_status_from_auto_config_url(
        windows_auto_config_url()?,
    ))
}

#[cfg(target_os = "windows")]
fn platform_set_pac_proxy_enabled(
    app_data_dir: &Path,
    enabled: bool,
) -> Result<PacProxyStatus, AppError> {
    if enabled {
        run_windows_reg(&[
            "add",
            WINDOWS_INTERNET_SETTINGS_KEY,
            "/v",
            "AutoConfigURL",
            "/t",
            "REG_SZ",
            "/d",
            PAC_PROXY_URL,
            "/f",
        ])?;
        windows_notify_proxy_settings_changed();
    } else {
        let current_url = windows_auto_config_url()?;
        if current_url.as_deref().map(str::trim) == Some(PAC_PROXY_URL) {
            run_windows_reg(&[
                "delete",
                WINDOWS_INTERNET_SETTINGS_KEY,
                "/v",
                "AutoConfigURL",
                "/f",
            ])?;
            windows_notify_proxy_settings_changed();
        }
    }

    platform_pac_proxy_status(app_data_dir)
}

#[cfg(target_os = "windows")]
fn platform_set_pac_proxy_selected_services(
    app_data_dir: &Path,
    _selected_services: Vec<String>,
) -> Result<PacProxyStatus, AppError> {
    platform_pac_proxy_status(app_data_dir)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn platform_pac_proxy_status(_app_data_dir: &Path) -> Result<PacProxyStatus, AppError> {
    Ok(unsupported_pac_proxy_status())
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn platform_set_pac_proxy_enabled(
    _app_data_dir: &Path,
    _enabled: bool,
) -> Result<PacProxyStatus, AppError> {
    Ok(unsupported_pac_proxy_status())
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn platform_set_pac_proxy_selected_services(
    _app_data_dir: &Path,
    _selected_services: Vec<String>,
) -> Result<PacProxyStatus, AppError> {
    Ok(unsupported_pac_proxy_status())
}

fn normalize_selected_services(
    selected_services: Vec<String>,
    available_services: &[String],
) -> Vec<String> {
    let trimmed = selected_services
        .into_iter()
        .map(|service| service.trim().to_string())
        .filter(|service| !service.is_empty())
        .collect::<Vec<_>>();
    let source = if trimmed.is_empty() {
        available_services.to_vec()
    } else {
        trimmed
    };

    let mut normalized = Vec::new();
    for service in available_services {
        if source.iter().any(|selected| selected == service) && !normalized.contains(service) {
            normalized.push(service.clone());
        }
    }
    if normalized.is_empty() && !available_services.is_empty() {
        available_services.to_vec()
    } else {
        normalized
    }
}

fn pac_proxy_settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("pac-proxy-settings.json")
}

fn read_pac_proxy_settings(app_data_dir: &Path) -> Result<PacProxySettings, AppError> {
    let path = pac_proxy_settings_path(app_data_dir);
    if !path.exists() {
        return Ok(PacProxySettings::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn write_pac_proxy_settings(
    app_data_dir: &Path,
    settings: &PacProxySettings,
) -> Result<(), AppError> {
    fs::create_dir_all(app_data_dir)?;
    fs::write(
        pac_proxy_settings_path(app_data_dir),
        serde_json::to_string_pretty(settings)?,
    )?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_network_services() -> Result<Vec<String>, AppError> {
    let output = run_networksetup(&["-listallnetworkservices"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("An asterisk"))
        .filter(|line| !line.starts_with('*'))
        .map(str::to_string)
        .collect())
}

#[cfg(target_os = "macos")]
fn macos_auto_proxy_status(service: &str) -> Result<MacosAutoProxyStatus, AppError> {
    let output = run_networksetup(&["-getautoproxyurl", service])?;
    Ok(parse_macos_auto_proxy_status(service, &output))
}

#[cfg(target_os = "macos")]
fn run_networksetup(args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("networksetup").args(args).output()?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if stderr.is_empty() { stdout } else { stderr };
    Err(AppError::Message(if message.is_empty() {
        "networksetup 执行失败。".into()
    } else {
        message
    }))
}

#[cfg(target_os = "windows")]
const WINDOWS_INTERNET_SETTINGS_KEY: &str =
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";

#[cfg(target_os = "windows")]
fn windows_auto_config_url() -> Result<Option<String>, AppError> {
    let output = windows_reg_command(&[
        "query",
        WINDOWS_INTERNET_SETTINGS_KEY,
        "/v",
        "AutoConfigURL",
    ])
    .output()?;

    if output.status.success() {
        return Ok(parse_windows_auto_config_url(&String::from_utf8_lossy(
            &output.stdout,
        )));
    }

    Ok(None)
}

#[cfg(target_os = "windows")]
fn run_windows_reg(args: &[&str]) -> Result<String, AppError> {
    let output = windows_reg_command(args).output()?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if stderr.is_empty() { stdout } else { stderr };
    Err(AppError::Message(if message.is_empty() {
        "reg 执行失败。".into()
    } else {
        message
    }))
}

#[cfg(target_os = "windows")]
fn windows_reg_command(args: &[&str]) -> Command {
    let mut command = Command::new("reg");
    command.args(args);
    command.creation_flags(windows_registry_command_creation_flags());
    command
}

#[cfg(target_os = "windows")]
fn windows_notify_proxy_settings_changed() {
    unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
    }
}

#[cfg(target_os = "windows")]
const INTERNET_OPTION_REFRESH: u32 = 37;
#[cfg(target_os = "windows")]
const INTERNET_OPTION_SETTINGS_CHANGED: u32 = 39;

#[cfg(target_os = "windows")]
#[link(name = "wininet")]
extern "system" {
    fn InternetSetOptionW(
        h_internet: *mut std::ffi::c_void,
        option: u32,
        buffer: *mut std::ffi::c_void,
        buffer_length: u32,
    ) -> i32;
}
