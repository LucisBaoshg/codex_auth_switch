use crate::core::{
    default_codex_target_dir, restart_codex_script, set_codex_pet_overlay_open, AppError,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
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

    Ok(())
}

fn spawn_codex_with_debug_port(debug_port: u16) -> Result<Child, AppError> {
    #[cfg(target_os = "macos")]
    {
        let executable = resolve_macos_codex_executable()?;
        Command::new(executable)
            .args(build_codex_debug_arguments(debug_port))
            .spawn()
            .map_err(AppError::from)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = debug_port;
        Err(AppError::Message(
            "Codex enhanced launch is currently only supported on macOS.".into(),
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
