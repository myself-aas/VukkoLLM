/**
 * Phase 5, Step 5.3: no simulated identities, no seeded repositories, no
 * generated tokens and no swallowed exceptions.
 *
 * The Kotlin client returned placeholder data when a call failed, which made a
 * signed-out user look like a different person with someone else's
 * repositories. Every test here asserts the opposite: a failure is a failure,
 * and demo data is only visible when the build explicitly asks for it.
 */

import {
  createGitHubService,
  createDemoGitHubService,
  GitHubServiceError,
  type GitHubTransport,
  type TokenStore,
  type RawResponse,
} from '../../src/services/github';

class RecordingTransport implements GitHubTransport {
  readonly calls: Array<{
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
  }> = [];

  constructor(private readonly handler: (path: string) => RawResponse) {}

  async request(method: string, path: string, headers: Record<string, string>, body?: unknown) {
    this.calls.push({ method, path, headers, body });
    return this.handler(path);
  }
}

class MemoryTokenStore implements TokenStore {
  constructor(private token: string | null = null) {}
  read() {
    return this.token;
  }
  write(token: string) {
    this.token = token;
  }
  clear() {
    this.token = null;
  }
}

const json = (status: number, body: unknown): RawResponse => ({
  status,
  body: JSON.stringify(body),
});

const PROFILE = {
  login: 'octocat',
  name: 'The Octocat',
  avatar_url: 'https://avatars.githubusercontent.com/u/1',
  id: 583231,
  public_repos: 8,
};

const REPO = {
  id: 1296269,
  name: 'Hello-World',
  full_name: 'octocat/Hello-World',
  owner: { login: 'octocat' },
  description: 'My first repository',
  private: false,
  default_branch: 'main',
  stargazers_count: 2000,
  forks_count: 1800,
  open_issues_count: 300,
  updated_at: '2026-01-02T03:04:05Z',
  clone_url: 'https://github.com/octocat/Hello-World.git',
  html_url: 'https://github.com/octocat/Hello-World',
};

describe('GitHub service — an unlinked account fails loudly', () => {
  test('reading the profile without a token is AUTHENTICATION, not a demo user', async () => {
    const transport = new RecordingTransport(() => json(200, PROFILE));
    const service = createGitHubService({
      transport,
      tokens: new MemoryTokenStore(null),
      clientId: 'client',
      clock: () => 1_700_000_000_000,
    });

    await expect(service.getProfile()).rejects.toMatchObject({ code: 'AUTHENTICATION' });
    expect(transport.calls).toHaveLength(0);
  });

  test('no request is made and no placeholder is returned for repositories', async () => {
    const transport = new RecordingTransport(() => json(200, [REPO]));
    const service = createGitHubService({
      transport,
      tokens: new MemoryTokenStore(null),
      clientId: 'client',
      clock: () => 1_700_000_000_000,
    });

    await expect(service.listRepositories()).rejects.toBeInstanceOf(GitHubServiceError);
    await expect(service.listRepositories()).rejects.toMatchObject({ code: 'AUTHENTICATION' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('GitHub service — responses are mapped, never guessed', () => {
  const linked = (handler: (path: string) => RawResponse) => {
    const transport = new RecordingTransport(handler);
    const tokens = new MemoryTokenStore('gho_realtoken');
    const service = createGitHubService({
      transport,
      tokens,
      clientId: 'client',
      clock: () => 1_700_000_000_000,
    });
    return { transport, tokens, service };
  };

  test('a profile is mapped with ids kept as strings', async () => {
    const { service, transport } = linked(() => json(200, PROFILE));
    const profile = await service.getProfile();

    expect(profile).toEqual({
      login: 'octocat',
      name: 'The Octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      id: '583231',
      publicRepos: 8,
    });
    expect(transport.calls[0]?.headers.authorization).toBe('Bearer gho_realtoken');
  });

  test('repositories are mapped with ISO timestamps in milliseconds', async () => {
    const { service } = linked(() => json(200, [REPO]));
    const repos = await service.listRepositories();

    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      id: '1296269',
      fullName: 'octocat/Hello-World',
      owner: 'octocat',
      isPrivate: false,
      starsCount: 2000,
      updatedAt: Date.parse('2026-01-02T03:04:05Z'),
    });
  });

  test('a 401 becomes AUTHENTICATION and the token is cleared', async () => {
    const { service, tokens } = linked(() => json(401, { message: 'Bad credentials' }));

    await expect(service.getProfile()).rejects.toMatchObject({
      code: 'AUTHENTICATION',
      retryable: false,
    });
    expect(tokens.read()).toBeNull();
  });

  test('a 404 becomes NOT_FOUND, not an empty list', async () => {
    const { service } = linked(() => json(404, { message: 'Not Found' }));
    await expect(service.listCommits('octocat/Hello-World')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('a rate-limited 403 is retryable and says so', async () => {
    const { service } = linked(() =>
      json(403, { message: 'API rate limit exceeded for user ID 1.' }),
    );
    const error = await service.listRepositories().catch((thrown) => thrown);

    expect(error).toMatchObject({ code: 'NETWORK', retryable: true });
    expect(String(error.details?.reason)).toBe('RATE_LIMITED');
  });

  test('a 5xx is retryable NETWORK', async () => {
    const { service } = linked(() => json(503, { message: 'Service Unavailable' }));
    await expect(service.listRepositories()).rejects.toMatchObject({
      code: 'NETWORK',
      retryable: true,
    });
  });

  test('a malformed body is a NETWORK error rather than an empty list', async () => {
    const { service } = linked(() => ({ status: 200, body: '<html>oops</html>' }));
    await expect(service.listRepositories()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  test('commits and branches are mapped from their wire shapes', async () => {
    const { service } = linked((path) =>
      path.includes('/commits')
        ? json(200, [
            {
              sha: 'abc123',
              commit: {
                message: 'Initial commit',
                author: { name: 'Octo', email: 'octo@example.com', date: '2026-01-02T03:04:05Z' },
              },
              html_url: 'https://github.com/octocat/Hello-World/commit/abc123',
            },
          ])
        : json(200, [{ name: 'main', commit: { sha: 'abc123' }, protected: true }]),
    );

    const commits = await service.listCommits('octocat/Hello-World');
    expect(commits[0]).toMatchObject({ sha: 'abc123', authorEmail: 'octo@example.com' });
    expect(commits[0]?.date).toBe(Date.parse('2026-01-02T03:04:05Z'));

    const branches = await service.listBranches('octocat/Hello-World');
    expect(branches[0]).toMatchObject({ name: 'main', commitSha: 'abc123', isProtected: true });
  });
});

describe('GitHub service — the device flow never invents a token', () => {
  test('a successful poll stores only the token GitHub returned', async () => {
    const transport = new RecordingTransport((path) =>
      path.includes('device/code')
        ? json(200, {
            device_code: 'dev-123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 5,
          })
        : json(200, { access_token: 'gho_fromgithub', token_type: 'bearer', scope: 'repo' }),
    );
    const tokens = new MemoryTokenStore(null);
    const service = createGitHubService({
      transport,
      tokens,
      clientId: 'client',
      clock: () => 1_700_000_000_000,
    });

    const code = await service.startDeviceFlow();
    expect(code).toMatchObject({
      deviceCode: 'dev-123',
      userCode: 'ABCD-1234',
      intervalSeconds: 5,
    });
    expect(code.expiresAt).toBe(1_700_000_000_000 + 900_000);
    expect(transport.calls[0]?.body).toMatchObject({ client_id: 'client' });

    const polled = await service.pollDeviceFlow(code.deviceCode);
    expect(polled).toEqual({ status: 'CONNECTED' });
    expect(tokens.read()).toBe('gho_fromgithub');
    expect(transport.calls[1]?.body).toMatchObject({
      client_id: 'client',
      device_code: 'dev-123',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  });

  test('authorization_pending keeps polling instead of failing', async () => {
    const transport = new RecordingTransport(() =>
      json(200, { error: 'authorization_pending', error_description: 'pending' }),
    );
    const service = createGitHubService({
      transport,
      tokens: new MemoryTokenStore(null),
      clientId: 'client',
      clock: () => 0,
    });

    await expect(service.pollDeviceFlow('dev-123')).resolves.toEqual({
      status: 'POLLING_TOKEN',
    });
  });

  test('expired_token ends in ERROR and stores nothing', async () => {
    const transport = new RecordingTransport(() =>
      json(200, { error: 'expired_token', error_description: 'expired' }),
    );
    const tokens = new MemoryTokenStore(null);
    const service = createGitHubService({
      transport,
      tokens,
      clientId: 'client',
      clock: () => 0,
    });

    await expect(service.pollDeviceFlow('dev-1')).resolves.toMatchObject({ status: 'ERROR' });
    expect(tokens.read()).toBeNull();
  });

  test('a missing client id is an explicit UNSUPPORTED error', async () => {
    const service = createGitHubService({
      transport: new RecordingTransport(() => json(200, {})),
      tokens: new MemoryTokenStore(null),
      clientId: '',
      clock: () => 0,
    });

    await expect(service.startDeviceFlow()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});

describe('GitHub service — demo data is opt-in and labelled', () => {
  test('the demo service answers without a token but marks every record as demo', async () => {
    const service = createDemoGitHubService();

    const profile = await service.getProfile();
    expect(profile.login).toBe('demo-user');
    const repos = await service.listRepositories();
    expect(repos.length).toBeGreaterThan(0);
    for (const repo of repos) {
      expect(repo.description).toContain('Demo data');
      expect(repo.owner).toBe('demo-user');
    }
  });

  test('production mode never exposes the demo fixtures', async () => {
    const service = createGitHubService({
      transport: new RecordingTransport(() => json(401, { message: 'Bad credentials' })),
      tokens: new MemoryTokenStore('gho_stale'),
      clientId: 'client',
      clock: () => 0,
    });

    await expect(service.listRepositories()).rejects.toMatchObject({ code: 'AUTHENTICATION' });
  });
});
