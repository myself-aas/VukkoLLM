package com.vukko

import com.vukko.model.GitHubPullRequest
import com.vukko.model.GitHubRepository
import com.vukko.model.PRState
import org.junit.Assert.*
import org.junit.Test

class GitHubOperationsTest {

    @Test
    fun testGitHubRepositoryModel() {
        val repo = GitHubRepository(
            id = 12345L,
            name = "vukko-mobile",
            fullName = "myself-aas/vukko-mobile",
            owner = "myself-aas",
            description = "Native Android AI workspace application",
            isPrivate = false,
            defaultBranch = "main",
            starsCount = 1250,
            forksCount = 140
        )

        assertEquals("vukko-mobile", repo.name)
        assertEquals("myself-aas/vukko-mobile", repo.fullName)
        assertFalse(repo.isPrivate)
        assertEquals("main", repo.defaultBranch)
        assertEquals(1250, repo.starsCount)
    }

    @Test
    fun testGitHubPullRequestModel() {
        val pr = GitHubPullRequest(
            id = 999L,
            number = 42,
            title = "feat(room): Add local database schema",
            body = "Implements offline chat history persistence",
            state = PRState.OPEN,
            headBranch = "feature/room-db",
            baseBranch = "main",
            author = "shuvo1807016"
        )

        assertEquals(42, pr.number)
        assertEquals(PRState.OPEN, pr.state)
        assertEquals("feature/room-db", pr.headBranch)
        assertEquals("main", pr.baseBranch)
    }

    @Test
    fun testGitHubDeviceCodeResponseModel() {
        val deviceCode = com.vukko.model.GitHubDeviceCodeResponse(
            deviceCode = "dev_code_12345",
            userCode = "WDJB-MJHT",
            verificationUri = "https://github.com/login/device",
            expiresIn = 900,
            interval = 5
        )

        assertEquals("dev_code_12345", deviceCode.deviceCode)
        assertEquals("WDJB-MJHT", deviceCode.userCode)
        assertEquals("https://github.com/login/device", deviceCode.verificationUri)
        assertEquals(900, deviceCode.expiresIn)
    }

    @Test
    fun testGitHubOAuthStateTransitions() {
        val unlinkedState: com.vukko.model.GitHubOAuthState = com.vukko.model.GitHubOAuthState.Unlinked
        val userProfile = com.vukko.model.GitHubUserProfile(login = "octocat_dev", avatarUrl = "https://github.com/avatar.png")
        val connectedState: com.vukko.model.GitHubOAuthState = com.vukko.model.GitHubOAuthState.Connected(userProfile)

        assertTrue(unlinkedState is com.vukko.model.GitHubOAuthState.Unlinked)
        assertTrue(connectedState is com.vukko.model.GitHubOAuthState.Connected)
        assertEquals("octocat_dev", (connectedState as com.vukko.model.GitHubOAuthState.Connected).userProfile.login)
    }

    @Test
    fun testGitHubOAuthManagerSimulatedProfile() {
        val oauthManager = com.vukko.data.github.GitHubOAuthManager()
        val (token, profile) = oauthManager.generateSimulatedConnectedProfile("shuvo1807016")

        assertTrue(token.startsWith("gho_oauth2_sovereign_"))
        assertEquals("shuvo1807016", profile.login)
        assertEquals("Sovereign AI Developer", profile.name)
    }

    @Test
    fun testGitHubSshKeyVerification() = kotlinx.coroutines.runBlocking {
        val service = com.vukko.data.github.GitHubService()
        val validKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcnNh..."
        val invalidKey = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQ..."

        val validResult = service.verifySshKey(validKey)
        assertTrue(validResult.isSuccess)

        val invalidResult = service.verifySshKey(invalidKey)
        assertTrue(invalidResult.isFailure)
    }
}
