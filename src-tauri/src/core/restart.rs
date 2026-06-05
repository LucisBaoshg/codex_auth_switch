use super::AppError;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

pub fn restart_codex_script() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        Some(
            r#"if application "Codex" is running then
  tell application "Codex" to quit
end if"#,
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexRestartPlatform {
    Macos,
    Windows,
    Linux,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexRestartCommand {
    pub program: &'static str,
    pub args: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexRestartPlan {
    pub quit_command: CodexRestartCommand,
    pub open_command: CodexRestartCommand,
}

pub fn codex_restart_plan_for_platform(platform: CodexRestartPlatform) -> CodexRestartPlan {
    match platform {
        CodexRestartPlatform::Macos => CodexRestartPlan {
            quit_command: CodexRestartCommand {
                program: "osascript",
                args: vec![
                    "-e",
                    restart_codex_script().unwrap_or(
                        r#"if application "Codex" is running then
  tell application "Codex" to quit
end if"#,
                    ),
                ],
            },
            open_command: CodexRestartCommand {
                program: "open",
                args: vec!["-a", "Codex"],
            },
        },
        CodexRestartPlatform::Windows => CodexRestartPlan {
            quit_command: CodexRestartCommand {
                program: "powershell.exe",
                args: vec![
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    r#"$processes = @(Get-Process -Name Codex -ErrorAction SilentlyContinue)
if ($processes.Count -eq 0) { exit 0 }
foreach ($process in $processes) {
  if ($process.MainWindowHandle -ne 0) {
    [void]$process.CloseMainWindow()
  }
}
$deadline = (Get-Date).AddSeconds(4)
do {
  Start-Sleep -Milliseconds 200
  $remaining = @(Get-Process -Name Codex -ErrorAction SilentlyContinue)
} while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)
foreach ($process in $remaining) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
exit 0"#,
                ],
            },
            open_command: CodexRestartCommand {
                program: "powershell.exe",
                args: vec![
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    r#"$ErrorActionPreference = 'Stop'
$candidates = @(
  "$env:LOCALAPPDATA\Programs\Codex\Codex.exe",
  "$env:LOCALAPPDATA\Codex\Codex.exe",
  "$env:PROGRAMFILES\Codex\Codex.exe",
  "${env:ProgramFiles(x86)}\Codex\Codex.exe"
) | Where-Object { $_ -and (Test-Path $_) }
if ($candidates.Count -gt 0) {
  Start-Process -FilePath $candidates[0]
  exit 0
}
$startMenus = @(
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs"
)
$shortcut = Get-ChildItem -Path $startMenus -Filter '*Codex*.lnk' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($shortcut) {
  $shell = New-Object -ComObject WScript.Shell
  $target = $shell.CreateShortcut($shortcut.FullName).TargetPath
  if ($target -and (Test-Path $target)) {
    Start-Process -FilePath $target
  } else {
    Invoke-Item $shortcut.FullName
  }
  exit 0
}
Start-Process -FilePath 'Codex'"#,
                ],
            },
        },
        CodexRestartPlatform::Linux => CodexRestartPlan {
            quit_command: CodexRestartCommand {
                program: "sh",
                args: vec![
                    "-c",
                    "pkill -TERM -x Codex 2>/dev/null || pkill -TERM -x codex 2>/dev/null || true; sleep 1; pkill -KILL -x Codex 2>/dev/null || pkill -KILL -x codex 2>/dev/null || true",
                ],
            },
            open_command: CodexRestartCommand {
                program: "sh",
                args: vec![
                    "-c",
                    "if command -v codex >/dev/null 2>&1; then nohup codex >/dev/null 2>&1 & elif command -v Codex >/dev/null 2>&1; then nohup Codex >/dev/null 2>&1 & else exit 1; fi",
                ],
            },
        },
    }
}

fn current_codex_restart_platform() -> CodexRestartPlatform {
    #[cfg(target_os = "macos")]
    {
        CodexRestartPlatform::Macos
    }

    #[cfg(target_os = "windows")]
    {
        CodexRestartPlatform::Windows
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        CodexRestartPlatform::Linux
    }
}

fn force_terminate_codex_on_macos_after_grace() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            let status = Command::new("pgrep").arg("-x").arg("Codex").status()?;
            if !status.success() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(200));
        }

        let _ = Command::new("pkill")
            .arg("-KILL")
            .arg("-x")
            .arg("Codex")
            .status();
    }

    Ok(())
}

pub fn restart_codex_app() -> Result<(), AppError> {
    let platform = current_codex_restart_platform();
    let plan = codex_restart_plan_for_platform(platform);

    let quit_status = Command::new(plan.quit_command.program)
        .args(&plan.quit_command.args)
        .status()?;
    if !quit_status.success() {
        return Err(AppError::Message(
            "Failed to ask Codex to quit before restart.".into(),
        ));
    }

    if platform == CodexRestartPlatform::Macos {
        force_terminate_codex_on_macos_after_grace()?;
    }

    thread::sleep(Duration::from_millis(700));

    let open_status = Command::new(plan.open_command.program)
        .args(&plan.open_command.args)
        .status()?;
    if !open_status.success() {
        return Err(AppError::Message("Failed to reopen Codex.".into()));
    }

    Ok(())
}
