use std::{
    fs::File,
    os::unix::fs::FileExt,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use anyhow::{bail, Context};
use orc_engine::storage::{
    BoxStorageFactory, StorageFactory, StorageFactoryExt, TorrentDescriptor, TorrentMetadata,
    TorrentStorage,
};
use parking_lot::RwLock;

pub trait DocumentTreeBroker: Send + Sync + 'static {
    fn open_file(&self, relative_path: &str, length: u64, overwrite: bool) -> anyhow::Result<File>;
    fn remove_file(&self, relative_path: &str) -> anyhow::Result<()>;
    fn remove_directory_if_empty(&self, relative_path: &str) -> anyhow::Result<()>;
}

pub fn safe_relative_path(path: &Path) -> anyhow::Result<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let value = value.to_string_lossy();
                if value.is_empty() || value.contains('\0') {
                    bail!("invalid storage path component");
                }
                parts.push(value.into_owned());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                bail!("storage path must remain inside the selected directory")
            }
        }
    }
    if parts.is_empty() {
        bail!("storage path is empty");
    }
    Ok(parts.join("/"))
}

#[derive(Clone)]
pub struct AndroidSafStorageFactory {
    logical_root: PathBuf,
    broker: Arc<dyn DocumentTreeBroker>,
}

impl AndroidSafStorageFactory {
    pub fn new(logical_root: PathBuf, broker: Arc<dyn DocumentTreeBroker>) -> Self {
        Self {
            logical_root,
            broker,
        }
    }

    pub fn boxed(self) -> BoxStorageFactory {
        StorageFactoryExt::boxed(self)
    }
}

impl StorageFactory for AndroidSafStorageFactory {
    fn create(
        &self,
        torrent: &TorrentDescriptor,
        _metadata: &TorrentMetadata,
    ) -> anyhow::Result<Box<dyn TorrentStorage>> {
        let torrent_root = torrent
            .output_folder
            .strip_prefix(&self.logical_root)
            .context("torrent output escaped the Android logical root")?
            .to_path_buf();
        Ok(Box::new(AndroidSafStorage {
            torrent_root,
            broker: self.broker.clone(),
            files: Vec::new(),
            paths: Vec::new(),
        }))
    }

    fn clone_box(&self) -> BoxStorageFactory {
        self.clone().boxed()
    }
}

pub struct AndroidSafStorage {
    torrent_root: PathBuf,
    broker: Arc<dyn DocumentTreeBroker>,
    files: Vec<RwLock<Option<File>>>,
    paths: Vec<Option<String>>,
}

impl TorrentStorage for AndroidSafStorage {
    fn init(
        &mut self,
        torrent: &TorrentDescriptor,
        metadata: &TorrentMetadata,
    ) -> anyhow::Result<()> {
        self.files.clear();
        self.paths.clear();
        for details in &metadata.files {
            if details.padding {
                self.files.push(RwLock::new(None));
                self.paths.push(None);
                continue;
            }
            let relative = safe_relative_path(&self.torrent_root.join(&details.relative_filename))?;
            let file = self
                .broker
                .open_file(&relative, details.length, torrent.allow_overwrite)
                .with_context(|| format!("failed to open SAF document {relative}"))?;
            file.set_len(details.length)?;
            self.files.push(RwLock::new(Some(file)));
            self.paths.push(Some(relative));
        }
        Ok(())
    }

    fn pread_exact(&self, file_id: usize, offset: u64, buf: &mut [u8]) -> anyhow::Result<()> {
        self.files
            .get(file_id)
            .context("invalid file id")?
            .read()
            .as_ref()
            .context("padding file has no descriptor")?
            .read_exact_at(buf, offset)?;
        Ok(())
    }

    fn pwrite_all(&self, file_id: usize, offset: u64, buf: &[u8]) -> anyhow::Result<()> {
        self.files
            .get(file_id)
            .context("invalid file id")?
            .read()
            .as_ref()
            .context("padding file has no descriptor")?
            .write_all_at(buf, offset)?;
        Ok(())
    }

    fn remove_file(&self, file_id: usize, _filename: &Path) -> anyhow::Result<()> {
        if let Some(Some(path)) = self.paths.get(file_id) {
            self.broker.remove_file(path)?;
        }
        Ok(())
    }

    fn remove_directory_if_empty(&self, path: &Path) -> anyhow::Result<()> {
        let relative = safe_relative_path(&self.torrent_root.join(path))?;
        self.broker.remove_directory_if_empty(&relative)
    }

    fn ensure_file_length(&self, file_id: usize, length: u64) -> anyhow::Result<()> {
        self.files
            .get(file_id)
            .context("invalid file id")?
            .read()
            .as_ref()
            .context("padding file has no descriptor")?
            .set_len(length)?;
        Ok(())
    }

    fn take(&self) -> anyhow::Result<Box<dyn TorrentStorage>> {
        let files = self
            .files
            .iter()
            .map(|file| RwLock::new(file.write().take()))
            .collect();
        Ok(Box::new(Self {
            torrent_root: self.torrent_root.clone(),
            broker: self.broker.clone(),
            files,
            paths: self.paths.clone(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_outside_tree() {
        assert!(safe_relative_path(Path::new("../escape")).is_err());
        assert!(safe_relative_path(Path::new("/absolute")).is_err());
        assert_eq!(
            safe_relative_path(Path::new("Movie/file.mkv")).unwrap(),
            "Movie/file.mkv"
        );
    }
}
