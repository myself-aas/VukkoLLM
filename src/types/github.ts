/**
 * GitHub contract. Mirrors model/GitHubModels.kt.
 *
 * Numeric GitHub identifiers are carried as strings: they are 64-bit in the API
 * and would lose precision as JS numbers.
 */

/** Wire values are the Kotlin enum names. */
export type PRState = 'OPEN' | 'CLOSED' | 'MERGED';

export interface GitHubRepository {
  /** GitHub's numeric id as a decimal string. */
  id: string;
  name: string;
  fullName: string;
  owner: string;
  description: string;
  isPrivate: boolean;
  defaultBranch: string;
  starsCount: number;
  forksCount: number;
  openIssuesCount: number;
  /** Unix milliseconds. */
  updatedAt: number;
  cloneUrl: string;
  htmlUrl: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  /** Unix milliseconds. */
  date: number;
  htmlUrl: string;
}

export interface GitHubBranch {
  name: string;
  commitSha: string;
  isProtected: boolean;
}

export interface GitHubPullRequest {
  /** GitHub's numeric id as a decimal string. */
  id: string;
  number: number;
  title: string;
  body: string;
  state: PRState;
  headBranch: string;
  baseBranch: string;
  author: string;
  htmlUrl: string;
  /** Unix milliseconds. */
  createdAt: number;
}

export interface GitHubUserProfile {
  login: string;
  name: string;
  avatarUrl: string;
  /** GitHub's numeric id as a decimal string. */
  id: string;
  publicRepos: number;
}

/** The device-flow states the UI can render. */
export type GitHubAuthStatus =
  | 'UNLINKED'
  | 'REQUESTING_CODE'
  | 'CODE_RECEIVED'
  | 'POLLING_TOKEN'
  | 'CONNECTED'
  | 'ERROR';

export interface GitHubDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Unix milliseconds. */
  expiresAt: number;
  intervalSeconds: number;
}
