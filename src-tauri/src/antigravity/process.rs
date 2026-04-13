use crate::antigravity::AntigravityError;
use std::thread;
use std::time::Duration;

pub fn stop_antigravity_script() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        Some(
            r#"if application "Antigravity" is running then
  tell application "Antigravity" to quit
end if"#,
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub trait AntigravityProcessController: Send + Sync {
    fn stop(&self) -> Result<(), AntigravityError>;
    fn restart(&self) -> Result<(), AntigravityError>;
}

#[derive(Default)]
pub struct NoopProcessController;

impl AntigravityProcessController for NoopProcessController {
    fn stop(&self) -> Result<(), AntigravityError> {
        Ok(())
    }

    fn restart(&self) -> Result<(), AntigravityError> {
        Ok(())
    }
}

pub struct SystemAntigravityProcessController;

impl AntigravityProcessController for SystemAntigravityProcessController {
    fn stop(&self) -> Result<(), AntigravityError> {
        #[cfg(target_os = "macos")]
        {
            let script = stop_antigravity_script().ok_or_else(|| {
                AntigravityError::Message("Unable to prepare the Antigravity quit script.".into())
            })?;
            let status = std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .status()?;
            if !status.success() {
                return Err(AntigravityError::Message(
                    "Failed to ask Antigravity.app to quit.".into(),
                ));
            }

            thread::sleep(Duration::from_millis(700));
            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            Err(AntigravityError::Message(
                "Antigravity process control is currently only supported on macOS.".into(),
            ))
        }
    }

    fn restart(&self) -> Result<(), AntigravityError> {
        #[cfg(target_os = "macos")]
        {
            let status = std::process::Command::new("open")
                .arg("-a")
                .arg("Antigravity")
                .status()?;
            if !status.success() {
                return Err(AntigravityError::Message(
                    "Failed to reopen Antigravity.app.".into(),
                ));
            }

            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            Err(AntigravityError::Message(
                "Antigravity process control is currently only supported on macOS.".into(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::stop_antigravity_script;

    #[test]
    fn stop_antigravity_script_targets_antigravity_app_on_macos() {
        #[cfg(target_os = "macos")]
        {
            let script = stop_antigravity_script().expect("script should exist on macOS");
            assert!(script.contains("application \"Antigravity\""));
            assert!(script.contains("quit"));
        }

        #[cfg(not(target_os = "macos"))]
        {
            assert!(stop_antigravity_script().is_none());
        }
    }
}
