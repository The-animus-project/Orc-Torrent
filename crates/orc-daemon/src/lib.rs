//! Embeddable ORC daemon runtime.
//!
//! The desktop binary and Android JNI library intentionally share this implementation.

// Android disables the desktop search and watch-folder routes, leaving their shared
// request types and handlers intentionally unreachable in this embedded build.
#![cfg_attr(
    not(any(feature = "desktop-search", feature = "desktop-watch-folders")),
    allow(dead_code)
)]

include!("main.rs");
