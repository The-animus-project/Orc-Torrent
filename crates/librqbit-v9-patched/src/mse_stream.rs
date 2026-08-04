use std::{
    collections::VecDeque,
    io::IoSliceMut,
    pin::Pin,
    task::{Context, Poll},
};

use orc_mse::Rc4Cipher;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use crate::{
    type_aliases::{BoxAsyncReadVectored, BoxAsyncWrite},
    vectored_traits::AsyncReadVectored,
};

pub(crate) struct PrefixedReader<'a> {
    prefix: VecDeque<u8>,
    inner: &'a mut (dyn AsyncReadVectored + Unpin + Send),
}

impl<'a> PrefixedReader<'a> {
    pub(crate) fn new(prefix: impl Into<Vec<u8>>, inner: &'a mut BoxAsyncReadVectored) -> Self {
        Self {
            prefix: prefix.into().into(),
            inner: inner.as_mut(),
        }
    }
}

impl AsyncRead for PrefixedReader<'_> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        while buf.remaining() > 0 {
            let Some(value) = self.prefix.pop_front() else {
                break;
            };
            buf.put_slice(&[value]);
        }
        if buf.filled().len() > before {
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut *self.inner).poll_read(cx, buf)
    }
}

pub(crate) struct MseReader {
    inner: BoxAsyncReadVectored,
    cipher: Rc4Cipher,
}

impl MseReader {
    pub(crate) fn boxed(inner: BoxAsyncReadVectored, cipher: Rc4Cipher) -> BoxAsyncReadVectored {
        Box::new(Self { inner, cipher })
    }
}

impl AsyncRead for MseReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut *self.inner).poll_read(cx, buf);
        if matches!(result, Poll::Ready(Ok(()))) {
            self.cipher.apply(&mut buf.filled_mut()[before..]);
        }
        result
    }
}

impl AsyncReadVectored for MseReader {
    fn poll_read_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        vec: &mut [IoSliceMut<'_>],
    ) -> Poll<std::io::Result<usize>> {
        let result = Pin::new(&mut *self.inner).poll_read_vectored(cx, vec);
        if let Poll::Ready(Ok(mut remaining)) = result {
            for slice in vec {
                let take = remaining.min(slice.len());
                self.cipher.apply(&mut slice[..take]);
                remaining -= take;
                if remaining == 0 {
                    break;
                }
            }
        }
        result
    }
}

pub(crate) struct MseWriter {
    inner: BoxAsyncWrite,
    cipher: Rc4Cipher,
    pending: Vec<u8>,
    pending_offset: usize,
}

impl MseWriter {
    pub(crate) fn boxed(inner: BoxAsyncWrite, cipher: Rc4Cipher) -> BoxAsyncWrite {
        Box::new(Self {
            inner,
            cipher,
            pending: Vec::new(),
            pending_offset: 0,
        })
    }
}

impl AsyncWrite for MseWriter {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<Result<usize, std::io::Error>> {
        if self.pending_offset < self.pending.len() {
            let pending = self.pending[self.pending_offset..].to_vec();
            return match Pin::new(&mut *self.inner).poll_write(cx, &pending) {
                Poll::Ready(Ok(written)) => {
                    self.pending_offset += written;
                    if self.pending_offset == self.pending.len() {
                        self.pending.clear();
                        self.pending_offset = 0;
                    }
                    Poll::Ready(Ok(written.min(buf.len())))
                }
                other => other,
            };
        }

        let mut encrypted = buf.to_vec();
        self.cipher.apply(&mut encrypted);
        self.pending = encrypted;
        self.pending_offset = 0;
        let pending = self.pending.clone();
        match Pin::new(&mut *self.inner).poll_write(cx, &pending) {
            Poll::Ready(Ok(written)) => {
                self.pending_offset = written;
                if self.pending_offset == self.pending.len() {
                    self.pending.clear();
                    self.pending_offset = 0;
                }
                Poll::Ready(Ok(written))
            }
            Poll::Ready(Err(error)) => {
                self.pending.clear();
                self.pending_offset = 0;
                Poll::Ready(Err(error))
            }
            Poll::Pending => Poll::Pending,
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        if self.pending_offset < self.pending.len() {
            return Poll::Pending;
        }
        Pin::new(&mut *self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        if self.pending_offset < self.pending.len() {
            return Poll::Pending;
        }
        Pin::new(&mut *self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::PrefixedReader;
    use crate::type_aliases::BoxAsyncReadVectored;
    use librqbit_core::hash_id::Id20;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn prefixed_reader_preserves_a_tcp_mse_public_key() {
        const INFO_HASH: [u8; 20] = *b"01234567890123456789";
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let wanted = orc_mse::request_two_hash(&INFO_HASH);
        let responder = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            let mut read: BoxAsyncReadVectored = Box::new(read);
            let mut prefix = [0u8; 20];
            read.read_exact(&mut prefix).await.unwrap();
            let mut prefixed = PrefixedReader::new(prefix, &mut read);
            orc_mse::negotiate_responder(&mut prefixed, &mut write, |hash| {
                (*hash == wanted).then_some(INFO_HASH)
            })
            .await
        });
        let stream = tokio::net::TcpStream::connect(address).await.unwrap();
        let (mut read, mut write) = stream.into_split();
        let initiator =
            orc_mse::negotiate_initiator(&mut read, &mut write, INFO_HASH, b"hello").await;
        let responder = responder.await.unwrap();
        assert!(
            initiator.is_ok(),
            "initiator={initiator:?}, responder={responder:?}"
        );
        assert!(responder.is_ok(), "{responder:?}");
        assert_eq!(
            Id20::new(responder.unwrap().info_hash),
            Id20::new(INFO_HASH)
        );
    }
}
