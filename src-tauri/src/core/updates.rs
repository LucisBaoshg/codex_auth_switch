use super::AppError;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

const INTERNAL_UPDATE_BASE_URL: &str = "http://tc-github-mirror.ite.tool4seller.com";
const INTERNAL_UPDATE_APP_ID: &str = "codex-auth-switch";
const UPDATE_KIND_INSTALLER: &str = "installer";
const UPDATE_KIND_IN_APP: &str = "in_app_update";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    pub published_at: Option<String>,
    pub notes: Option<String>,
    pub kind: String,
    pub filename: String,
    pub sha256: String,
    pub size: u64,
    pub can_install: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLocationStatus {
    pub update_safe: bool,
    pub requires_applications_install: bool,
    pub install_path: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallRequest {
    pub latest_version: String,
    pub download_url: String,
    pub sha256: String,
    pub kind: String,
    pub filename: String,
}

#[derive(Debug, Clone, Deserialize)]
struct MirrorLatestRelease {
    app_id: String,
    version: String,
    published_at: Option<String>,
    #[allow(dead_code)]
    synced_at: Option<String>,
    notes: Option<String>,
    platform: String,
    arch: String,
    kind: String,
    filename: String,
    sha256: String,
    size: u64,
    download_url: String,
}

fn current_update_platform() -> Result<&'static str, AppError> {
    if cfg!(target_os = "macos") {
        Ok("macos")
    } else if cfg!(target_os = "windows") {
        Ok("windows")
    } else if cfg!(target_os = "linux") {
        Ok("linux")
    } else {
        Err(AppError::Message("当前平台暂不支持更新。".into()))
    }
}

fn current_update_arch() -> Result<&'static str, AppError> {
    if cfg!(target_arch = "aarch64") {
        Ok("arm64")
    } else if cfg!(target_arch = "x86_64") {
        Ok("x64")
    } else {
        Err(AppError::Message("当前架构暂不支持更新。".into()))
    }
}

fn preferred_update_kind(platform: &str) -> &'static str {
    if platform == "macos" {
        UPDATE_KIND_IN_APP
    } else {
        UPDATE_KIND_INSTALLER
    }
}

fn mirror_latest_url(app_id: &str, platform: &str, arch: &str, kind: &str) -> String {
    format!(
        "{INTERNAL_UPDATE_BASE_URL}/updates/{app_id}/latest?platform={platform}&arch={arch}&kind={kind}"
    )
}

fn fetch_mirror_release(
    app_id: &str,
    platform: &str,
    arch: &str,
    kind: &str,
) -> Result<Option<MirrorLatestRelease>, AppError> {
    let url = mirror_latest_url(app_id, platform, arch, kind);
    let response = match ureq::get(&url)
        .set("Accept", "application/json")
        .set("User-Agent", "codex-auth-switch")
        .call()
    {
        Ok(response) => response,
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(error) => return Err(AppError::Message(format!("检查更新失败：{error}"))),
    };

    let release: MirrorLatestRelease = response
        .into_json()
        .map_err(|error| AppError::Message(format!("解析更新信息失败：{error}")))?;

    validate_mirror_release(&release, app_id, platform, arch)?;
    Ok(Some(release))
}

fn validate_mirror_release(
    release: &MirrorLatestRelease,
    app_id: &str,
    platform: &str,
    arch: &str,
) -> Result<(), AppError> {
    if release.app_id != app_id {
        return Err(AppError::Message(format!(
            "内网镜像返回了错误的应用标识：期望 {app_id}，实际 {}。",
            release.app_id
        )));
    }

    if release.platform != platform {
        return Err(AppError::Message(format!(
            "内网镜像返回的平台不匹配：期望 {platform}，实际 {}。",
            release.platform
        )));
    }

    if release.arch != arch {
        return Err(AppError::Message(format!(
            "内网镜像返回的架构不匹配：期望 {arch}，实际 {}。",
            release.arch
        )));
    }

    Ok(())
}

fn resolve_mirror_release() -> Result<MirrorLatestRelease, AppError> {
    let platform = current_update_platform()?;
    let arch = current_update_arch()?;
    let preferred_kind = preferred_update_kind(platform);

    if let Some(release) =
        fetch_mirror_release(INTERNAL_UPDATE_APP_ID, platform, arch, preferred_kind)?
    {
        return Ok(release);
    }

    if preferred_kind != UPDATE_KIND_INSTALLER {
        if let Some(release) = fetch_mirror_release(
            INTERNAL_UPDATE_APP_ID,
            platform,
            arch,
            UPDATE_KIND_INSTALLER,
        )? {
            return Ok(release);
        }
    }

    Err(AppError::Message(
        "内网镜像站暂时没有适用于当前平台的更新包。".into(),
    ))
}

pub fn check_for_update() -> Result<UpdateCheckResult, AppError> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let release = resolve_mirror_release()?;
    let latest_version = normalize_version_string(&release.version);
    let current_semver = Version::parse(&current_version).ok();
    let latest_semver = Version::parse(&latest_version).ok();
    let has_update = match (current_semver, latest_semver) {
        (Some(current), Some(latest)) => latest > current,
        _ => latest_version != current_version,
    };

    let can_install = release.kind == UPDATE_KIND_IN_APP;

    Ok(UpdateCheckResult {
        has_update,
        current_version,
        latest_version,
        download_url: release.download_url,
        published_at: release.published_at,
        notes: release.notes,
        kind: release.kind,
        filename: release.filename,
        sha256: release.sha256,
        size: release.size,
        can_install,
    })
}

pub fn install_update(payload: UpdateInstallRequest) -> Result<(), AppError> {
    match payload.kind.as_str() {
        UPDATE_KIND_INSTALLER => open_url(&payload.download_url),
        UPDATE_KIND_IN_APP => install_in_app_update(&payload),
        other => Err(AppError::Message(format!("不支持的更新包类型：{other}"))),
    }
}

pub fn check_install_location() -> Result<InstallLocationStatus, AppError> {
    let exe_path = std::env::current_exe()?;
    Ok(install_location_status_for_path(&exe_path))
}

fn install_location_status_for_path(path: &Path) -> InstallLocationStatus {
    #[cfg(target_os = "macos")]
    {
        let install_root = macos_app_bundle_root(path).unwrap_or_else(|| path.to_path_buf());
        let system_applications = Path::new("/Applications");
        let user_applications = dirs::home_dir().map(|home| home.join("Applications"));
        let in_valid_applications_dir = install_root.starts_with(system_applications)
            || user_applications
                .as_ref()
                .is_some_and(|applications| install_root.starts_with(applications));

        if in_valid_applications_dir {
            return InstallLocationStatus {
                update_safe: true,
                requires_applications_install: false,
                install_path: install_root.display().to_string(),
                message: None,
            };
        }

        return InstallLocationStatus {
            update_safe: false,
            requires_applications_install: true,
            install_path: install_root.display().to_string(),
            message: Some(
                "当前应用不在 Applications 文件夹中。请先将 Codex 助手拖到 Applications 后再重新打开，然后再执行更新。".into(),
            ),
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        InstallLocationStatus {
            update_safe: true,
            requires_applications_install: false,
            install_path: path.display().to_string(),
            message: None,
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_app_bundle_root(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
        {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

#[cfg(target_os = "macos")]
fn install_in_app_update(payload: &UpdateInstallRequest) -> Result<(), AppError> {
    let current_exe = std::env::current_exe()?;
    let app_root = macos_app_bundle_root(&current_exe).ok_or_else(|| {
        AppError::Message("无法定位当前应用包目录，暂时不能执行应用内更新。".into())
    })?;

    let temp_root =
        std::env::temp_dir().join(format!("codex-auth-switch-update-{}", Uuid::new_v4()));
    let extract_root = temp_root.join("extract");
    let archive_path = temp_root.join(&payload.filename);
    fs::create_dir_all(&extract_root)?;

    let download_result = (|| -> Result<(), AppError> {
        download_update_archive(&payload.download_url, &payload.sha256, &archive_path)?;
        extract_tar_gz(&archive_path, &extract_root)?;
        let downloaded_app = find_app_bundle(&extract_root)?
            .ok_or_else(|| AppError::Message("更新包中未找到可安装的 .app 应用目录。".into()))?;
        replace_macos_app_bundle(&downloaded_app, &app_root)
    })();

    let _ = fs::remove_dir_all(&temp_root);
    download_result
}

#[cfg(not(target_os = "macos"))]
fn install_in_app_update(_payload: &UpdateInstallRequest) -> Result<(), AppError> {
    Err(AppError::Message(
        "当前平台暂不支持应用内更新，请改用安装包升级。".into(),
    ))
}

#[cfg(target_os = "macos")]
fn download_update_archive(
    url: &str,
    expected_sha256: &str,
    destination: &Path,
) -> Result<(), AppError> {
    let response = ureq::get(url)
        .set("Accept", "application/octet-stream")
        .set("User-Agent", "codex-auth-switch")
        .call()
        .map_err(|error| AppError::Message(format!("下载更新包失败：{error}")))?;

    let mut reader = response.into_reader();
    let mut writer = fs::File::create(destination)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        writer.write_all(&buffer[..read])?;
    }

    let actual_sha256 = format!("{:x}", hasher.finalize());
    if actual_sha256 != expected_sha256.trim().to_ascii_lowercase() {
        return Err(AppError::Message(format!(
            "更新包校验失败：期望 {expected_sha256}，实际 {actual_sha256}。"
        )));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn extract_tar_gz(archive_path: &Path, extract_root: &Path) -> Result<(), AppError> {
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(archive_path)
        .arg("-C")
        .arg(extract_root)
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::Message("解压更新包失败。".into()))
    }
}

#[cfg(target_os = "macos")]
fn find_app_bundle(root: &Path) -> Result<Option<PathBuf>, AppError> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
        {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

#[cfg(target_os = "macos")]
fn replace_macos_app_bundle(source_app: &Path, target_app: &Path) -> Result<(), AppError> {
    let target_parent = target_app
        .parent()
        .ok_or_else(|| AppError::Message("无法确定当前应用的安装目录。".into()))?;
    let backup_path = target_parent.join(format!(
        "{}.backup-{}",
        target_app
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Codex 助手.app"),
        Uuid::new_v4()
    ));

    match fs::rename(target_app, &backup_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return replace_macos_app_bundle_with_admin(source_app, target_app, &backup_path);
        }
        Err(error) => return Err(error.into()),
    }

    let copy_result = copy_app_bundle(source_app, target_app);
    if let Err(error) = copy_result {
        let _ = fs::remove_dir_all(target_app);
        let _ = fs::rename(&backup_path, target_app);
        return Err(error);
    }

    let _ = fs::remove_dir_all(&backup_path);
    let _ = Command::new("touch").arg(target_app).status();
    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_app_bundle(source_app: &Path, target_app: &Path) -> Result<(), AppError> {
    let status = Command::new("ditto")
        .arg(source_app)
        .arg(target_app)
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::Message("复制新版本应用失败。".into()))
    }
}

#[cfg(target_os = "macos")]
fn replace_macos_app_bundle_with_admin(
    source_app: &Path,
    target_app: &Path,
    backup_path: &Path,
) -> Result<(), AppError> {
    let command = format!(
        "rm -rf {backup} && mv {target} {backup} && ditto {source} {target} && rm -rf {backup}",
        backup = shell_quote(backup_path),
        target = shell_quote(target_app),
        source = shell_quote(source_app),
    );
    let apple_script = format!(
        "do shell script \"{}\" with administrator privileges",
        escape_applescript_string(&command)
    );
    let status = Command::new("osascript")
        .arg("-e")
        .arg(apple_script)
        .status()?;

    if status.success() {
        let _ = Command::new("touch").arg(target_app).status();
        Ok(())
    } else {
        Err(AppError::Message(
            "更新失败：没有权限替换 Applications 中的应用包。".into(),
        ))
    }
}

#[cfg(target_os = "macos")]
fn shell_quote(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\'', "'\"'\"'");
    format!("'{text}'")
}

#[cfg(target_os = "macos")]
fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\"', "\\\"")
}

fn normalize_version_string(version: &str) -> String {
    version
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .to_string()
}

fn open_url(url: &str) -> Result<(), AppError> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Message("仅允许打开 http/https 链接。".into()));
    }

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(url).status()?;

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .args(["/C", "start", "", url])
        .status()?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(url).status()?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::Message("无法打开更新页面。".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::install_location_status_for_path;
    use std::path::Path;

    #[test]
    fn install_location_check_accepts_system_applications_bundle() {
        let status = install_location_status_for_path(Path::new(
            "/Applications/Codex 助手.app/Contents/MacOS/Codex 助手",
        ));

        assert!(status.update_safe);
        assert!(!status.requires_applications_install);
    }

    #[test]
    fn install_location_check_flags_non_applications_bundle() {
        let status = install_location_status_for_path(Path::new(
            "/Users/lucifer/Downloads/Codex 助手.app/Contents/MacOS/Codex 助手",
        ));

        assert!(!status.update_safe);
        assert!(status.requires_applications_install);
        assert!(status
            .message
            .as_deref()
            .is_some_and(|message| message.contains("Applications")));
    }
}
