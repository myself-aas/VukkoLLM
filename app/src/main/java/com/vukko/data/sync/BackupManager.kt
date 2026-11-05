package com.vukko.data.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.vukko.data.PreferencesManager
import java.util.concurrent.TimeUnit

class BackupManager(private val context: Context) {

    private val workManager = WorkManager.getInstance(context)
    private val prefs = PreferencesManager(context)

    fun scheduleBackup() {
        if (!prefs.backupEnabled) {
            cancelBackup()
            return
        }

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build()

        val backupRequest = PeriodicWorkRequestBuilder<BackupWorker>(
            prefs.backupFrequencyHours.toLong(), TimeUnit.HOURS
        )
            .setConstraints(constraints)
            .build()

        workManager.enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            backupRequest
        )
    }

    fun cancelBackup() {
        workManager.cancelUniqueWork(WORK_NAME)
    }

    companion object {
        private const val WORK_NAME = "vukko_sovereign_backup"
    }
}
