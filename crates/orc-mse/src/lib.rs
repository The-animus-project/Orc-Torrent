//! ORC-owned implementation of BitTorrent Message Stream Encryption (MSE/PE).
//!
//! MSE uses legacy Diffie-Hellman and RC4 primitives for traffic obfuscation.
//! It is interoperable peer traffic obfuscation, not authenticated encryption.

use std::{
    collections::VecDeque,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use num_bigint::BigUint;
use rand::Rng as _;
use rc4::{consts::U20, KeyInit, Rc4, StreamCipher};
use serde::{Deserialize, Serialize};
use sha1w::{ISha1 as _, Sha1};
use subtle::ConstantTimeEq as _;
use thiserror::Error;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    time::timeout,
};
use zeroize::{Zeroize, Zeroizing};

pub const PUBLIC_KEY_LEN: usize = 96;
pub const MAX_PADDING_LEN: usize = 512;
pub const MAX_INITIAL_PAYLOAD_LEN: usize = 4096;
pub const MAX_HANDSHAKE_BUFFER: usize = 8192;
pub const RC4_DISCARD_LEN: usize = 1024;
pub const DEFAULT_NEGOTIATION_TIMEOUT: Duration = Duration::from_secs(10);

const VC_LEN: usize = 8;
const HASH_LEN: usize = 20;
const CRYPTO_RC4: u32 = 0x02;
const DH_PRIME_HEX: &str = concat!(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B2251",
    "4A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C",
    "42E9A63A36210000000000090563"
);

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerTrafficMode {
    #[default]
    Off,
    Prefer,
    Require,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrafficProtection {
    #[default]
    Plaintext,
    MseRc4,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct MseStatsSnapshot {
    pub attempts: u64,
    pub successes: u64,
    pub fallbacks: u64,
    pub rejections: u64,
    pub malformed: u64,
    pub timeouts: u64,
}

#[derive(Debug, Default)]
pub struct MseStats {
    attempts: AtomicU64,
    successes: AtomicU64,
    fallbacks: AtomicU64,
    rejections: AtomicU64,
    malformed: AtomicU64,
    timeouts: AtomicU64,
}

impl MseStats {
    pub fn attempted(&self) {
        self.attempts.fetch_add(1, Ordering::Relaxed);
    }

    pub fn succeeded(&self) {
        self.successes.fetch_add(1, Ordering::Relaxed);
    }

    pub fn fallback(&self) {
        self.fallbacks.fetch_add(1, Ordering::Relaxed);
    }

    pub fn rejected(&self) {
        self.rejections.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_error(&self, error: &MseError) {
        match error {
            MseError::Timeout => {
                self.timeouts.fetch_add(1, Ordering::Relaxed);
            }
            MseError::Rc4Unavailable | MseError::UnsupportedCrypto | MseError::UnknownTorrent => {
                self.rejections.fetch_add(1, Ordering::Relaxed);
            }
            _ => {
                self.malformed.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn snapshot(&self) -> MseStatsSnapshot {
        MseStatsSnapshot {
            attempts: self.attempts.load(Ordering::Relaxed),
            successes: self.successes.load(Ordering::Relaxed),
            fallbacks: self.fallbacks.load(Ordering::Relaxed),
            rejections: self.rejections.load(Ordering::Relaxed),
            malformed: self.malformed.load(Ordering::Relaxed),
            timeouts: self.timeouts.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Error)]
pub enum MseError {
    #[error("MSE negotiation timed out")]
    Timeout,
    #[error("MSE connection ended during negotiation")]
    Eof,
    #[error("MSE I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid MSE Diffie-Hellman public key")]
    InvalidPublicKey,
    #[error("MSE synchronization marker was not found within its bound")]
    SynchronizationFailed,
    #[error("MSE initial payload exceeds {MAX_INITIAL_PAYLOAD_LEN} bytes")]
    InitialPayloadTooLarge,
    #[error("MSE padding exceeds {MAX_PADDING_LEN} bytes")]
    PaddingTooLarge,
    #[error("peer did not offer RC4 MSE")]
    Rc4Unavailable,
    #[error("peer selected an unsupported MSE crypto mode")]
    UnsupportedCrypto,
    #[error("MSE verification constant did not match")]
    VerificationFailed,
    #[error("MSE torrent hash did not match an active torrent")]
    UnknownTorrent,
    #[error("invalid MSE frame")]
    InvalidFrame,
}

#[derive(Debug, Clone)]
pub struct HandshakeMaterial {
    secret: [u8; 20],
    padding: Vec<u8>,
}

impl HandshakeMaterial {
    pub fn random() -> Self {
        let mut rng = rand::rng();
        let mut secret = [0u8; 20];
        rng.fill(&mut secret);
        if secret.iter().all(|value| *value == 0) {
            secret[19] = 1;
        }
        let padding_len = rng.random_range(0..=MAX_PADDING_LEN);
        let mut padding = vec![0u8; padding_len];
        rng.fill(padding.as_mut_slice());
        Self { secret, padding }
    }

    pub fn deterministic(secret: [u8; 20], padding: Vec<u8>) -> Result<Self, MseError> {
        if padding.len() > MAX_PADDING_LEN {
            return Err(MseError::PaddingTooLarge);
        }
        if secret.iter().all(|value| *value == 0) {
            return Err(MseError::InvalidPublicKey);
        }
        Ok(Self { secret, padding })
    }
}

impl Drop for HandshakeMaterial {
    fn drop(&mut self) {
        self.secret.zeroize();
        self.padding.zeroize();
    }
}

pub struct Rc4Cipher(Rc4<U20>);

impl std::fmt::Debug for Rc4Cipher {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_tuple("Rc4Cipher")
            .field(&"redacted")
            .finish()
    }
}

impl Rc4Cipher {
    fn new(mut key: [u8; HASH_LEN]) -> Self {
        let mut cipher = Rc4::<U20>::new((&key).into());
        let mut discard = Zeroizing::new([0u8; RC4_DISCARD_LEN]);
        cipher.apply_keystream(discard.as_mut());
        key.zeroize();
        Self(cipher)
    }

    pub fn apply(&mut self, bytes: &mut [u8]) {
        self.0.apply_keystream(bytes);
    }
}

#[derive(Debug)]
pub struct NegotiatedStream {
    pub info_hash: [u8; HASH_LEN],
    pub initial_payload: Vec<u8>,
    pub decrypt: Rc4Cipher,
    pub encrypt: Rc4Cipher,
}

struct DhExchange {
    secret: Zeroizing<[u8; 20]>,
    public: [u8; PUBLIC_KEY_LEN],
}

impl DhExchange {
    fn new(material: &HandshakeMaterial) -> Self {
        let prime = dh_prime();
        let secret = Zeroizing::new(material.secret);
        let secret_value = BigUint::from_bytes_be(secret.as_ref());
        let public_value = BigUint::from(2u8).modpow(&secret_value, &prime);
        Self {
            secret,
            public: fixed_width(&public_value),
        }
    }

    fn shared_secret(
        &self,
        remote: &[u8; PUBLIC_KEY_LEN],
    ) -> Result<[u8; PUBLIC_KEY_LEN], MseError> {
        let prime = dh_prime();
        let remote = BigUint::from_bytes_be(remote);
        if remote < BigUint::from(2u8) || remote >= (&prime - BigUint::from(1u8)) {
            return Err(MseError::InvalidPublicKey);
        }
        let secret = BigUint::from_bytes_be(self.secret.as_ref());
        Ok(fixed_width(&remote.modpow(&secret, &prime)))
    }
}

fn dh_prime() -> BigUint {
    BigUint::parse_bytes(DH_PRIME_HEX.as_bytes(), 16).expect("fixed MSE DH prime must parse")
}

fn fixed_width(value: &BigUint) -> [u8; PUBLIC_KEY_LEN] {
    let bytes = value.to_bytes_be();
    let mut result = [0u8; PUBLIC_KEY_LEN];
    let copy_len = bytes.len().min(PUBLIC_KEY_LEN);
    result[PUBLIC_KEY_LEN - copy_len..].copy_from_slice(&bytes[bytes.len() - copy_len..]);
    result
}

fn sha1(parts: &[&[u8]]) -> [u8; HASH_LEN] {
    let mut digest = Sha1::new();
    for part in parts {
        digest.update(part);
    }
    digest.finish()
}

pub fn request_two_hash(info_hash: &[u8; HASH_LEN]) -> [u8; HASH_LEN] {
    sha1(&[b"req2", info_hash])
}

fn request_one_hash(shared: &[u8; PUBLIC_KEY_LEN]) -> [u8; HASH_LEN] {
    sha1(&[b"req1", shared])
}

fn request_three_hash(shared: &[u8; PUBLIC_KEY_LEN]) -> [u8; HASH_LEN] {
    sha1(&[b"req3", shared])
}

fn encryption_keys(
    shared: &[u8; PUBLIC_KEY_LEN],
    info_hash: &[u8; HASH_LEN],
) -> ([u8; HASH_LEN], [u8; HASH_LEN]) {
    (
        sha1(&[b"keyA", shared, info_hash]),
        sha1(&[b"keyB", shared, info_hash]),
    )
}

async fn read_exact<R: AsyncRead + Unpin + ?Sized>(
    reader: &mut R,
    bytes: &mut [u8],
) -> Result<(), MseError> {
    reader.read_exact(bytes).await.map(|_| ()).map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            MseError::Eof
        } else {
            MseError::Io(error)
        }
    })
}

async fn find_marker<R: AsyncRead + Unpin + ?Sized>(
    reader: &mut R,
    marker: &[u8],
    max_prefix: usize,
) -> Result<(), MseError> {
    let mut window = VecDeque::with_capacity(marker.len());
    for _ in 0..(max_prefix + marker.len()) {
        let mut byte = [0u8; 1];
        read_exact(reader, &mut byte).await?;
        if window.len() == marker.len() {
            window.pop_front();
        }
        window.push_back(byte[0]);
        if window.len() == marker.len()
            && window
                .iter()
                .copied()
                .zip(marker.iter().copied())
                .all(|(left, right)| left == right)
        {
            return Ok(());
        }
    }
    Err(MseError::SynchronizationFailed)
}

async fn read_encrypted<R: AsyncRead + Unpin + ?Sized>(
    reader: &mut R,
    cipher: &mut Rc4Cipher,
    bytes: &mut [u8],
) -> Result<(), MseError> {
    read_exact(reader, bytes).await?;
    cipher.apply(bytes);
    Ok(())
}

async fn write_encrypted<W: AsyncWrite + Unpin + ?Sized>(
    writer: &mut W,
    cipher: &mut Rc4Cipher,
    bytes: &mut [u8],
) -> Result<(), MseError> {
    cipher.apply(bytes);
    writer.write_all(bytes).await?;
    Ok(())
}

pub async fn negotiate_initiator<R, W>(
    reader: &mut R,
    writer: &mut W,
    info_hash: [u8; HASH_LEN],
    initial_payload: &[u8],
) -> Result<NegotiatedStream, MseError>
where
    R: AsyncRead + Unpin + ?Sized,
    W: AsyncWrite + Unpin + ?Sized,
{
    negotiate_initiator_with_material(
        reader,
        writer,
        info_hash,
        initial_payload,
        HandshakeMaterial::random(),
    )
    .await
}

pub async fn negotiate_initiator_with_material<R, W>(
    reader: &mut R,
    writer: &mut W,
    info_hash: [u8; HASH_LEN],
    initial_payload: &[u8],
    material: HandshakeMaterial,
) -> Result<NegotiatedStream, MseError>
where
    R: AsyncRead + Unpin + ?Sized,
    W: AsyncWrite + Unpin + ?Sized,
{
    if initial_payload.len() > MAX_INITIAL_PAYLOAD_LEN {
        return Err(MseError::InitialPayloadTooLarge);
    }
    timeout(
        DEFAULT_NEGOTIATION_TIMEOUT,
        initiator_inner(reader, writer, info_hash, initial_payload, material),
    )
    .await
    .map_err(|_| MseError::Timeout)?
}

async fn initiator_inner<R, W>(
    reader: &mut R,
    writer: &mut W,
    info_hash: [u8; HASH_LEN],
    initial_payload: &[u8],
    material: HandshakeMaterial,
) -> Result<NegotiatedStream, MseError>
where
    R: AsyncRead + Unpin + ?Sized,
    W: AsyncWrite + Unpin + ?Sized,
{
    let exchange = DhExchange::new(&material);
    writer.write_all(&exchange.public).await?;
    writer.write_all(&material.padding).await?;

    let mut remote_public = [0u8; PUBLIC_KEY_LEN];
    read_exact(reader, &mut remote_public).await?;
    let mut shared = Zeroizing::new(exchange.shared_secret(&remote_public)?);

    let req1 = request_one_hash(&shared);
    let mut obfuscated = request_two_hash(&info_hash);
    let req3 = request_three_hash(&shared);
    for (left, right) in obfuscated.iter_mut().zip(req3) {
        *left ^= right;
    }
    writer.write_all(&req1).await?;
    writer.write_all(&obfuscated).await?;

    let (key_a, key_b) = encryption_keys(&shared, &info_hash);
    let mut encrypt = Rc4Cipher::new(key_a);
    let mut decrypt = Rc4Cipher::new(key_b);

    let mut offer = Vec::with_capacity(VC_LEN + 4 + 2 + 2 + initial_payload.len());
    offer.extend_from_slice(&[0u8; VC_LEN]);
    offer.extend_from_slice(&CRYPTO_RC4.to_be_bytes());
    offer.extend_from_slice(&0u16.to_be_bytes());
    offer.extend_from_slice(&(initial_payload.len() as u16).to_be_bytes());
    offer.extend_from_slice(initial_payload);
    write_encrypted(writer, &mut encrypt, &mut offer).await?;
    writer.flush().await?;

    let mut encrypted_vc = [0u8; VC_LEN];
    decrypt.apply(&mut encrypted_vc);
    find_marker(reader, &encrypted_vc, MAX_PADDING_LEN).await?;

    let mut selected = [0u8; 4];
    read_encrypted(reader, &mut decrypt, &mut selected).await?;
    if u32::from_be_bytes(selected) != CRYPTO_RC4 {
        return Err(MseError::UnsupportedCrypto);
    }
    let mut pad_len = [0u8; 2];
    read_encrypted(reader, &mut decrypt, &mut pad_len).await?;
    let pad_len = u16::from_be_bytes(pad_len) as usize;
    if pad_len > MAX_PADDING_LEN {
        return Err(MseError::PaddingTooLarge);
    }
    let mut padding = Zeroizing::new(vec![0u8; pad_len]);
    read_encrypted(reader, &mut decrypt, padding.as_mut_slice()).await?;
    shared.zeroize();

    Ok(NegotiatedStream {
        info_hash,
        initial_payload: Vec::new(),
        decrypt,
        encrypt,
    })
}

pub async fn negotiate_responder<R, W, F>(
    reader: &mut R,
    writer: &mut W,
    lookup: F,
) -> Result<NegotiatedStream, MseError>
where
    R: AsyncRead + Unpin + ?Sized,
    W: AsyncWrite + Unpin + ?Sized,
    F: Fn(&[u8; HASH_LEN]) -> Option<[u8; HASH_LEN]>,
{
    negotiate_responder_with_material(reader, writer, lookup, HandshakeMaterial::random()).await
}

pub async fn negotiate_responder_with_material<R, W, F>(
    reader: &mut R,
    writer: &mut W,
    lookup: F,
    material: HandshakeMaterial,
) -> Result<NegotiatedStream, MseError>
where
    R: AsyncRead + Unpin + ?Sized,
    W: AsyncWrite + Unpin + ?Sized,
    F: Fn(&[u8; HASH_LEN]) -> Option<[u8; HASH_LEN]>,
{
    timeout(
        DEFAULT_NEGOTIATION_TIMEOUT,
        responder_inner(reader, writer, lookup, material),
    )
    .await
    .map_err(|_| MseError::Timeout)?
}

async fn responder_inner<R, W, F>(
    reader: &mut R,
    writer: &mut W,
    lookup: F,
    material: HandshakeMaterial,
) -> Result<NegotiatedStream, MseError>
where
    R: AsyncRead + Unpin + ?Sized,
    W: AsyncWrite + Unpin + ?Sized,
    F: Fn(&[u8; HASH_LEN]) -> Option<[u8; HASH_LEN]>,
{
    let exchange = DhExchange::new(&material);
    let mut remote_public = [0u8; PUBLIC_KEY_LEN];
    read_exact(reader, &mut remote_public).await?;
    let mut shared = Zeroizing::new(exchange.shared_secret(&remote_public)?);
    writer.write_all(&exchange.public).await?;
    writer.write_all(&material.padding).await?;
    writer.flush().await?;

    let req1 = request_one_hash(&shared);
    find_marker(reader, &req1, MAX_PADDING_LEN).await?;
    let mut obfuscated = [0u8; HASH_LEN];
    read_exact(reader, &mut obfuscated).await?;
    let req3 = request_three_hash(&shared);
    for (left, right) in obfuscated.iter_mut().zip(req3) {
        *left ^= right;
    }
    let info_hash = lookup(&obfuscated).ok_or(MseError::UnknownTorrent)?;

    let (key_a, key_b) = encryption_keys(&shared, &info_hash);
    let mut decrypt = Rc4Cipher::new(key_a);
    let mut encrypt = Rc4Cipher::new(key_b);

    let mut vc = [0u8; VC_LEN];
    read_encrypted(reader, &mut decrypt, &mut vc).await?;
    if vc.ct_eq(&[0u8; VC_LEN]).unwrap_u8() != 1 {
        return Err(MseError::VerificationFailed);
    }
    let mut offered = [0u8; 4];
    read_encrypted(reader, &mut decrypt, &mut offered).await?;
    if u32::from_be_bytes(offered) & CRYPTO_RC4 == 0 {
        return Err(MseError::Rc4Unavailable);
    }
    let mut pad_len = [0u8; 2];
    read_encrypted(reader, &mut decrypt, &mut pad_len).await?;
    let pad_len = u16::from_be_bytes(pad_len) as usize;
    if pad_len > MAX_PADDING_LEN {
        return Err(MseError::PaddingTooLarge);
    }
    let mut padding = Zeroizing::new(vec![0u8; pad_len]);
    read_encrypted(reader, &mut decrypt, padding.as_mut_slice()).await?;
    let mut initial_len = [0u8; 2];
    read_encrypted(reader, &mut decrypt, &mut initial_len).await?;
    let initial_len = u16::from_be_bytes(initial_len) as usize;
    if initial_len > MAX_INITIAL_PAYLOAD_LEN {
        return Err(MseError::InitialPayloadTooLarge);
    }
    let mut initial_payload = vec![0u8; initial_len];
    read_encrypted(reader, &mut decrypt, &mut initial_payload).await?;

    let mut response = Vec::with_capacity(VC_LEN + 4 + 2);
    response.extend_from_slice(&[0u8; VC_LEN]);
    response.extend_from_slice(&CRYPTO_RC4.to_be_bytes());
    response.extend_from_slice(&0u16.to_be_bytes());
    write_encrypted(writer, &mut encrypt, &mut response).await?;
    writer.flush().await?;
    shared.zeroize();

    Ok(NegotiatedStream {
        info_hash,
        initial_payload,
        decrypt,
        encrypt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        pin::Pin,
        task::{Context, Poll},
    };
    use tokio::io::ReadBuf;

    const INFO_HASH: [u8; 20] = *b"01234567890123456789";

    fn material(value: u8, padding: usize) -> HandshakeMaterial {
        HandshakeMaterial::deterministic([value; 20], vec![value ^ 0x55; padding]).unwrap()
    }

    #[test]
    fn transcript_hashes_are_deterministic() {
        let shared = [0x11; PUBLIC_KEY_LEN];
        assert_eq!(
            hex::encode(request_two_hash(&INFO_HASH)),
            "20ae755ddb8286de5557f11bde796c98902a8866"
        );
        assert_eq!(
            hex::encode(request_one_hash(&shared)),
            "1db9cc1011525de84a7bf6e97c1b42142bc033cb"
        );
        assert_eq!(
            hex::encode(request_three_hash(&shared)),
            "d723a53f6a3030799b1961a483d388624f769b43"
        );
        let (key_a, key_b) = encryption_keys(&shared, &INFO_HASH);
        assert_eq!(
            hex::encode(key_a),
            "6c73a9035ca5861a10c4a22cfdcd7e0e35c068c8"
        );
        assert_eq!(
            hex::encode(key_b),
            "102186a9b00ec43bcece443d339851b87eb6e446"
        );
    }

    struct OneByteReader<R>(R);

    impl<R: AsyncRead + Unpin> AsyncRead for OneByteReader<R> {
        fn poll_read(
            mut self: Pin<&mut Self>,
            cx: &mut Context<'_>,
            output: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            if output.remaining() == 0 {
                return Poll::Ready(Ok(()));
            }
            let mut byte = [0u8; 1];
            let mut one = ReadBuf::new(&mut byte);
            match Pin::new(&mut self.0).poll_read(cx, &mut one) {
                Poll::Ready(Ok(())) => {
                    output.put_slice(one.filled());
                    Poll::Ready(Ok(()))
                }
                Poll::Ready(Err(error)) => Poll::Ready(Err(error)),
                Poll::Pending => Poll::Pending,
            }
        }
    }

    #[test]
    fn rejects_degenerate_public_keys() {
        let exchange = DhExchange::new(&material(7, 0));
        assert!(matches!(
            exchange.shared_secret(&[0u8; PUBLIC_KEY_LEN]),
            Err(MseError::InvalidPublicKey)
        ));
    }

    #[tokio::test]
    async fn responder_rejects_invalid_public_key() {
        let (mut initiator, mut responder) = tokio::io::duplex(1024);
        initiator.write_all(&[0u8; PUBLIC_KEY_LEN]).await.unwrap();
        let error = negotiate_responder(&mut responder, &mut tokio::io::sink(), |_| None)
            .await
            .unwrap_err();
        assert!(matches!(error, MseError::InvalidPublicKey));
    }

    #[tokio::test]
    async fn responder_bounds_synchronization_scan() {
        let (mut initiator, mut responder) = tokio::io::duplex(MAX_HANDSHAKE_BUFFER);
        let exchange = DhExchange::new(&material(5, 0));
        initiator.write_all(&exchange.public).await.unwrap();
        initiator
            .write_all(&vec![0xa5; MAX_PADDING_LEN + HASH_LEN])
            .await
            .unwrap();
        let error = negotiate_responder(&mut responder, &mut tokio::io::sink(), |_| None)
            .await
            .unwrap_err();
        assert!(matches!(error, MseError::SynchronizationFailed));
    }

    #[tokio::test(start_paused = true)]
    async fn negotiation_uses_one_absolute_deadline() {
        let (stream, _silent_peer) = tokio::io::duplex(1024);
        let (mut reader, mut writer) = tokio::io::split(stream);
        let task = tokio::spawn(async move {
            negotiate_initiator(&mut reader, &mut writer, INFO_HASH, &[]).await
        });
        tokio::task::yield_now().await;
        tokio::time::advance(DEFAULT_NEGOTIATION_TIMEOUT + Duration::from_secs(1)).await;
        assert!(matches!(task.await.unwrap(), Err(MseError::Timeout)));
    }

    #[tokio::test]
    async fn initiator_and_responder_round_trip() {
        let (left, right) = tokio::io::duplex(MAX_HANDSHAKE_BUFFER * 2);
        let (mut left_read, mut left_write) = tokio::io::split(left);
        let (mut right_read, mut right_write) = tokio::io::split(right);
        let payload = b"BitTorrent handshake payload".to_vec();
        let wanted = request_two_hash(&INFO_HASH);

        let initiator = negotiate_initiator_with_material(
            &mut left_read,
            &mut left_write,
            INFO_HASH,
            &payload,
            material(3, MAX_PADDING_LEN),
        );
        let responder = negotiate_responder_with_material(
            &mut right_read,
            &mut right_write,
            |hash| (*hash == wanted).then_some(INFO_HASH),
            material(9, MAX_PADDING_LEN),
        );
        let (initiator, responder) = tokio::join!(initiator, responder);
        let mut initiator = initiator.unwrap();
        let mut responder = responder.unwrap();
        assert_eq!(responder.initial_payload, payload);

        let mut message = b"encrypted peer payload".to_vec();
        initiator.encrypt.apply(&mut message);
        responder.decrypt.apply(&mut message);
        assert_eq!(message, b"encrypted peer payload");

        let mut reply = b"encrypted peer reply".to_vec();
        responder.encrypt.apply(&mut reply);
        initiator.decrypt.apply(&mut reply);
        assert_eq!(reply, b"encrypted peer reply");
    }

    #[tokio::test]
    async fn negotiation_accepts_one_byte_fragmentation() {
        let (left, right) = tokio::io::duplex(MAX_HANDSHAKE_BUFFER * 2);
        let (left_read, mut left_write) = tokio::io::split(left);
        let (right_read, mut right_write) = tokio::io::split(right);
        let mut left_read = OneByteReader(left_read);
        let mut right_read = OneByteReader(right_read);
        let payload = vec![0x5a; 68];
        let wanted = request_two_hash(&INFO_HASH);

        let initiator = negotiate_initiator_with_material(
            &mut left_read,
            &mut left_write,
            INFO_HASH,
            &payload,
            material(4, MAX_PADDING_LEN),
        );
        let responder = negotiate_responder_with_material(
            &mut right_read,
            &mut right_write,
            |hash| (*hash == wanted).then_some(INFO_HASH),
            material(8, MAX_PADDING_LEN),
        );
        let (initiator, responder) = tokio::join!(initiator, responder);
        assert!(initiator.is_ok());
        assert_eq!(responder.unwrap().initial_payload, payload);
    }

    #[tokio::test]
    async fn negotiation_works_over_tcp_split_halves() {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let wanted = request_two_hash(&INFO_HASH);
        let responder = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (mut reader, mut writer) = stream.into_split();
            negotiate_responder_with_material(
                &mut reader,
                &mut writer,
                |hash| (*hash == wanted).then_some(INFO_HASH),
                material(6, 37),
            )
            .await
        });
        let stream = tokio::net::TcpStream::connect(address).await.unwrap();
        let (mut reader, mut writer) = stream.into_split();
        let initiator = negotiate_initiator_with_material(
            &mut reader,
            &mut writer,
            INFO_HASH,
            b"hello",
            material(2, 19),
        )
        .await
        .unwrap();
        let responder = responder.await.unwrap().unwrap();
        assert_eq!(initiator.info_hash, responder.info_hash);
        assert_eq!(responder.initial_payload, b"hello");
    }

    #[tokio::test]
    async fn oversized_initial_payload_is_rejected_before_io() {
        let (mut left, _right) = tokio::io::duplex(64);
        let error = negotiate_initiator(
            &mut left,
            &mut tokio::io::sink(),
            INFO_HASH,
            &vec![0u8; MAX_INITIAL_PAYLOAD_LEN + 1],
        )
        .await
        .unwrap_err();
        assert!(matches!(error, MseError::InitialPayloadTooLarge));
    }
}
