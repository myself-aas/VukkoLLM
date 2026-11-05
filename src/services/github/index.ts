/**
 * GitHub service (MIGRATION_PLAN.md §8 Step 5.3).
 *
 * The Kotlin service simulated profiles, seeded repositories, generated tokens
 * and returned a fallback success whenever a call failed — so a signed-out or
 * rate-limited user saw someone else's data and believed they were connected.
 * This replaces it with two explicit implementations:
 *
 * - `createGitHubService` — production. Real HTTP, real token, structured
 *   errors, and a failure always surfaces as a failure.
 * - `createDemoGitHubService` — tests and demo builds only. Fixtures are
 *   labelled as demo data and can never be reached from the production path.
 */

import type {
  GitHubAuthStatus,
  GitHubBranch,
  GitHubCommit,
  GitHubDeviceCode,
  GitHubPullRequest,
  GitHubRepository,
  GitHubUserProfile,
} from '../../types/github';
import type { VukkoError } from '../../types/errors';
import { vukkoError } from '../../types/errors';

// ----------------------------------------------------------------- contracts

/** A raw HTTP response; the transport maps the platform's HTTP client to it. */
export interface RawResponse {
  status: number;
  body: string;
}

/** Injectable HTTP transport, so the service is testable without a network. */
export interface GitHubTransport {
  request(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<RawResponse>;
}

/** Where the OAuth token lives; backed by the platform's secure storage. */
export interface TokenStore {
  read(): string | null;
  write(token: string): void;
  clear(): void;
}

export interface GitHubServiceOptions {
  transport: GitHubTransport;
  tokens: TokenStore;
  /** OAuth app client id; empty means the feature is not configured. */
  clientId: string;
  clock: () => number;
}

export type DeviceFlowPoll =
  | { status: Extract<GitHubAuthStatus, 'POLLING_TOKEN'> }
  | { status: Extract<GitHubAuthStatus, 'CONNECTED'> }
  | { status: Extract<GitHubAuthStatus, 'ERROR'>; error: VukkoError };

export interface GitHubService {
  getProfile(): Promise<GitHubUserProfile>;
  listRepositories(): Promise<GitHubRepository[]>;
  listCommits(repository: string): Promise<GitHubCommit[]>;
  listBranches(repository: string): Promise<GitHubBranch[]>;
  listPullRequests(repository: string): Promise<GitHubPullRequest[]>;
  startDeviceFlow(): Promise<GitHubDeviceCode>;
  pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll>;
  disconnect(): void;
  isConnected(): boolean;
}

/** A structured GitHub failure, throwable and still carrying its code. */
export class GitHubServiceError extends Error implements VukkoError {
  readonly code: VukkoError['code'];
  readonly retryable: boolean;
  readonly details?: Record<string, string>;

  constructor(error: VukkoError) {
    super(error.message);
    this.name = 'VukkoError';
    this.code = error.code;
    this.retryable = error.retryable;
    if (error.details) this.details = error.details;
  }
}

// -------------------------------------------------------------------- config

const API = 'https://api.github.com';
const OAUTH = 'https://github.com/login';
const ACCEPT = 'application/vnd.github+json';
const AUTHENTICATION_REQUIRED = 'GitHub is not connected';

function fail(error: VukkoError): GitHubServiceError {
  return new GitHubServiceError(error);
}

/** Maps a GitHub status to the shared error contract. */
function errorFromResponse(status: number, body: string, path: string): GitHubServiceError {
  const message = parseMessage(body) || `HTTP ${status}`;
  const details = { status: String(status) };

  if (status === 401) {
    return fail(vukkoError({ code: 'AUTHENTICATION', message, details }));
  }
  if (status === 403 && /rate limit/i.test(message)) {
    return fail(
      vukkoError({
        code: 'NETWORK',
        message,
        retryable: true,
        details: { ...details, reason: 'RATE_LIMITED' },
      }),
    );
  }
  if (status === 403) {
    return fail(vukkoError({ code: 'AUTHENTICATION', message, details }));
  }
  if (status === 404) {
    return fail(vukkoError({ code: 'NOT_FOUND', message, details: { ...details, path } }));
  }
  if (status === 408 || status === 429 || status >= 500) {
    return fail(
      vukkoError({
        code: 'NETWORK',
        message,
        retryable: true,
        details: { ...details, reason: status === 429 ? 'RATE_LIMITED' : 'UPSTREAM' },
      }),
    );
  }
  return fail(vukkoError({ code: 'UNSUPPORTED', message, details }));
}

/** Extracts `message`/`error_description` from a GitHub body, if any. */
function parseMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === 'string') return parsed.message;
    if (typeof parsed?.error_description === 'string') return parsed.error_description;
    if (typeof parsed?.error === 'string') return parsed.error;
  } catch {
    // An HTML error page from a proxy: keep the first line.
    return body.split('\n')[0] ?? '';
  }
  return '';
}

/** GitHub ids arrive as 64-bit numbers; keep them exact as strings. */
function idString(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  throw vukkoError({ code: 'NETWORK', message: 'GitHub response is missing an id' });
}

/** ISO-8601 → unix milliseconds, failing on an unparseable date. */
function epochMillis(value: unknown): number {
  if (typeof value !== 'string') {
    throw vukkoError({ code: 'NETWORK', message: 'GitHub response is missing a timestamp' });
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw vukkoError({ code: 'NETWORK', message: `unparseable GitHub timestamp: ${value}` });
  }
  return parsed;
}

function pathSegment(repository: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw fail(
      vukkoError({ code: 'VALIDATION', message: `invalid repository name: ${repository}` }),
    );
  }
  return repository;
}

// ---------------------------------------------------------------- production

/**
 * Builds the production service.
 *
 * Every method either returns mapped GitHub data or throws a
 * `GitHubServiceError`. There is no path that returns fixtures.
 */
export function createGitHubService(options: GitHubServiceOptions): GitHubService {
  const { transport, tokens, clientId, clock } = options;

  async function call(
    method: string,
    path: string,
    { authenticated }: { authenticated: boolean },
    body?: unknown,
  ): Promise<unknown> {
    const token = tokens.read();
    if (authenticated && !token) {
      throw fail(
        vukkoError({
          code: 'AUTHENTICATION',
          message: AUTHENTICATION_REQUIRED,
          details: { path },
        }),
      );
    }

    const headers: Record<string, string> = {
      accept: ACCEPT,
      'user-agent': 'Vukko',
    };
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await transport.request(method, path, headers, body);
    if (response.status < 200 || response.status >= 300) {
      // A rejected token is useless afterwards: clear it so the UI offers
      // "Connect GitHub" rather than retrying a dead credential forever.
      if (response.status === 401) tokens.clear();
      throw errorFromResponse(response.status, response.body, path);
    }

    if (response.body.trim().length === 0) {
      throw fail(vukkoError({ code: 'NETWORK', message: `empty response from ${path}` }));
    }
    try {
      return JSON.parse(response.body);
    } catch {
      throw fail(
        vukkoError({
          code: 'NETWORK',
          message: `malformed response from ${path}`,
          details: { path },
        }),
      );
    }
  }

  return {
    async getProfile(): Promise<GitHubUserProfile> {
      const raw = (await call('GET', `${API}/user`, { authenticated: true })) as any;
      return {
        login: String(raw?.login ?? ''),
        name: String(raw?.name ?? ''),
        avatarUrl: String(raw?.avatar_url ?? ''),
        id: idString(raw?.id),
        publicRepos: Number(raw?.public_repos ?? 0),
      };
    },

    async listRepositories(): Promise<GitHubRepository[]> {
      const raw = (await call('GET', `${API}/user/repos?per_page=100&sort=updated`, {
        authenticated: true,
      })) as any;
      if (!Array.isArray(raw)) {
        throw fail(vukkoError({ code: 'NETWORK', message: 'expected a list of repositories' }));
      }
      return raw.map((repo: any) => ({
        id: idString(repo?.id),
        name: String(repo?.name ?? ''),
        fullName: String(repo?.full_name ?? ''),
        owner: String(repo?.owner?.login ?? ''),
        description: String(repo?.description ?? ''),
        isPrivate: Boolean(repo?.private),
        defaultBranch: String(repo?.default_branch ?? ''),
        starsCount: Number(repo?.stargazers_count ?? 0),
        forksCount: Number(repo?.forks_count ?? 0),
        openIssuesCount: Number(repo?.open_issues_count ?? 0),
        updatedAt: epochMillis(repo?.updated_at),
        cloneUrl: String(repo?.clone_url ?? ''),
        htmlUrl: String(repo?.html_url ?? ''),
      }));
    },

    async listCommits(repository: string): Promise<GitHubCommit[]> {
      const path = `${API}/repos/${pathSegment(repository)}/commits?per_page=50`;
      const raw = (await call('GET', path, { authenticated: true })) as any;
      if (!Array.isArray(raw)) {
        throw fail(vukkoError({ code: 'NETWORK', message: 'expected a list of commits' }));
      }
      return raw.map((commit: any) => ({
        sha: String(commit?.sha ?? ''),
        message: String(commit?.commit?.message ?? ''),
        authorName: String(commit?.commit?.author?.name ?? ''),
        authorEmail: String(commit?.commit?.author?.email ?? ''),
        date: epochMillis(commit?.commit?.author?.date),
        htmlUrl: String(commit?.html_url ?? ''),
      }));
    },

    async listBranches(repository: string): Promise<GitHubBranch[]> {
      const path = `${API}/repos/${pathSegment(repository)}/branches?per_page=100`;
      const raw = (await call('GET', path, { authenticated: true })) as any;
      if (!Array.isArray(raw)) {
        throw fail(vukkoError({ code: 'NETWORK', message: 'expected a list of branches' }));
      }
      return raw.map((branch: any) => ({
        name: String(branch?.name ?? ''),
        commitSha: String(branch?.commit?.sha ?? ''),
        isProtected: Boolean(branch?.protected),
      }));
    },

    async listPullRequests(repository: string): Promise<GitHubPullRequest[]> {
      const path = `${API}/repos/${pathSegment(repository)}/pulls?state=all&per_page=30`;
      const raw = (await call('GET', path, { authenticated: true })) as any;
      if (!Array.isArray(raw)) {
        throw fail(vukkoError({ code: 'NETWORK', message: 'expected a list of pull requests' }));
      }
      return raw.map((pull: any) => {
        const state = pull?.merged_at ? 'MERGED' : pull?.state === 'closed' ? 'CLOSED' : 'OPEN';
        return {
          id: idString(pull?.id),
          number: Number(pull?.number ?? 0),
          title: String(pull?.title ?? ''),
          body: String(pull?.body ?? ''),
          state,
          headBranch: String(pull?.head?.ref ?? ''),
          baseBranch: String(pull?.base?.ref ?? ''),
          author: String(pull?.user?.login ?? ''),
          htmlUrl: String(pull?.html_url ?? ''),
          createdAt: epochMillis(pull?.created_at),
        };
      });
    },

    async startDeviceFlow(): Promise<GitHubDeviceCode> {
      if (clientId.trim().length === 0) {
        throw fail(
          vukkoError({
            code: 'UNSUPPORTED',
            message: 'GitHub OAuth is not configured for this build',
          }),
        );
      }
      const raw = (await call(
        'POST',
        `${OAUTH}/device/code`,
        { authenticated: false },
        { client_id: clientId, scope: 'repo read:user' },
      )) as any;
      if (typeof raw?.device_code !== 'string' || typeof raw?.user_code !== 'string') {
        throw fail(vukkoError({ code: 'NETWORK', message: 'GitHub did not return a device code' }));
      }
      return {
        deviceCode: raw.device_code,
        userCode: raw.user_code,
        verificationUri: String(raw.verification_uri ?? 'https://github.com/login/device'),
        expiresAt: clock() + Number(raw.expires_in ?? 900) * 1000,
        intervalSeconds: Number(raw.interval ?? 5),
      };
    },

    async pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll> {
      const raw = (await call(
        'POST',
        `${OAUTH}/oauth/access_token`,
        { authenticated: false },
        {
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
      )) as any;

      if (typeof raw?.access_token === 'string' && raw.access_token.length > 0) {
        tokens.write(raw.access_token);
        return { status: 'CONNECTED' };
      }

      switch (raw?.error) {
        case 'authorization_pending':
        case 'slow_down':
          return { status: 'POLLING_TOKEN' };
        case 'expired_token':
          return {
            status: 'ERROR',
            error: vukkoError({
              code: 'AUTHENTICATION',
              message: 'The GitHub code expired; start again',
              details: { deviceCode },
            }),
          };
        case 'access_denied':
          return {
            status: 'ERROR',
            error: vukkoError({
              code: 'AUTHENTICATION',
              message: 'GitHub access was denied',
              details: { deviceCode },
            }),
          };
        default:
          return {
            status: 'ERROR',
            error: vukkoError({
              code: 'NETWORK',
              message: parseMessage(JSON.stringify(raw)) || 'GitHub returned no token',
              details: { deviceCode },
            }),
          };
      }
    },

    disconnect(): void {
      tokens.clear();
    },

    isConnected(): boolean {
      const token = tokens.read();
      return typeof token === 'string' && token.length > 0;
    },
  };
}

// ---------------------------------------------------------------------- demo

/**
 * Fixtures for tests and demo builds.
 *
 * Every record is labelled as demo data so it can never be mistaken for a real
 * account, and this factory is never referenced from the production path.
 */
export function createDemoGitHubService(): GitHubService {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const repositories: GitHubRepository[] = [
    {
      id: '1001',
      name: 'vukko-demo',
      fullName: 'demo-user/vukko-demo',
      owner: 'demo-user',
      description: 'Demo data — local-first knowledge base',
      isPrivate: false,
      defaultBranch: 'main',
      starsCount: 42,
      forksCount: 3,
      openIssuesCount: 1,
      updatedAt: now,
      cloneUrl: 'https://github.com/demo-user/vukko-demo.git',
      htmlUrl: 'https://github.com/demo-user/vukko-demo',
    },
    {
      id: '1002',
      name: 'rag-experiments',
      fullName: 'demo-user/rag-experiments',
      owner: 'demo-user',
      description: 'Demo data — retrieval experiments',
      isPrivate: true,
      defaultBranch: 'main',
      starsCount: 7,
      forksCount: 0,
      openIssuesCount: 0,
      updatedAt: now,
      cloneUrl: 'https://github.com/demo-user/rag-experiments.git',
      htmlUrl: 'https://github.com/demo-user/rag-experiments',
    },
  ];

  return {
    async getProfile(): Promise<GitHubUserProfile> {
      return {
        login: 'demo-user',
        name: 'Demo user',
        avatarUrl: '',
        id: '1000',
        publicRepos: repositories.length,
      };
    },
    async listRepositories(): Promise<GitHubRepository[]> {
      return repositories.map((repo) => ({ ...repo }));
    },
    async listCommits(): Promise<GitHubCommit[]> {
      return [
        {
          sha: 'demo0001',
          message: 'Demo data — initial commit',
          authorName: 'Demo user',
          authorEmail: 'demo@example.com',
          date: now,
          htmlUrl: 'https://github.com/demo-user/vukko-demo/commit/demo0001',
        },
      ];
    },
    async listBranches(): Promise<GitHubBranch[]> {
      return [{ name: 'main', commitSha: 'demo0001', isProtected: true }];
    },
    async listPullRequests(): Promise<GitHubPullRequest[]> {
      return [
        {
          id: '2001',
          number: 1,
          title: 'Demo data — example pull request',
          body: 'Demo data.',
          state: 'OPEN',
          headBranch: 'feature/demo',
          baseBranch: 'main',
          author: 'demo-user',
          htmlUrl: 'https://github.com/demo-user/vukko-demo/pull/1',
          createdAt: now,
        },
      ];
    },
    async startDeviceFlow(): Promise<GitHubDeviceCode> {
      return {
        deviceCode: 'demo-device',
        userCode: 'DEMO-0000',
        verificationUri: 'https://github.com/login/device',
        expiresAt: now + 900_000,
        intervalSeconds: 5,
      };
    },
    async pollDeviceFlow(): Promise<DeviceFlowPoll> {
      return { status: 'CONNECTED' };
    },
    disconnect(): void {
      // The demo service holds no credential, so there is nothing to clear.
    },
    isConnected(): boolean {
      return true;
    },
  };
}
