package com.vukko.model

import kotlinx.serialization.Serializable

@Serializable
data class GitHubRepository(
    val id: Long,
    val name: String,
    val fullName: String,
    val owner: String,
    val description: String = "",
    val isPrivate: Boolean = false,
    val defaultBranch: String = "main",
    val starsCount: Int = 0,
    val forksCount: Int = 0,
    val openIssuesCount: Int = 0,
    val updatedAt: Long = System.currentTimeMillis(),
    val cloneUrl: String = "",
    val htmlUrl: String = ""
)

@Serializable
data class GitHubCommit(
    val sha: String,
    val message: String,
    val authorName: String,
    val authorEmail: String = "",
    val date: Long = System.currentTimeMillis(),
    val htmlUrl: String = ""
)

@Serializable
data class GitHubBranch(
    val name: String,
    val commitSha: String,
    val isProtected: Boolean = false
)

@Serializable
enum class PRState {
    OPEN,
    CLOSED,
    MERGED
}

@Serializable
data class GitHubPullRequest(
    val id: Long,
    val number: Int,
    val title: String,
    val body: String = "",
    val state: PRState = PRState.OPEN,
    val headBranch: String,
    val baseBranch: String = "main",
    val author: String,
    val htmlUrl: String = "",
    val createdAt: Long = System.currentTimeMillis()
)

@Serializable
data class GitHubIssue(
    val id: Long,
    val number: Int,
    val title: String,
    val body: String = "",
    val state: String = "open",
    val author: String,
    val createdAt: Long = System.currentTimeMillis()
)

@Serializable
data class GitHubDeviceCodeResponse(
    val deviceCode: String,
    val userCode: String,
    val verificationUri: String = "https://github.com/login/device",
    val expiresIn: Int = 900,
    val interval: Int = 5
)

@Serializable
data class GitHubOAuthTokenResponse(
    val accessToken: String = "",
    val tokenType: String = "bearer",
    val scope: String = "repo,user,workflow",
    val error: String? = null,
    val errorDescription: String? = null
)

@Serializable
data class GitHubUserProfile(
    val login: String,
    val name: String = "",
    val avatarUrl: String = "",
    val htmlUrl: String = "",
    val email: String = "",
    val publicRepos: Int = 0,
    val followers: Int = 0,
    val bio: String = ""
)

sealed class GitHubOAuthState {
    object Unlinked : GitHubOAuthState()
    object RequestingCode : GitHubOAuthState()
    data class CodeReceived(val deviceCodeResponse: GitHubDeviceCodeResponse) : GitHubOAuthState()
    object PollingToken : GitHubOAuthState()
    data class Connected(val userProfile: GitHubUserProfile) : GitHubOAuthState()
    data class Error(val message: String) : GitHubOAuthState()
}
