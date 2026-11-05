package com.vukko.model

data class SovereignStorageStats(
    val databaseName: String = "vukko_sovereign.db",
    val totalWorkspaces: Int = 0,
    val totalThreads: Int = 0,
    val totalMessages: Int = 0,
    val totalDocuments: Int = 0,
    val isLocalEncrypted: Boolean = true,
    val storageType: String = "Room SQLite (Local Device Only)",
    val dataSovereigntyStatus: String = "Air-Gapped Sovereign Storage"
)
