//! GitHub use cases (MIGRATION_PLAN.md §8 Step 5.3).
//!
//! The Kotlin client simulated profiles, seeded repositories, generated tokens
//! and returned a fallback success whenever a call failed. This port keeps the
//! two implementations explicit instead:
//!
//! - [`GitHubService`] — the contract. Everything above it is written against
//!   this trait, so the UI cannot tell a demo build from production *by type*,
//!   only by the explicit `is_demo` flag.
//! - [`RealGitHubService`] — real HTTP through the injected transport. Every
//!   method either returns mapped data or an error; there is no fixture path.
//! - [`DemoGitHubService`] — fixtures for tests and demo builds, every record
//!   labelled as demo data.
//!
//! Neither implementation generates a credential: the only token that is ever
//! stored is the one the OAuth endpoint returned.

use std::sync::Arc;

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

use crate::domain::{
    ErrorCode, GitHubBranch, GitHubCommit, GitHubDeviceCode, GitHubPullRequest, GitHubRepository,
    GitHubUserProfile, VukkoError,
};
use crate::providers::ProviderError;

const API: &str = "https://api.github.com";
const OAUTH: &str = "https://github.com/login";

/// What a device-flow poll reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceFlowPoll {
    /// The user has not approved yet; poll again after the interval.
    Pending,
    /// The token was returned and stored.
    Connected,
    /// The flow ended without a token.
    Failed(VukkoError),
}

/// A raw HTTP response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpOutcome {
    pub status: u16,
    pub body: String,
}

/// The HTTP verbs GitHub needs. Separate from `providers::HttpTransport`
/// because GitHub reads are `GET`s, and a transport that only knows `POST`
/// would force every read to be a lie.
#[async_trait]
pub trait GitHubTransport: Send + Sync {
    async fn get(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
    ) -> Result<HttpOutcome, ProviderError>;

    async fn post(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
        body: String,
    ) -> Result<HttpOutcome, ProviderError>;
}

/// The GitHub use cases the UI depends on.
#[async_trait]
pub trait GitHubService: Send + Sync {
    /// True only for the fixture-backed implementation.
    fn is_demo(&self) -> bool;

    async fn profile(&self) -> Result<GitHubUserProfile, VukkoError>;
    async fn repositories(&self) -> Result<Vec<GitHubRepository>, VukkoError>;
    async fn commits(&self, repository: &str) -> Result<Vec<GitHubCommit>, VukkoError>;
    async fn branches(&self, repository: &str) -> Result<Vec<GitHubBranch>, VukkoError>;
    async fn pull_requests(&self, repository: &str) -> Result<Vec<GitHubPullRequest>, VukkoError>;
    async fn start_device_flow(&self) -> Result<GitHubDeviceCode, VukkoError>;
    async fn poll_device_flow(&self, device_code: &str) -> DeviceFlowPoll;
    fn disconnect(&self) -> Result<(), VukkoError>;
    fn is_connected(&self) -> bool;
}

/// Where the OAuth token lives; backed by the platform keystore.
pub trait TokenStore: Send + Sync {
    fn read(&self) -> Option<String>;
    fn write(&self, token: &str) -> Result<(), VukkoError>;
    fn clear(&self) -> Result<(), VukkoError>;
}

/// An in-memory token store, for tests and for previewing the flow.
#[derive(Debug, Default)]
pub struct MemoryTokenStore {
    token: std::sync::Mutex<Option<String>>,
}

impl MemoryTokenStore {
    pub fn new(token: Option<&str>) -> Self {
        Self {
            token: std::sync::Mutex::new(token.map(str::to_string)),
        }
    }
}

impl TokenStore for MemoryTokenStore {
    fn read(&self) -> Option<String> {
        self.token.lock().ok().and_then(|token| token.clone())
    }

    fn write(&self, token: &str) -> Result<(), VukkoError> {
        *self
            .token
            .lock()
            .map_err(|_| VukkoError::storage("token store is unavailable"))? =
            Some(token.to_string());
        Ok(())
    }

    fn clear(&self) -> Result<(), VukkoError> {
        *self
            .token
            .lock()
            .map_err(|_| VukkoError::storage("token store is unavailable"))? = None;
        Ok(())
    }
}

// ------------------------------------------------------------------- real

/// The production implementation.
pub struct RealGitHubService {
    transport: Arc<dyn GitHubTransport>,
    tokens: Arc<dyn TokenStore>,
    client_id: String,
    clock: Arc<dyn Fn() -> i64 + Send + Sync>,
}

impl RealGitHubService {
    pub fn new(
        transport: Arc<dyn GitHubTransport>,
        tokens: Arc<dyn TokenStore>,
        client_id: impl Into<String>,
        clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    ) -> Self {
        Self {
            transport,
            tokens,
            client_id: client_id.into(),
            clock,
        }
    }

    async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        authenticated: bool,
    ) -> Result<T, VukkoError> {
        self.send("GET", path, authenticated, None).await
    }

    async fn send<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        authenticated: bool,
        body: Option<serde_json::Value>,
    ) -> Result<T, VukkoError> {
        let token = self.tokens.read();
        if authenticated && token.is_none() {
            return Err(VukkoError::authentication("GitHub is not connected"));
        }

        let mut headers = vec![
            (
                "accept".to_string(),
                "application/vnd.github+json".to_string(),
            ),
            ("user-agent".to_string(), "Vukko".to_string()),
        ];
        if let Some(token) = &token {
            headers.push(("authorization".to_string(), format!("Bearer {}", token)));
        }

        let outcome = match (method, body) {
            ("GET", None) => self.transport.get(path, headers).await,
            (_, body) => {
                headers.push(("content-type".to_string(), "application/json".to_string()));
                let payload = body.unwrap_or_else(|| json!({})).to_string();
                self.transport.post(path, headers, payload).await
            }
        }
        .map_err(VukkoError::from)?;

        if !(200..300).contains(&outcome.status) {
            // A rejected token can never start working again: clear it so the
            // UI offers "Connect GitHub" instead of retrying a dead credential.
            if outcome.status == 401 {
                self.tokens.clear()?;
            }
            return Err(map_status(outcome.status, &outcome.body));
        }
        if outcome.body.trim().is_empty() {
            return Err(VukkoError::network(format!("empty response from {}", path)));
        }

        serde_json::from_str(&outcome.body).map_err(|error| {
            VukkoError::network(format!("malformed response from {}: {}", path, error))
        })
    }
}

fn map_status(status: u16, body: &str) -> VukkoError {
    let message = extract_message(body);
    match status {
        401 => VukkoError::authentication(message),
        403 if message.to_ascii_lowercase().contains("rate limit") => VukkoError::network(message)
            .retryable(true)
            .with_detail("reason", "RATE_LIMITED"),
        403 => VukkoError::authentication(message),
        404 => VukkoError::new(crate::domain::ErrorCode::NOT_FOUND, message),
        408 | 429 => VukkoError::network(message).retryable(true),
        status if status >= 500 => VukkoError::network(message).retryable(true),
        _ => VukkoError::new(crate::domain::ErrorCode::UNSUPPORTED, message),
    }
    .with_detail("status", status.to_string())
}

fn extract_message(body: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(body) {
        for key in ["message", "error_description", "error"] {
            if let Some(text) = parsed.get(key).and_then(|value| value.as_str()) {
                return text.to_string();
            }
        }
    }
    body.lines().next().unwrap_or_default().to_string()
}

fn repository_path(repository: &str) -> Result<String, VukkoError> {
    let valid = repository.split_once('/').is_some_and(|(owner, name)| {
        !owner.is_empty() && !name.is_empty() && !repository.contains(' ')
    });
    if !valid {
        return Err(VukkoError::validation(format!(
            "invalid repository name: {}",
            repository
        )));
    }
    Ok(repository.to_string())
}

/// Wire shapes, kept private: nothing above this module sees GitHub JSON.
#[derive(Deserialize)]
struct RawProfile {
    login: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    avatar_url: String,
    id: serde_json::Value,
    #[serde(default)]
    public_repos: u32,
}

impl RawProfile {
    fn into_domain(self) -> Result<GitHubUserProfile, VukkoError> {
        Ok(GitHubUserProfile {
            login: self.login,
            name: self.name.unwrap_or_default(),
            avatar_url: self.avatar_url,
            id: id_string(&self.id)?,
            public_repos: self.public_repos,
        })
    }
}

fn id_string(value: &serde_json::Value) -> Result<String, VukkoError> {
    match value {
        serde_json::Value::Number(number) => Ok(number.to_string()),
        serde_json::Value::String(text) => Ok(text.clone()),
        _ => Err(VukkoError::network("GitHub response is missing an id")),
    }
}

fn parse_timestamp(value: &str) -> Result<i64, VukkoError> {
    // RFC-3339 is what GitHub sends; only the fields we need are parsed so the
    // crate carries no date dependency.
    let (date, time) = value
        .split_once('T')
        .ok_or_else(|| VukkoError::network(format!("unparseable GitHub timestamp: {}", value)))?;
    let mut parts = date.split('-');
    let year: i64 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let month: i64 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let day: i64 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let time = time.trim_end_matches('Z');
    let mut clock = time.split(':');
    let hour: i64 = clock.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let minute: i64 = clock.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let second: i64 = clock
        .next()
        .and_then(|part| part.split('.').next())
        .and_then(|part| part.parse().ok())
        .unwrap_or(0);
    if year == 0 || month == 0 || day == 0 {
        return Err(VukkoError::network(format!(
            "unparseable GitHub timestamp: {}",
            value
        )));
    }
    Ok((days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * month + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[async_trait]
impl GitHubService for RealGitHubService {
    fn is_demo(&self) -> bool {
        false
    }

    async fn profile(&self) -> Result<GitHubUserProfile, VukkoError> {
        let raw: RawProfile = self.get(&format!("{}/user", API), true).await?;
        raw.into_domain()
    }

    async fn repositories(&self) -> Result<Vec<GitHubRepository>, VukkoError> {
        #[derive(Deserialize)]
        struct RawRepo {
            id: serde_json::Value,
            name: String,
            full_name: String,
            owner: RawOwner,
            #[serde(default)]
            description: Option<String>,
            #[serde(default)]
            private: bool,
            #[serde(default)]
            default_branch: String,
            #[serde(default)]
            stargazers_count: u32,
            #[serde(default)]
            forks_count: u32,
            #[serde(default)]
            open_issues_count: u32,
            updated_at: String,
            #[serde(default)]
            clone_url: String,
            #[serde(default)]
            html_url: String,
        }
        #[derive(Deserialize)]
        struct RawOwner {
            login: String,
        }

        let raw: Vec<RawRepo> = self
            .get(
                &format!("{}/user/repos?per_page=100&sort=updated", API),
                true,
            )
            .await?;
        raw.into_iter()
            .map(|repo| {
                Ok(GitHubRepository {
                    id: id_string(&repo.id)?,
                    name: repo.name,
                    full_name: repo.full_name,
                    owner: repo.owner.login,
                    description: repo.description.unwrap_or_default(),
                    is_private: repo.private,
                    default_branch: repo.default_branch,
                    stars_count: repo.stargazers_count,
                    forks_count: repo.forks_count,
                    open_issues_count: repo.open_issues_count,
                    updated_at: parse_timestamp(&repo.updated_at)?,
                    clone_url: repo.clone_url,
                    html_url: repo.html_url,
                })
            })
            .collect()
    }

    async fn commits(&self, repository: &str) -> Result<Vec<GitHubCommit>, VukkoError> {
        #[derive(Deserialize)]
        struct RawCommitInner {
            message: String,
            author: RawAuthor,
        }
        #[derive(Deserialize)]
        struct RawAuthor {
            name: String,
            email: String,
            date: String,
        }
        #[derive(Deserialize)]
        struct RawCommit {
            sha: String,
            commit: RawCommitInner,
            #[serde(default)]
            html_url: String,
        }

        let path = format!(
            "{}/repos/{}/commits?per_page=50",
            API,
            repository_path(repository)?
        );
        let raw: Vec<RawCommit> = self.get(&path, true).await?;
        raw.into_iter()
            .map(|commit| {
                Ok(GitHubCommit {
                    sha: commit.sha,
                    message: commit.commit.message,
                    author_name: commit.commit.author.name,
                    author_email: commit.commit.author.email,
                    date: parse_timestamp(&commit.commit.author.date)?,
                    html_url: commit.html_url,
                })
            })
            .collect()
    }

    async fn branches(&self, repository: &str) -> Result<Vec<GitHubBranch>, VukkoError> {
        #[derive(Deserialize)]
        struct RawBranchCommit {
            sha: String,
        }
        #[derive(Deserialize)]
        struct RawBranch {
            name: String,
            commit: RawBranchCommit,
            #[serde(default)]
            protected: bool,
        }

        let path = format!(
            "{}/repos/{}/branches?per_page=100",
            API,
            repository_path(repository)?
        );
        let raw: Vec<RawBranch> = self.get(&path, true).await?;
        Ok(raw
            .into_iter()
            .map(|branch| GitHubBranch {
                name: branch.name,
                commit_sha: branch.commit.sha,
                is_protected: branch.protected,
            })
            .collect())
    }

    async fn pull_requests(&self, repository: &str) -> Result<Vec<GitHubPullRequest>, VukkoError> {
        #[derive(Deserialize)]
        struct RawRef {
            #[serde(default)]
            r#ref: String,
        }
        #[derive(Deserialize)]
        struct RawUser {
            login: String,
        }
        #[derive(Deserialize)]
        struct RawPull {
            id: serde_json::Value,
            number: u32,
            title: String,
            #[serde(default)]
            body: Option<String>,
            state: String,
            #[serde(default)]
            merged_at: Option<String>,
            head: RawRef,
            base: RawRef,
            user: RawUser,
            #[serde(default)]
            html_url: String,
            created_at: String,
        }

        let path = format!(
            "{}/repos/{}/pulls?state=all&per_page=30",
            API,
            repository_path(repository)?
        );
        let raw: Vec<RawPull> = self.get(&path, true).await?;
        raw.into_iter()
            .map(|pull| {
                let state = if pull.merged_at.is_some() {
                    crate::domain::PRState::MERGED
                } else if pull.state == "closed" {
                    crate::domain::PRState::CLOSED
                } else {
                    crate::domain::PRState::OPEN
                };
                Ok(GitHubPullRequest {
                    id: id_string(&pull.id)?,
                    number: pull.number,
                    title: pull.title,
                    body: pull.body.unwrap_or_default(),
                    state,
                    head_branch: pull.head.r#ref,
                    base_branch: pull.base.r#ref,
                    author: pull.user.login,
                    html_url: pull.html_url,
                    created_at: parse_timestamp(&pull.created_at)?,
                })
            })
            .collect()
    }

    async fn start_device_flow(&self) -> Result<GitHubDeviceCode, VukkoError> {
        if self.client_id.trim().is_empty() {
            return Err(VukkoError::new(
                crate::domain::ErrorCode::UNSUPPORTED,
                "GitHub OAuth is not configured for this build",
            ));
        }

        #[derive(Deserialize)]
        struct RawDeviceCode {
            device_code: String,
            user_code: String,
            #[serde(default)]
            verification_uri: String,
            #[serde(default)]
            expires_in: u32,
            #[serde(default)]
            interval: u32,
        }

        let started: RawDeviceCode = self
            .send(
                "POST",
                &format!("{}/device/code", OAUTH),
                false,
                Some(json!({ "client_id": self.client_id, "scope": "repo read:user" })),
            )
            .await?;

        let expires_in = if started.expires_in == 0 {
            900
        } else {
            started.expires_in
        };
        Ok(GitHubDeviceCode {
            device_code: started.device_code,
            user_code: started.user_code,
            verification_uri: if started.verification_uri.is_empty() {
                "https://github.com/login/device".to_string()
            } else {
                started.verification_uri
            },
            expires_at: (self.clock)() + i64::from(expires_in) * 1_000,
            interval_seconds: started.interval.max(5),
        })
    }

    async fn poll_device_flow(&self, device_code: &str) -> DeviceFlowPoll {
        let response: Result<serde_json::Value, VukkoError> = self
            .send(
                "POST",
                &format!("{}/oauth/access_token", OAUTH),
                false,
                Some(json!({
                    "client_id": self.client_id,
                    "device_code": device_code,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                })),
            )
            .await;

        match response {
            Ok(body) => {
                if let Some(token) = body.get("access_token").and_then(|value| value.as_str()) {
                    if !token.is_empty() {
                        return match self.tokens.write(token) {
                            Ok(()) => DeviceFlowPoll::Connected,
                            Err(error) => DeviceFlowPoll::Failed(error),
                        };
                    }
                }
                match body.get("error").and_then(|value| value.as_str()) {
                    Some("authorization_pending" | "slow_down") => DeviceFlowPoll::Pending,
                    Some("expired_token") => DeviceFlowPoll::Failed(VukkoError::authentication(
                        "The GitHub code expired; start again",
                    )),
                    Some("access_denied") => DeviceFlowPoll::Failed(VukkoError::authentication(
                        "GitHub access was denied",
                    )),
                    _ => DeviceFlowPoll::Failed(VukkoError::network("GitHub returned no token")),
                }
            }
            // A transport failure is reported, never turned into a token.
            Err(error) => DeviceFlowPoll::Failed(error),
        }
    }

    fn disconnect(&self) -> Result<(), VukkoError> {
        self.tokens.clear()
    }

    fn is_connected(&self) -> bool {
        self.tokens.read().is_some_and(|token| !token.is_empty())
    }
}

// ------------------------------------------------------------------- demo

/// Fixture-backed implementation for tests and demo builds.
///
/// Every record is labelled as demo data, and `is_demo()` is true so the UI can
/// banner it. Nothing here can produce a credential.
pub struct DemoGitHubService {
    disconnected: std::sync::atomic::AtomicBool,
}

impl DemoGitHubService {
    pub fn new() -> Self {
        Self {
            disconnected: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl Default for DemoGitHubService {
    fn default() -> Self {
        Self::new()
    }
}

const DEMO_TIME: i64 = 1_767_225_600_000;

#[async_trait]
impl GitHubService for DemoGitHubService {
    fn is_demo(&self) -> bool {
        true
    }

    async fn profile(&self) -> Result<GitHubUserProfile, VukkoError> {
        Ok(GitHubUserProfile {
            login: "demo-user".into(),
            name: "Demo user".into(),
            avatar_url: String::new(),
            id: "1000".into(),
            public_repos: 2,
        })
    }

    async fn repositories(&self) -> Result<Vec<GitHubRepository>, VukkoError> {
        Ok(vec![
            GitHubRepository {
                id: "1001".into(),
                name: "vukko-demo".into(),
                full_name: "demo-user/vukko-demo".into(),
                owner: "demo-user".into(),
                description: "Demo data — local-first knowledge base".into(),
                is_private: false,
                default_branch: "main".into(),
                stars_count: 42,
                forks_count: 3,
                open_issues_count: 1,
                updated_at: DEMO_TIME,
                clone_url: String::new(),
                html_url: String::new(),
            },
            GitHubRepository {
                id: "1002".into(),
                name: "rag-experiments".into(),
                full_name: "demo-user/rag-experiments".into(),
                owner: "demo-user".into(),
                description: "Demo data — retrieval experiments".into(),
                is_private: true,
                default_branch: "main".into(),
                stars_count: 7,
                forks_count: 0,
                open_issues_count: 0,
                updated_at: DEMO_TIME,
                clone_url: String::new(),
                html_url: String::new(),
            },
        ])
    }

    async fn commits(&self, _repository: &str) -> Result<Vec<GitHubCommit>, VukkoError> {
        Ok(vec![GitHubCommit {
            sha: "demo0001".into(),
            message: "Demo data — initial commit".into(),
            author_name: "Demo user".into(),
            author_email: "demo@example.com".into(),
            date: DEMO_TIME,
            html_url: String::new(),
        }])
    }

    async fn branches(&self, _repository: &str) -> Result<Vec<GitHubBranch>, VukkoError> {
        Ok(vec![GitHubBranch {
            name: "main".into(),
            commit_sha: "demo0001".into(),
            is_protected: true,
        }])
    }

    async fn pull_requests(&self, _repository: &str) -> Result<Vec<GitHubPullRequest>, VukkoError> {
        Ok(vec![GitHubPullRequest {
            id: "2001".into(),
            number: 1,
            title: "Demo data — example pull request".into(),
            body: "Demo data.".into(),
            state: crate::domain::PRState::OPEN,
            head_branch: "feature/demo".into(),
            base_branch: "main".into(),
            author: "demo-user".into(),
            html_url: String::new(),
            created_at: DEMO_TIME,
        }])
    }

    async fn start_device_flow(&self) -> Result<GitHubDeviceCode, VukkoError> {
        Ok(GitHubDeviceCode {
            device_code: "demo-device".into(),
            user_code: "DEMO-0000".into(),
            verification_uri: "https://github.com/login/device".into(),
            expires_at: DEMO_TIME,
            interval_seconds: 5,
        })
    }

    async fn poll_device_flow(&self, _device_code: &str) -> DeviceFlowPoll {
        DeviceFlowPoll::Connected
    }

    fn disconnect(&self) -> Result<(), VukkoError> {
        self.disconnected
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn is_connected(&self) -> bool {
        !self.disconnected.load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Records the verb and replays one canned response.
    pub struct FakeGitHubTransport {
        status: u16,
        body: String,
        verbs: std::sync::Mutex<Vec<String>>,
    }

    impl FakeGitHubTransport {
        fn new(status: u16, body: &str) -> Arc<Self> {
            Arc::new(Self {
                status,
                body: body.to_string(),
                verbs: std::sync::Mutex::new(Vec::new()),
            })
        }

        fn calls(&self) -> usize {
            self.verbs.lock().map(|verbs| verbs.len()).unwrap_or(0)
        }
    }

    #[async_trait]
    impl GitHubTransport for FakeGitHubTransport {
        async fn get(
            &self,
            _url: &str,
            _headers: Vec<(String, String)>,
        ) -> Result<HttpOutcome, ProviderError> {
            self.verbs.lock().expect("lock").push("GET".to_string());
            Ok(HttpOutcome {
                status: self.status,
                body: self.body.clone(),
            })
        }

        async fn post(
            &self,
            _url: &str,
            _headers: Vec<(String, String)>,
            _body: String,
        ) -> Result<HttpOutcome, ProviderError> {
            self.verbs.lock().expect("lock").push("POST".to_string());
            Ok(HttpOutcome {
                status: self.status,
                body: self.body.clone(),
            })
        }
    }

    fn linked(transport: Arc<FakeGitHubTransport>) -> RealGitHubService {
        RealGitHubService::new(
            transport,
            Arc::new(MemoryTokenStore::new(Some("gho_realtoken"))),
            "client",
            Arc::new(|| 1_700_000_000_000),
        )
    }

    const PROFILE: &str = r#"{"login":"octocat","name":"The Octocat","avatar_url":"https://a/u/1","id":583231,"public_repos":8}"#;

    #[tokio::test]
    async fn a_profile_is_mapped_with_ids_kept_as_strings() {
        let profile = linked(FakeGitHubTransport::new(200, PROFILE))
            .profile()
            .await
            .unwrap();
        assert_eq!(profile.id, "583231");
        assert_eq!(profile.login, "octocat");
        assert_eq!(profile.public_repos, 8);
    }

    #[tokio::test]
    async fn an_unlinked_account_fails_without_touching_the_network() {
        let transport = FakeGitHubTransport::new(200, PROFILE);
        let service = RealGitHubService::new(
            transport.clone(),
            Arc::new(MemoryTokenStore::new(None)),
            "client",
            Arc::new(|| 0),
        );

        let error = service.profile().await.unwrap_err();
        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
        assert_eq!(transport.calls(), 0);
        assert!(service.repositories().await.is_err());
    }

    #[tokio::test]
    async fn a_rejected_token_is_cleared_and_reported() {
        let tokens = Arc::new(MemoryTokenStore::new(Some("gho_stale")));
        let service = RealGitHubService::new(
            FakeGitHubTransport::new(401, r#"{"message":"Bad credentials"}"#),
            tokens.clone(),
            "client",
            Arc::new(|| 0),
        );

        let error = service.profile().await.unwrap_err();
        assert_eq!(error.code, ErrorCode::AUTHENTICATION);
        assert!(!error.retryable);
        assert!(tokens.read().is_none());
    }

    #[tokio::test]
    async fn a_rate_limit_is_retryable_network_and_a_missing_repo_is_not_found() {
        let limited = RealGitHubService::new(
            FakeGitHubTransport::new(
                403,
                r#"{"message":"API rate limit exceeded for user ID 1."}"#,
            ),
            Arc::new(MemoryTokenStore::new(Some("t"))),
            "client",
            Arc::new(|| 0),
        );
        let error = limited.repositories().await.unwrap_err();
        assert_eq!(error.code, ErrorCode::NETWORK);
        assert!(error.retryable);

        let missing = linked(FakeGitHubTransport::new(404, r#"{"message":"Not Found"}"#));
        let error = missing.commits("octocat/Hello-World").await.unwrap_err();
        assert_eq!(error.code, ErrorCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn a_malformed_body_is_a_network_error_not_an_empty_list() {
        let error = linked(FakeGitHubTransport::new(200, "<html>oops</html>"))
            .repositories()
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::NETWORK);
    }

    #[test]
    fn timestamps_are_epoch_milliseconds() {
        assert_eq!(parse_timestamp("1970-01-01T00:00:00Z").unwrap(), 0);
        assert_eq!(
            parse_timestamp("2026-01-02T03:04:05Z").unwrap(),
            1_767_323_045_000
        );
        assert!(parse_timestamp("not a date").is_err());
    }

    #[tokio::test]
    async fn the_device_flow_stores_only_the_returned_token() {
        let tokens = Arc::new(MemoryTokenStore::new(None));
        let service = RealGitHubService::new(
            FakeGitHubTransport::new(
                200,
                r#"{"access_token":"gho_fromgithub","token_type":"bearer"}"#,
            ),
            tokens.clone(),
            "client",
            Arc::new(|| 0),
        );

        assert_eq!(
            service.poll_device_flow("dev-1").await,
            DeviceFlowPoll::Connected
        );
        assert_eq!(tokens.read().as_deref(), Some("gho_fromgithub"));
    }

    #[tokio::test]
    async fn a_pending_authorisation_keeps_polling() {
        let service = RealGitHubService::new(
            FakeGitHubTransport::new(200, r#"{"error":"authorization_pending"}"#),
            Arc::new(MemoryTokenStore::new(None)),
            "client",
            Arc::new(|| 0),
        );
        assert_eq!(
            service.poll_device_flow("dev-1").await,
            DeviceFlowPoll::Pending
        );
    }

    #[tokio::test]
    async fn an_unreachable_endpoint_never_becomes_a_fake_token() {
        let tokens = Arc::new(MemoryTokenStore::new(None));
        let service = RealGitHubService::new(
            FakeGitHubTransport::new(0, ""),
            tokens.clone(),
            "client",
            Arc::new(|| 0),
        );

        match service.poll_device_flow("dev-1").await {
            DeviceFlowPoll::Failed(error) => {
                assert_eq!(error.code, ErrorCode::NETWORK)
            }
            other => panic!("expected a failure, got {:?}", other),
        }
        assert!(tokens.read().is_none());
    }

    #[tokio::test]
    async fn a_missing_client_id_is_unsupported() {
        let service = RealGitHubService::new(
            FakeGitHubTransport::new(200, "{}"),
            Arc::new(MemoryTokenStore::new(None)),
            "",
            Arc::new(|| 0),
        );
        let error = service.start_device_flow().await.unwrap_err();
        assert_eq!(error.code, ErrorCode::UNSUPPORTED);
    }

    #[tokio::test]
    async fn the_demo_service_is_labelled_and_holds_no_credential() {
        let demo = DemoGitHubService::new();
        assert!(demo.is_demo());
        let profile = demo.profile().await.unwrap();
        assert_eq!(profile.login, "demo-user");

        let repositories = demo.repositories().await.unwrap();
        assert!(repositories
            .iter()
            .all(|repo| repo.description.contains("Demo data")));

        demo.disconnect().unwrap();
        assert!(!demo.is_connected());
    }
}
