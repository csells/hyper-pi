use serde::Deserialize;

#[derive(Deserialize)]
pub struct WsAuth {
    pub token: Option<String>,
}

/// Returns true if the token matches or if auth is disabled (empty secret).
pub fn is_authorized(token: Option<&str>, secret: &str) -> bool {
    secret.is_empty() || token == Some(secret)
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
}
