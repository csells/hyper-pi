/// Returns true if the token matches or if auth is disabled (empty secret).
/// Handles URL-encoded tokens by decoding before comparison.
pub fn is_authorized(token: Option<&str>, secret: &str) -> bool {
    if secret.is_empty() {
        return true;
    }
    
    token.and_then(|t| {
        // URL-decode the token
        let decoded = percent_encoding::percent_decode_str(t)
            .decode_utf8()
            .ok()?
            .to_string();
        Some(decoded == secret)
    }) == Some(true)
}

/// Extract token from query string (e.g., "token=abc123&foo=bar" → Some("abc123"))
pub fn extract_token_from_query(uri: &str) -> Option<String> {
    let query = uri.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let (Some(key), Some(value)) = (parts.next(), parts.next()) {
            if key == "token" {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_secret_allows_all() {
        assert!(is_authorized(None, ""));
        assert!(is_authorized(Some("anything"), ""));
    }

    #[test]
    fn matching_token_allowed() {
        assert!(is_authorized(Some("secret123"), "secret123"));
    }

    #[test]
    fn wrong_token_rejected() {
        assert!(!is_authorized(Some("wrong"), "secret123"));
    }

    #[test]
    fn missing_token_rejected_when_secret_set() {
        assert!(!is_authorized(None, "secret123"));
    }

    #[test]
    fn url_encoded_token_matches() {
        // Token with special characters: "secret@123"
        let encoded_token = "secret%40123";
        assert!(is_authorized(Some(encoded_token), "secret@123"));
    }

    #[test]
    fn url_encoded_token_with_spaces() {
        // Token with spaces: "my secret token"
        let encoded_token = "my%20secret%20token";
        assert!(is_authorized(Some(encoded_token), "my secret token"));
    }

    #[test]
    fn extract_token_from_query_string() {
        assert_eq!(
            extract_token_from_query("/ws?token=abc123"),
            Some("abc123".to_string())
        );
        assert_eq!(
            extract_token_from_query("/ws?foo=bar&token=secret&baz=1"),
            Some("secret".to_string())
        );
        assert_eq!(extract_token_from_query("/ws?foo=bar"), None);
        assert_eq!(extract_token_from_query("/ws"), None);
    }
}
