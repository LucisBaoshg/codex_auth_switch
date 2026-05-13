use crate::core::{
    default_codex_target_dir, restart_codex_script, set_codex_pet_overlay_open, AppError,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::{connect, Message};

const DEFAULT_CDP_WAIT_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexEnhanceLaunchResult {
    pub debug_port: u16,
    pub target_id: String,
    pub websocket_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexCdpTarget {
    pub id: String,
    #[serde(rename = "type")]
    pub target_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub web_socket_debugger_url: Option<String>,
}

pub fn build_codex_debug_arguments(debug_port: u16) -> Vec<String> {
    vec![
        format!("--remote-debugging-port={debug_port}"),
        format!("--remote-allow-origins=http://127.0.0.1:{debug_port}"),
    ]
}

pub fn pick_cdp_page_target(targets: &[CodexCdpTarget]) -> Option<CodexCdpTarget> {
    let pages = targets
        .iter()
        .filter(|target| target.target_type == "page" && target.web_socket_debugger_url.is_some());

    pages
        .clone()
        .find(|target| {
            format!("{} {}", target.title, target.url)
                .to_lowercase()
                .contains("codex")
        })
        .cloned()
        .or_else(|| pages.cloned().next())
}

pub fn build_plugin_unlock_script() -> String {
    r#"
(() => {
  if (window.__codexAuthSwitchPluginUnlockInstalled) return { pluginEntryUnlock: true, forcePluginInstall: true, alreadyInstalled: true };
  window.__codexAuthSwitchPluginUnlockInstalled = true;

  const selectors = {
    pluginNavButton: 'nav[role="navigation"] button.h-token-nav-row.w-full',
    pluginSvgPath: 'svg path[d^="M7.94562 14.0277"]',
    disabledInstallButton: 'button[disabled], button[aria-disabled="true"]',
  };

  function reactFiberFrom(element) {
    if (!element) return null;
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"));
    return key ? element[key] : null;
  }

  function authContextValueFrom(element) {
    for (let fiber = reactFiberFrom(element); fiber; fiber = fiber.return) {
      const values = [fiber.memoizedProps && fiber.memoizedProps.value, fiber.pendingProps && fiber.pendingProps.value];
      for (const value of values) {
        if (value && typeof value === "object" && typeof value.setAuthMethod === "function" && "authMethod" in value) {
          return value;
        }
      }
    }
    return null;
  }

  function spoofChatGPTAuthMethod(element) {
    const auth = authContextValueFrom(element);
    if (!auth || auth.authMethod === "chatgpt") return false;
    auth.setAuthMethod("chatgpt");
    return true;
  }

  function pluginEntryButton() {
    const byIcon = document.querySelector(`${selectors.pluginNavButton} ${selectors.pluginSvgPath}`)?.closest("button");
    if (byIcon) return byIcon;
    return Array.from(document.querySelectorAll(selectors.pluginNavButton))
      .find((button) => /^(插件|Plugins)(\s+-\s+.*)?$/i.test((button.textContent || "").trim())) || null;
  }

  function labelUnlockedPluginEntry(button) {
    const textNode = Array.from(button.querySelectorAll("span, div")).reverse()
      .flatMap((node) => Array.from(node.childNodes))
      .find((node) => node.nodeType === 3 && /^(插件|Plugins)( - 已解锁| - Unlocked)?$/i.test((node.nodeValue || "").trim()));
    if (!textNode) return;
    const current = (textNode.nodeValue || "").trim();
    textNode.nodeValue = /^Plugins/i.test(current) ? "Plugins - Unlocked" : "插件 - 已解锁";
  }

  function unblockButtonElement(button) {
    button.disabled = false;
    button.removeAttribute("disabled");
    button.removeAttribute("aria-disabled");
    button.classList.remove("disabled", "opacity-50", "cursor-not-allowed", "pointer-events-none");
    button.style.pointerEvents = "auto";
    button.tabIndex = 0;
    const reactPropsKey = Object.keys(button).find((name) => name.startsWith("__reactProps"));
    if (reactPropsKey) {
      button[reactPropsKey].disabled = false;
      button[reactPropsKey]["aria-disabled"] = false;
    }
  }

  function labelForcedInstallButton(button) {
    const textNode = Array.from(button.childNodes).find((node) => {
      const text = (node.nodeValue || "").trim();
      return node.nodeType === 3 && (/^安装\s/.test(text) || /^Install\s/.test(text) || text === "强制安装");
    });
    if (textNode) textNode.nodeValue = "强制安装";
  }

  function enablePluginEntry() {
    const button = pluginEntryButton();
    if (!button) return;
    spoofChatGPTAuthMethod(button);
    unblockButtonElement(button);
    button.style.display = "";
    button.querySelectorAll("*").forEach((node) => { node.style.display = ""; });
    labelUnlockedPluginEntry(button);
    if (button.dataset.codexAuthSwitchPluginEnabled === "true") return;
    button.dataset.codexAuthSwitchPluginEnabled = "true";
    button.addEventListener("click", () => spoofChatGPTAuthMethod(button), true);
  }

  function forcePluginInstall() {
    Array.from(document.querySelectorAll(selectors.disabledInstallButton)).forEach((button) => {
      const text = (button.textContent || "").trim();
      if (!/^安装\s/.test(text) && !/^Install\s/.test(text) && text !== "强制安装") return;
      unblockButtonElement(button);
      labelForcedInstallButton(button);
    });
  }

  function run() {
    enablePluginEntry();
    forcePluginInstall();
  }

  run();
  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return { pluginEntryUnlock: true, forcePluginInstall: true };
})();
"#
    .to_string()
}

pub fn launch_codex_with_plugin_unlock() -> Result<CodexEnhanceLaunchResult, AppError> {
    let debug_port = find_available_loopback_port()?;
    stop_codex_if_supported()?;
    open_pet_overlay_for_enhanced_launch(&default_codex_target_dir()?)?;
    let _child = spawn_codex_with_debug_port(debug_port)?;
    inject_when_ready(debug_port, DEFAULT_CDP_WAIT_TIMEOUT)
}

pub fn open_pet_overlay_for_enhanced_launch(codex_dir: &Path) -> Result<(), AppError> {
    set_codex_pet_overlay_open(codex_dir)
}

fn stop_codex_if_supported() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let script = restart_codex_script()
            .ok_or_else(|| AppError::Message("Unable to prepare Codex quit script.".into()))?;
        let status = Command::new("osascript").arg("-e").arg(script).status()?;
        if !status.success() {
            return Err(AppError::Message("Failed to ask Codex.app to quit.".into()));
        }
        thread::sleep(Duration::from_millis(700));
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                stop_windows_codex_script(),
            ])
            .status();
        thread::sleep(Duration::from_millis(700));
    }

    Ok(())
}

fn spawn_codex_with_debug_port(debug_port: u16) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let executable = resolve_macos_codex_executable()?;
        Command::new(executable)
            .args(build_codex_debug_arguments(debug_port))
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let app_dir = resolve_windows_codex_app_dir()?;
        if let Some(app_user_model_id) = packaged_app_user_model_id(&app_dir) {
            activate_windows_packaged_app(
                &app_user_model_id,
                &build_codex_debug_arguments(debug_port).join(" "),
            )?;
            return Ok(());
        }
        let command = build_codex_launch_command(&app_dir, debug_port);
        let Some((program, args)) = command.split_first() else {
            return Err(AppError::Message("Codex launch command is empty.".into()));
        };
        Command::new(program).args(args).spawn()?;
        return Ok(());
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let _ = debug_port;
        Err(AppError::Message(
            "Codex enhanced launch is currently only supported on macOS and Windows.".into(),
        ))
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_codex_executable() -> Result<PathBuf, AppError> {
    let mut app_candidates = vec![
        PathBuf::from("/Applications/Codex.app"),
        PathBuf::from("/Applications/OpenAI Codex.app"),
    ];
    if let Some(home) = dirs::home_dir() {
        app_candidates.push(home.join("Applications/Codex.app"));
        app_candidates.push(home.join("Applications/OpenAI Codex.app"));
    }

    for app in app_candidates {
        if let Some(executable) = codex_executable_for_app(&app) {
            return Ok(executable);
        }
    }

    Err(AppError::Message(
        "Unable to find Codex.app or OpenAI Codex.app in Applications.".into(),
    ))
}

#[cfg(target_os = "macos")]
fn codex_executable_for_app(app: &Path) -> Option<PathBuf> {
    if !app.exists() {
        return None;
    }

    let macos_dir = app.join("Contents").join("MacOS");
    for name in ["Codex", "OpenAI Codex"] {
        let executable = macos_dir.join(name);
        if executable.exists() {
            return Some(executable);
        }
    }

    None
}

pub fn build_codex_executable(app_dir: &Path) -> PathBuf {
    if app_dir.extension().and_then(|ext| ext.to_str()) == Some("app") {
        return app_dir.join("Contents").join("MacOS").join("Codex");
    }

    let candidates = [
        child_path_preserving_windows_separator(app_dir, "Codex.exe"),
        child_path_preserving_windows_separator(app_dir, "codex.exe"),
    ];
    candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned()
        .unwrap_or_else(|| candidates[0].clone())
}

pub fn build_codex_launch_command(app_dir: &Path, debug_port: u16) -> Vec<String> {
    let mut command = vec![build_codex_executable(app_dir)
        .to_string_lossy()
        .to_string()];
    command.extend(build_codex_debug_arguments(debug_port));
    command
}

pub fn packaged_app_user_model_id(app_dir: &Path) -> Option<String> {
    let normalized = app_dir.to_string_lossy().replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    let package_dir = trimmed
        .strip_suffix("/app")
        .or_else(|| trimmed.strip_suffix("/App"))
        .unwrap_or(trimmed);
    let package_name = package_dir.rsplit('/').next()?;
    if !package_name.starts_with("OpenAI.Codex_") || !package_name.contains("__") {
        return None;
    }
    let identity_name = package_name.split('_').next()?;
    let publisher_id = package_name.rsplit("__").next()?;
    if publisher_id.is_empty() {
        return None;
    }
    Some(format!("{identity_name}_{publisher_id}!App"))
}

fn child_path_preserving_windows_separator(parent: &Path, child: &str) -> PathBuf {
    let parent_text = parent.to_string_lossy();
    if parent_text.contains('\\') {
        let separator = if parent_text.ends_with('\\') {
            ""
        } else {
            "\\"
        };
        PathBuf::from(format!("{parent_text}{separator}{child}"))
    } else {
        parent.join(child)
    }
}

pub fn find_latest_windows_codex_app_dir(root: &Path) -> Option<PathBuf> {
    let mut matches = std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter_map(|path| windows_codex_package_version(&path).map(|version| (version, path)))
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| left.0.cmp(&right.0));
    let latest = matches.pop()?.1;
    let app_dir = latest.join("app");
    Some(if app_dir.is_dir() { app_dir } else { latest })
}

pub fn stop_windows_codex_script() -> &'static str {
    "Get-CimInstance Win32_Process -Filter \"Name='Codex.exe' OR Name='codex.exe'\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
}

fn windows_codex_package_version(path: &Path) -> Option<Vec<u32>> {
    let name = path.file_name()?.to_str()?;
    let rest = name.strip_prefix("OpenAI.Codex_")?;
    let version = rest.split('_').next()?;
    let parts = version
        .split('.')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if parts.is_empty() {
        None
    } else {
        Some(parts)
    }
}

#[cfg(target_os = "windows")]
fn resolve_windows_codex_app_dir() -> Result<PathBuf, AppError> {
    if let Some(path) =
        windows_running_codex_exe_path().and_then(|path| path.parent().map(Path::to_path_buf))
    {
        return Ok(path);
    }

    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    if let Some(local_app_data) = local_app_data.as_ref() {
        for candidate in [
            local_app_data.join("Programs").join("Codex"),
            local_app_data.join("Codex"),
        ] {
            if build_codex_executable(&candidate).exists() {
                return Ok(candidate);
            }
        }
    }

    if let Some(app_dir) = query_windows_appx_codex_install_location()? {
        return Ok(app_dir);
    }

    if let Some(program_files) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        if let Some(app_dir) = find_latest_windows_codex_app_dir(&program_files.join("WindowsApps"))
        {
            return Ok(app_dir);
        }
    }

    Err(AppError::Message(
        "Unable to find Codex.exe or OpenAI.Codex AppX install location on Windows.".into(),
    ))
}

#[cfg(target_os = "windows")]
fn windows_running_codex_exe_path() -> Option<PathBuf> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-Process -Name Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

#[cfg(target_os = "windows")]
fn query_windows_appx_codex_install_location() -> Result<Option<PathBuf>, AppError> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-AppxPackage -Name \"OpenAI.Codex\" | Select-Object -ExpandProperty InstallLocation",
        ])
        .output()?;
    if !output.status.success() {
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return Ok(None);
    }
    let root = PathBuf::from(path);
    let app = root.join("app");
    Ok(Some(if app.is_dir() { app } else { root }))
}

#[cfg(target_os = "windows")]
fn activate_windows_packaged_app(app_user_model_id: &str, arguments: &str) -> Result<(), AppError> {
    let script = format!(
        r#"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class AppxActivator {{
  [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
  private class ApplicationActivationManager {{ }}
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IApplicationActivationManager {{
    int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string arguments, UInt32 options, out UInt32 processId);
    int ActivateForFile();
    int ActivateForProtocol();
  }}
  public static UInt32 Activate(string appUserModelId, string arguments) {{
    var manager = (IApplicationActivationManager)new ApplicationActivationManager();
    UInt32 processId;
    int hr = manager.ActivateApplication(appUserModelId, arguments, 0, out processId);
    if (hr < 0) Marshal.ThrowExceptionForHR(hr);
    return processId;
  }}
}}
"@
[AppxActivator]::Activate({app_user_model_id}, {arguments}) | Out-Null
"#,
        app_user_model_id = powershell_single_quoted(app_user_model_id),
        arguments = powershell_single_quoted(arguments),
    );

    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Message(
            "Failed to activate the packaged Codex app on Windows.".into(),
        ))
    }
}

#[cfg(target_os = "windows")]
fn powershell_single_quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn inject_when_ready(
    debug_port: u16,
    timeout: Duration,
) -> Result<CodexEnhanceLaunchResult, AppError> {
    let started_at = Instant::now();
    let script = build_plugin_unlock_script();
    let mut last_error = String::new();

    while started_at.elapsed() < timeout {
        match list_cdp_targets(debug_port)
            .and_then(|targets| {
                pick_cdp_page_target(&targets).ok_or_else(|| {
                    AppError::Message("No injectable Codex page target found.".into())
                })
            })
            .and_then(|target| {
                let websocket_url = target.web_socket_debugger_url.clone().ok_or_else(|| {
                    AppError::Message("Codex CDP target is missing a WebSocket URL.".into())
                })?;
                install_script(&websocket_url, &script)?;
                Ok(CodexEnhanceLaunchResult {
                    debug_port,
                    target_id: target.id,
                    websocket_url,
                })
            }) {
            Ok(result) => return Ok(result),
            Err(error) => {
                last_error = error.to_string();
                thread::sleep(Duration::from_millis(250));
            }
        }
    }

    Err(AppError::Message(format!(
        "Timed out waiting for Codex CDP injection: {last_error}"
    )))
}

fn list_cdp_targets(debug_port: u16) -> Result<Vec<CodexCdpTarget>, AppError> {
    let response = ureq::get(&format!("http://127.0.0.1:{debug_port}/json"))
        .timeout(Duration::from_secs(2))
        .call()
        .map_err(|error| {
            AppError::Message(format!("Failed to query Codex CDP targets: {error}"))
        })?;
    response
        .into_json()
        .map_err(|error| AppError::Message(format!("Failed to decode Codex CDP targets: {error}")))
}

fn install_script(websocket_url: &str, script: &str) -> Result<(), AppError> {
    let (mut socket, _) = connect(websocket_url).map_err(|error| {
        AppError::Message(format!("Failed to connect Codex CDP socket: {error}"))
    })?;

    send_cdp(
        &mut socket,
        1,
        "Page.addScriptToEvaluateOnNewDocument",
        json!({ "source": script }),
    )?;
    send_cdp(
        &mut socket,
        2,
        "Runtime.evaluate",
        json!({
            "expression": script,
            "awaitPromise": false,
            "allowUnsafeEvalBlockedByCSP": true
        }),
    )?;
    let _ = socket.close(None);
    Ok(())
}

fn send_cdp(
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<(), AppError> {
    socket
        .send(Message::Text(
            json!({ "id": id, "method": method, "params": params }).to_string(),
        ))
        .map_err(|error| AppError::Message(format!("Failed to send Codex CDP command: {error}")))?;

    loop {
        let message = socket.read().map_err(|error| {
            AppError::Message(format!("Failed to read Codex CDP response: {error}"))
        })?;
        let Message::Text(text) = message else {
            continue;
        };
        let payload: serde_json::Value = serde_json::from_str(&text)?;
        if payload.get("id").and_then(|value| value.as_u64()) != Some(id) {
            continue;
        }
        if let Some(error) = payload.get("error") {
            return Err(AppError::Message(format!(
                "Codex CDP command `{method}` failed: {error}"
            )));
        }
        return Ok(());
    }
}

fn find_available_loopback_port() -> Result<u16, AppError> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}
