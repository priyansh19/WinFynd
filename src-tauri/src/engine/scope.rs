//! What the index covers. With full OS context on (the default) that's every
//! fixed drive; off, the folders the user chose. Either way, what's always
//! skipped (`is_excluded`), hidden files and folders, and the folders the
//! user skipped are left out.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use super::config::EngineConfig;
use super::is_excluded;

/// The folders to walk and watch: the drives (when full OS context is on)
/// plus each chosen folder that isn't on one of them, minus what's skipped.
pub fn roots(cfg: &EngineConfig, drives: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = if cfg.whole_pc { drives.to_vec() } else { Vec::new() };
    for r in &cfg.roots {
        if !roots.iter().any(|d| r.starts_with(d)) {
            roots.push(r.clone());
        }
    }
    roots.retain(|r| !skipped(cfg, r));
    roots
}

/// Whether the user skipped this path, or a folder above it.
pub fn skipped(cfg: &EngineConfig, path: &Path) -> bool {
    cfg.skip.iter().any(|s| path.starts_with(s))
}

/// Whether a stored file still belongs in the index. It only looks at the
/// path, so files on a drive that's unplugged for now are kept.
pub fn covers(cfg: &EngineConfig, path: &Path) -> bool {
    let inside = (cfg.whole_pc && on_a_drive(path)) || cfg.roots.iter().any(|r| path.starts_with(r));
    inside && !is_excluded(path) && !skipped(cfg, path)
}

/// `C:\…` on Windows; any absolute path elsewhere.
fn on_a_drive(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::Prefix;
        matches!(path.components().next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
    }
    #[cfg(not(windows))]
    {
        matches!(path.components().next(), Some(Component::RootDir))
    }
}

/// A fixed drive as Settings and setup show it: "Windows (C:)", 412 GB used of 953 GB.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// `C:\`
    pub path: String,
    /// The volume's name; empty when it has none (Explorer says "Local Disk").
    pub label: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    /// The drive Windows runs from.
    pub system: bool,
}

/// Every fixed drive: internal disks and most USB hard drives. Removable,
/// network and optical drives are left out.
#[cfg(windows)]
pub fn fixed_drives() -> Vec<PathBuf> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    const DRIVE_FIXED: u32 = 3;
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| format!("{}:\\", (b'A' + i) as char))
        .filter(|root| unsafe { GetDriveTypeW(&HSTRING::from(root.as_str())) } == DRIVE_FIXED)
        .map(PathBuf::from)
        .collect()
}

#[cfg(not(windows))]
pub fn fixed_drives() -> Vec<PathBuf> {
    Vec::new()
}

/// Name and size of each fixed drive.
pub fn drives() -> Vec<Drive> {
    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_ascii_uppercase();
    fixed_drives()
        .into_iter()
        .map(|d| {
            let path = d.to_string_lossy().to_string();
            let (label, total_bytes, free_bytes) = details(&path);
            let system = path.trim_end_matches('\\').eq_ignore_ascii_case(&system);
            Drive { path, label, total_bytes, free_bytes, system }
        })
        .collect()
}

#[cfg(windows)]
fn details(root: &str) -> (String, u64, u64) {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetVolumeInformationW};
    let root = HSTRING::from(root);
    let mut name = [0u16; 261];
    let label = unsafe { GetVolumeInformationW(&root, Some(&mut name), None, None, None, None) }
        .ok()
        .map(|_| String::from_utf16_lossy(&name[..name.iter().position(|&c| c == 0).unwrap_or(name.len())]))
        .unwrap_or_default();
    let (mut free, mut total) = (0u64, 0u64);
    let _ = unsafe { GetDiskFreeSpaceExW(&root, Some(&mut free), Some(&mut total), None) };
    (label, total, free)
}

#[cfg(not(windows))]
fn details(_root: &str) -> (String, u64, u64) {
    (String::new(), 0, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An absolute path on this platform: `C:\a\b` on Windows, `/a/b` elsewhere.
    fn abs(rel: &str) -> PathBuf {
        let base = if cfg!(windows) { "C:\\" } else { "/" };
        rel.split('/').fold(PathBuf::from(base), |p, part| p.join(part))
    }

    fn drive(letter: &str) -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(format!("{letter}:\\"))
        } else {
            PathBuf::from(format!("/{letter}"))
        }
    }

    #[test]
    fn whole_pc_searches_every_drive_and_folders_off_them() {
        let (c, d) = (drive("C"), drive("D"));
        let network = if cfg!(windows) { PathBuf::from("\\\\nas\\photos") } else { PathBuf::from("/mnt/nas") };
        let docs = c.join("Users").join("gupta").join("Documents");
        let cfg = EngineConfig { roots: vec![docs.clone(), network.clone()], ..EngineConfig::default() };
        assert!(cfg.whole_pc, "full OS context is on by default");
        assert_eq!(roots(&cfg, &[c.clone(), d.clone()]), vec![c.clone(), d.clone(), network.clone()]);

        let off = EngineConfig { whole_pc: false, ..cfg.clone() };
        assert_eq!(roots(&off, &[c.clone(), d.clone()]), vec![docs, network.clone()]);

        let skip_d = EngineConfig { skip: vec![d.clone()], ..cfg };
        assert_eq!(roots(&skip_d, &[c.clone(), d]), vec![c, network]);
    }

    #[test]
    fn covers_follows_the_settings_not_the_disk() {
        let docs = abs("Users/gupta/Documents");
        let games = abs("Games");
        let cfg = EngineConfig { roots: vec![docs.clone()], skip: vec![games.clone()], ..EngineConfig::default() };
        assert!(covers(&cfg, &abs("Users/gupta/Downloads/lease.pdf")));
        assert!(covers(&cfg, &docs.join("notes.txt")));
        assert!(!covers(&cfg, &games.join("save.dat")), "skipped by the user");
        assert!(!covers(&cfg, &abs("Users/gupta/project/node_modules/x.js")), "always skipped");

        let off = EngineConfig { whole_pc: false, ..cfg };
        assert!(covers(&off, &docs.join("notes.txt")));
        assert!(!covers(&off, &abs("Users/gupta/Downloads/lease.pdf")), "not in a chosen folder");
        assert!(!covers(&off, Path::new("relative/notes.txt")));
    }

    #[cfg(windows)]
    #[test]
    fn finds_the_system_drive() {
        let drives = drives();
        assert!(drives.iter().any(|d| d.system && d.path.eq_ignore_ascii_case("C:\\")), "{drives:?}");
        assert!(drives.iter().all(|d| d.total_bytes >= d.free_bytes));
    }
}
