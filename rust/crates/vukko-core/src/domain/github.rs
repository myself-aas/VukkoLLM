//! GitHub domain model.
//!
//! Mirror of `src/types/github.ts` and `GitHubModels.kt`. GitHub's numeric ids
//! are carried as decimal strings so JavaScript precision cannot truncate them.

use serde::{Deserialize, Serialize};

use super::chat::Timestamp;

// Variant names are the Kotlin enum names and the serde wire values are the
// persisted contract; renaming any of them would change stored data.
#[allow(clippy::upper_case_acronyms, non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PRState {
    // The variants are already upper case, and `rename_all` would re-case the
    // *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
    // every persisted value. An explicit rename is a no-op for Rust and a contract
    // for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "OPEN")]
    OPEN,
    #[serde(rename = "CLOSED")]
    CLOSED,
    #[serde(rename = "MERGED")]
    MERGED,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    /// GitHub's numeric id as a decimal string.
    pub id: String,
    pub name: String,
    pub full_name: String,
    pub owner: String,
    pub description: String,
    pub is_private: bool,
    pub default_branch: String,
    pub stars_count: u32,
    pub forks_count: u32,
    pub open_issues_count: u32,
    pub updated_at: Timestamp,
    pub clone_url: String,
    pub html_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCommit {
    pub sha: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub date: Timestamp,
    pub html_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubBranch {
    pub name: String,
    pub commit_sha: String,
    pub is_protected: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequest {
    /// GitHub's numeric id as a decimal string.
    pub id: String,
    pub number: u32,
    pub title: String,
    pub body: String,
    pub state: PRState,
    pub head_branch: String,
    pub base_branch: String,
    pub author: String,
    pub html_url: String,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUserProfile {
    pub login: String,
    pub name: String,
    pub avatar_url: String,
    /// GitHub's numeric id as a decimal string.
    pub id: String,
    pub public_repos: u32,
}

// Variant names are the Kotlin enum names, and the serde wire values are
// part of the persisted contract; renaming any of them changes stored data.
#[allow(
    clippy::upper_case_acronyms,
    clippy::enum_variant_names,
    non_camel_case_types
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GitHubAuthStatus {
    // The variants are already upper case, and `rename_all` would re-case the
    // *identifier* — NOT_FOUND serialises as N_O_T__F_O_U_N_D — which would break
    // every persisted value. An explicit rename is a no-op for Rust and a contract
    // for the wire, so the shape cannot drift with a serde default.
    #[serde(rename = "UNLINKED")]
    UNLINKED,
    #[serde(rename = "REQUESTING_CODE")]
    REQUESTING_CODE,
    #[serde(rename = "CODE_RECEIVED")]
    CODE_RECEIVED,
    #[serde(rename = "POLLING_TOKEN")]
    POLLING_TOKEN,
    #[serde(rename = "CONNECTED")]
    CONNECTED,
    #[serde(rename = "ERROR")]
    ERROR,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: Timestamp,
    pub interval_seconds: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_ids_are_strings_on_the_wire() {
        let repo = GitHubRepository {
            id: "123456789012345678".into(),
            name: "vukko".into(),
            full_name: "myself-aas/vukko".into(),
            owner: "myself-aas".into(),
            description: String::new(),
            is_private: false,
            default_branch: "main".into(),
            stars_count: 0,
            forks_count: 0,
            open_issues_count: 0,
            updated_at: 1_700_000_000_000,
            clone_url: String::new(),
            html_url: String::new(),
        };
        let json = serde_json::to_value(&repo).unwrap();
        assert_eq!(json["id"], "123456789012345678");
        assert_eq!(json["fullName"], "myself-aas/vukko");
    }

    #[test]
    fn pull_request_state_uses_kotlin_names() {
        assert_eq!(
            serde_json::to_string(&PRState::MERGED).unwrap(),
            "\"MERGED\""
        );
    }
}
