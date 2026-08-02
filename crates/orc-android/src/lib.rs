mod storage;

use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    os::fd::FromRawFd,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

use jni::{
    objects::{GlobalRef, JClass, JObject, JString, JValue},
    sys::{jlong, jstring},
    JNIEnv, JavaVM,
};
use orc_core::NetworkStatusProvider;
use orc_daemon::{spawn_daemon, DaemonHandle, DaemonRuntimeConfig};
use serde::Deserialize;
use storage::{AndroidSafStorageFactory, DocumentTreeBroker};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartConfig {
    admin_token: String,
    download_dir: PathBuf,
    config_dir: PathBuf,
    state_dir: PathBuf,
    #[serde(default)]
    start_paused: bool,
}

struct JavaDocumentTreeBroker {
    vm: JavaVM,
    object: GlobalRef,
}

#[derive(Default)]
struct AndroidNetworkStatus {
    vpn_active: AtomicBool,
    transfers_allowed: AtomicBool,
    rebind_required: AtomicBool,
}

impl NetworkStatusProvider for AndroidNetworkStatus {
    fn vpn_connected(&self) -> bool {
        self.vpn_active.load(Ordering::Acquire)
    }

    fn transfers_allowed(&self) -> bool {
        self.transfers_allowed.load(Ordering::Acquire)
    }

    fn take_rebind_required(&self) -> bool {
        self.rebind_required.swap(false, Ordering::AcqRel)
    }

    fn vpn_interface(&self) -> Option<String> {
        self.vpn_connected().then(|| "android-vpn".to_string())
    }
}

fn network_status() -> &'static Arc<AndroidNetworkStatus> {
    static STATUS: OnceLock<Arc<AndroidNetworkStatus>> = OnceLock::new();
    STATUS.get_or_init(|| Arc::new(AndroidNetworkStatus::default()))
}

impl JavaDocumentTreeBroker {
    fn call_path_method(&self, method: &str, path: &str) -> anyhow::Result<()> {
        let mut env = self.vm.attach_current_thread()?;
        let path = env.new_string(path)?;
        env.call_method(
            self.object.as_obj(),
            method,
            "(Ljava/lang/String;)V",
            &[JValue::Object(&JObject::from(path))],
        )?;
        Ok(())
    }
}

impl DocumentTreeBroker for JavaDocumentTreeBroker {
    fn open_file(
        &self,
        relative_path: &str,
        length: u64,
        overwrite: bool,
    ) -> anyhow::Result<std::fs::File> {
        let mut env = self.vm.attach_current_thread()?;
        let path = env.new_string(relative_path)?;
        let fd = env
            .call_method(
                self.object.as_obj(),
                "openFile",
                "(Ljava/lang/String;JZ)I",
                &[
                    JValue::Object(&JObject::from(path)),
                    JValue::Long(length as jlong),
                    JValue::Bool(overwrite.into()),
                ],
            )?
            .i()?;
        if fd < 0 {
            anyhow::bail!("Android document provider rejected {relative_path}");
        }
        // Kotlin transfers one descriptor. Keep a Rust-owned duplicate so its lifecycle is
        // independent from ParcelFileDescriptor and any provider-side wrapper.
        let duplicate = unsafe { libc::dup(fd) };
        unsafe { libc::close(fd) };
        if duplicate < 0 {
            anyhow::bail!("failed to duplicate Android document descriptor");
        }
        Ok(unsafe { std::fs::File::from_raw_fd(duplicate) })
    }

    fn remove_file(&self, relative_path: &str) -> anyhow::Result<()> {
        self.call_path_method("removeFile", relative_path)
    }

    fn remove_directory_if_empty(&self, relative_path: &str) -> anyhow::Result<()> {
        self.call_path_method("removeDirectoryIfEmpty", relative_path)
    }
}

fn handle_slot() -> &'static Mutex<Option<DaemonHandle>> {
    static HANDLE: OnceLock<Mutex<Option<DaemonHandle>>> = OnceLock::new();
    HANDLE.get_or_init(|| Mutex::new(None))
}

fn throw(env: &mut JNIEnv<'_>, message: impl AsRef<str>) {
    let _ = env.throw_new("java/lang/IllegalStateException", message.as_ref());
}

#[no_mangle]
pub extern "system" fn Java_com_orc_torrent_engine_OrcNative_nativeStart(
    mut env: JNIEnv,
    _class: JClass,
    config_json: JString,
    broker: JObject,
) -> jstring {
    let result = (|| -> anyhow::Result<String> {
        let config_json: String = env.get_string(&config_json)?.into();
        let config: StartConfig = serde_json::from_str(&config_json)?;
        let vm = env.get_java_vm()?;
        let broker = Arc::new(JavaDocumentTreeBroker {
            vm,
            object: env.new_global_ref(broker)?,
        });
        let storage = AndroidSafStorageFactory::new(config.download_dir.clone(), broker).boxed();
        let mut runtime = DaemonRuntimeConfig::android(
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            config.admin_token.clone(),
            config.download_dir,
            config.config_dir,
            config.state_dir,
        );
        runtime.storage_factory = Some(storage);
        runtime.network_status_provider = Some(network_status().clone());
        runtime.network_disabled_at_start = config.start_paused;
        let handle = spawn_daemon(runtime)?;
        let base_url = format!("http://{}", handle.local_addr);
        *handle_slot()
            .lock()
            .map_err(|_| anyhow::anyhow!("daemon lock poisoned"))? = Some(handle);
        Ok(serde_json::json!({
            "baseUrl": base_url,
            "adminToken": config.admin_token,
        })
        .to_string())
    })();

    match result.and_then(|value| Ok(env.new_string(value)?.into_raw())) {
        Ok(value) => value,
        Err(error) => {
            throw(&mut env, error.to_string());
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_orc_torrent_engine_OrcNative_nativeUpdateNetwork(
    _env: JNIEnv,
    _class: JClass,
    vpn_active: jni::sys::jboolean,
    transfers_allowed: jni::sys::jboolean,
    rebind_required: jni::sys::jboolean,
) {
    network_status()
        .vpn_active
        .store(vpn_active != 0, Ordering::Release);
    network_status()
        .transfers_allowed
        .store(transfers_allowed != 0, Ordering::Release);
    if rebind_required != 0 {
        network_status()
            .rebind_required
            .store(true, Ordering::Release);
    }
}

#[no_mangle]
pub extern "system" fn Java_com_orc_torrent_engine_OrcNative_nativeStop(
    _env: JNIEnv,
    _class: JClass,
) {
    if let Ok(mut slot) = handle_slot().lock() {
        if let Some(handle) = slot.take() {
            let _ = handle.join();
        }
    }
}
