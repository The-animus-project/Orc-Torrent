use url::form_urlencoded;

pub(crate) fn build_magnet_uri(info_hash: &str, name: &str) -> String {
    let hash = info_hash.trim().to_ascii_lowercase();
    let dn: String = form_urlencoded::byte_serialize(name.as_bytes()).collect();
    format!("magnet:?xt=urn:btih:{hash}&dn={dn}")
}

#[cfg(test)]
mod tests {
    use super::build_magnet_uri;
    use crate::search::validate_magnet_uri;

    #[test]
    fn magnet_uri_passes_validation() {
        let magnet = build_magnet_uri(
            "0123456789abcdef0123456789abcdef01234567",
            "Example Movie [1080p]",
        );
        assert!(validate_magnet_uri(&magnet).is_ok());
        assert!(magnet.contains("dn=Example"));
    }
}
