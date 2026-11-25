use super::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const PENDING_NOTICES_FILE: &str = "pending-notices.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigRecoveryKind {
    State,
    ProfileMetadata,
    TargetMarker,
    TargetAuth,
    TargetConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigRecoveryNotice {
    pub id: String,
    pub kind: ConfigRecoveryKind,
    pub source_path: String,
    pub recovery_path: Option<String>,
    pub profile_id: Option<String>,
    pub summary: String,
    pub action: String,
    pub occurred_at: DateTime<Utc>,
}

pub(super) fn recovery_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("recovery")
}

fn pending_notices_path(app_data_dir: &Path) -> PathBuf {
    recovery_dir(app_data_dir).join(PENDING_NOTICES_FILE)
}

pub(super) fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let contents = serde_json::to_vec_pretty(value)?;
    atomic_write_bytes(path, &contents, None)
}

pub(super) fn atomic_write_sensitive(path: &Path, contents: &[u8]) -> Result<(), AppError> {
    atomic_write_bytes(path, contents, Some(0o600))
}

pub(super) fn read_optional_profile_file(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn read_optional_profile_text(path: &Path) -> Result<Option<String>, AppError> {
    read_optional_profile_file(path)?
        .map(|bytes| String::from_utf8(bytes).map_err(std::io::Error::other))
        .transpose()
        .map_err(Into::into)
}

pub(super) type ProfileFileUpdate = (PathBuf, Option<Vec<u8>>, Vec<u8>);

pub(super) fn profile_file_update(
    path: PathBuf,
    next: Vec<u8>,
) -> Result<ProfileFileUpdate, AppError> {
    let previous = read_optional_profile_file(&path)?;
    Ok((path, previous, next))
}

pub(super) fn commit_profile_files(writes: &[ProfileFileUpdate]) -> Result<(), AppError> {
    let mut attempted = Vec::new();
    let result = (|| {
        for (path, previous, next) in writes {
            if read_optional_profile_file(path)?.as_deref() != previous.as_deref() {
                return Err(AppError::Message(
                    "运行文件在操作期间发生变化，请重试。".into(),
                ));
            }
            if previous.as_deref() == Some(next.as_slice()) {
                continue;
            }
            attempted.push((path, previous, next));
            atomic_write_sensitive(path, next)?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        let mut rollback_errors = Vec::new();
        for (path, previous, next) in attempted.into_iter().rev() {
            match read_optional_profile_file(path) {
                Ok(Some(current)) if current == *next => {
                    let rollback = match previous {
                        Some(previous) => atomic_write_sensitive(path, previous),
                        None => fs::remove_file(path).map_err(Into::into),
                    };
                    if let Err(rollback) = rollback {
                        rollback_errors.push(format!("{}：{rollback}", path.display()));
                    }
                }
                Err(rollback) => rollback_errors.push(format!("{}：{rollback}", path.display())),
                _ => {}
            }
        }
        if !rollback_errors.is_empty() {
            return Err(AppError::Message(format!(
                "{error}。部分文件恢复失败：{}。请检查配置备份。",
                rollback_errors.join("、")
            )));
        }
        return Err(error);
    }
    Ok(())
}

fn atomic_write_bytes(
    path: &Path,
    contents: &[u8],
    unix_mode: Option<u32>,
) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| {
        AppError::Message(format!(
            "Cannot write a file without a parent directory: {}",
            path.to_string_lossy()
        ))
    })?;
    fs::create_dir_all(parent)?;

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4().simple()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    if let Some(mode) = unix_mode {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(mode);
    }
    #[cfg(not(unix))]
    let _ = unix_mode;
    let mut temp_file = options.open(&temp_path)?;

    if let Err(error) = (|| -> Result<(), AppError> {
        temp_file.write_all(contents)?;
        temp_file.sync_all()?;
        drop(temp_file);
        replace_file(&temp_path, path)?;
        sync_parent_directory(parent)?;
        Ok(())
    })() {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(())
}

fn replace_file(temp_path: &Path, target_path: &Path) -> Result<(), AppError> {
    // Both paths live in the same directory. Rust uses rename(2) on Unix and
    // MoveFileExW(..., MOVEFILE_REPLACE_EXISTING) on Windows, so readers see
    // either the old complete file or the new complete file.
    fs::rename(temp_path, target_path)?;
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> Result<(), AppError> {
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> Result<(), AppError> {
    Ok(())
}

pub(super) fn merge_recovery_notices(
    first: Vec<ConfigRecoveryNotice>,
    second: Vec<ConfigRecoveryNotice>,
) -> Vec<ConfigRecoveryNotice> {
    let mut seen = HashSet::new();
    first
        .into_iter()
        .chain(second)
        .filter(|notice| seen.insert(notice.id.clone()))
        .collect()
}

pub(super) fn read_pending_notices(app_data_dir: &Path) -> Vec<ConfigRecoveryNotice> {
    let path = pending_notices_path(app_data_dir);
    let Ok(contents) = fs::read(&path) else {
        return Vec::new();
    };
    serde_json::from_slice(&contents).unwrap_or_default()
}

pub(super) fn record_pending_notices(app_data_dir: &Path, notices: &[ConfigRecoveryNotice]) {
    if notices.is_empty() {
        return;
    }
    let merged = merge_recovery_notices(read_pending_notices(app_data_dir), notices.to_vec());
    let _ = atomic_write_json(&pending_notices_path(app_data_dir), &merged);
}

pub(super) fn acknowledge_pending_notices(
    app_data_dir: &Path,
    notice_ids: &[String],
) -> Result<(), AppError> {
    let acknowledged = notice_ids.iter().collect::<HashSet<_>>();
    let mut pending = read_pending_notices(app_data_dir);
    pending.retain(|notice| !acknowledged.contains(&notice.id));
    atomic_write_json(&pending_notices_path(app_data_dir), &pending)
}

pub(super) fn quarantine_corrupt_file(
    app_data_dir: &Path,
    source: &Path,
    recovery_stem: &str,
) -> Result<PathBuf, AppError> {
    let relative = Path::new(recovery_stem);
    let file_stem = relative
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config");
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let destination_dir = recovery_dir(app_data_dir).join(parent);
    fs::create_dir_all(&destination_dir)?;
    let destination = destination_dir.join(format!(
        "{file_stem}.corrupt-{}-{}.json",
        Utc::now().format("%Y%m%d-%H%M%S"),
        &Uuid::new_v4().simple().to_string()[..8]
    ));

    match fs::rename(source, &destination) {
        Ok(()) => Ok(destination),
        Err(_) => {
            fs::copy(source, &destination)?;
            OpenOptions::new()
                .read(true)
                .open(&destination)?
                .sync_all()?;
            fs::remove_file(source)?;
            Ok(destination)
        }
    }
}

pub(super) fn stable_invalid_file_notice(
    kind: ConfigRecoveryKind,
    path: &Path,
    contents: &[u8],
    summary: String,
    action: String,
) -> ConfigRecoveryNotice {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update([0]);
    hasher.update(contents);
    let digest = format!("{:x}", hasher.finalize());
    ConfigRecoveryNotice {
        id: format!("config-{digest}"),
        kind,
        source_path: path.to_string_lossy().to_string(),
        recovery_path: None,
        profile_id: None,
        summary,
        action,
        occurred_at: Utc::now(),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn conflicting_second_file_rolls_back_the_first_file() {
        let root = tempfile::tempdir().unwrap();
        let auth = root.path().join("auth.json");
        let config = root.path().join("config.toml");
        fs::write(&auth, b"auth-old").unwrap();
        fs::write(&config, b"externally-changed").unwrap();
        let changes = [
            (
                auth.clone(),
                Some(b"auth-old".to_vec()),
                b"auth-new".to_vec(),
            ),
            (
                config.clone(),
                Some(b"config-old".to_vec()),
                b"config-new".to_vec(),
            ),
        ];
        assert!(commit_profile_files(&changes).is_err());
        assert_eq!(fs::read(&auth).unwrap(), b"auth-old");
        assert_eq!(fs::read(&config).unwrap(), b"externally-changed");
    }

    use super::*;
    use chrono::Utc;
    use tempfile::TempDir;

    fn notice(id: &str) -> ConfigRecoveryNotice {
        ConfigRecoveryNotice {
            id: id.into(),
            kind: ConfigRecoveryKind::State,
            source_path: "/tmp/state.json".into(),
            recovery_path: None,
            profile_id: None,
            summary: "state.json 损坏".into(),
            action: "检查目标目录".into(),
            occurred_at: Utc::now(),
        }
    }

    #[test]
    fn pending_notice_log_deduplicates_by_id_and_can_acknowledge_selected_items() {
        let app_dir = TempDir::new().unwrap();
        let first = notice("same");
        let second = notice("same");

        record_pending_notices(app_dir.path(), &[first, second]);

        assert_eq!(read_pending_notices(app_dir.path()).len(), 1);
        acknowledge_pending_notices(app_dir.path(), &["same".into()]).unwrap();
        assert!(read_pending_notices(app_dir.path()).is_empty());
    }

    #[test]
    fn quarantine_preserves_the_exact_corrupt_bytes() {
        let app_dir = TempDir::new().unwrap();
        let source = app_dir.path().join("meta.json");
        std::fs::write(&source, [0_u8; 32]).unwrap();

        let recovered = quarantine_corrupt_file(app_dir.path(), &source, "profile-1/meta").unwrap();

        assert!(!source.exists());
        assert_eq!(std::fs::read(recovered).unwrap(), vec![0_u8; 32]);
    }

    #[test]
    fn atomic_json_write_leaves_a_parseable_target_without_temp_files() {
        let app_dir = TempDir::new().unwrap();
        let target = app_dir.path().join("state.json");

        atomic_write_json(&target, &serde_json::json!({"targetDir": "one"})).unwrap();
        atomic_write_json(&target, &serde_json::json!({"targetDir": "two"})).unwrap();

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&target).unwrap()).unwrap();
        assert_eq!(value["targetDir"], "two");
        assert_eq!(std::fs::read_dir(app_dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn atomic_sensitive_write_uses_private_permissions_on_unix() {
        let app_dir = TempDir::new().unwrap();
        let target = app_dir.path().join("auth.json");

        atomic_write_sensitive(&target, br#"{"auth_mode":"chatgpt"}"#).unwrap();

        assert_eq!(
            std::fs::read(&target).unwrap(),
            br#"{"auth_mode":"chatgpt"}"#
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn atomic_sensitive_replacement_never_exposes_partial_contents() {
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        use std::sync::Arc;
        use std::thread;

        let app_dir = TempDir::new().unwrap();
        let target = Arc::new(app_dir.path().join("auth.json"));
        let first = vec![b'A'; 4_460];
        let second = vec![b'B'; 4_460];
        atomic_write_sensitive(&target, &first).unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        let invalid_reads = Arc::new(AtomicUsize::new(0));
        let mut readers = Vec::new();
        for _ in 0..2 {
            let target = Arc::clone(&target);
            let stop = Arc::clone(&stop);
            let invalid_reads = Arc::clone(&invalid_reads);
            readers.push(thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    if let Ok(contents) = std::fs::read(target.as_path()) {
                        let is_complete_first =
                            contents.len() == 4_460 && contents.iter().all(|byte| *byte == b'A');
                        let is_complete_second =
                            contents.len() == 4_460 && contents.iter().all(|byte| *byte == b'B');
                        if !is_complete_first && !is_complete_second {
                            invalid_reads.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
            }));
        }

        for index in 0..250 {
            let contents = if index % 2 == 0 { &second } else { &first };
            atomic_write_sensitive(&target, contents).unwrap();
        }
        stop.store(true, Ordering::Relaxed);
        for reader in readers {
            reader.join().unwrap();
        }

        assert_eq!(invalid_reads.load(Ordering::Relaxed), 0);
    }
}
