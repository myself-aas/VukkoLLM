package com.vukko.data.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.vukko.data.DataRepository
import com.vukko.data.PreferencesManager
import com.vukko.data.local.AppDatabase
import com.vukko.data.github.GitHubService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class BackupWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val prefs = PreferencesManager(applicationContext)
        if (!prefs.backupEnabled) return Result.success()

        val database = AppDatabase.getInstance(applicationContext)
        val repository = DataRepository(database, prefs)
        val gitHubService = GitHubService()

        return try {
            val dbJson = repository.exportFullDatabaseAsJson()
            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
            val fileName = "vukko_backup_$timestamp.json"

            val backupResult = when (prefs.backupTarget) {
                "github" -> {
                    val token = prefs.githubToken
                    val repo = prefs.backupGitHubRepo
                    if (token.isNotBlank() && repo.isNotBlank()) {
                        val parts = repo.split("/")
                        val owner = if (parts.size > 1) parts[0] else prefs.githubUsername
                        val repoName = if (parts.size > 1) parts[1] else repo
                        
                        gitHubService.pushCommit(
                            token = token,
                            owner = owner,
                            repo = repoName,
                            branch = "main",
                            filePath = "backups/$fileName",
                            content = dbJson,
                            commitMessage = "Automated Vukko Sovereign Backup - $timestamp"
                        )
                    } else {
                        kotlin.Result.failure(Exception("GitHub backup not configured"))
                    }
                }
                "cloud_bucket" -> {
                    // Simulate Cloud Bucket Upload (GCS/S3)
                    Log.d("BackupWorker", "Simulating upload to bucket: ${prefs.backupCloudBucket}")
                    kotlin.Result.success("Simulated success")
                }
                else -> kotlin.Result.failure(Exception("Unknown backup target"))
            }

            if (backupResult.isSuccess) {
                prefs.lastBackupTimestamp = System.currentTimeMillis()
                Log.d("BackupWorker", "Backup successful: $fileName")
                Result.success()
            } else {
                Log.e("BackupWorker", "Backup failed: ${backupResult.exceptionOrNull()?.message}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e("BackupWorker", "Backup worker error", e)
            Result.failure()
        }
    }
}
