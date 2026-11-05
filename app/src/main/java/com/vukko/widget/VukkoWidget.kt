package com.vukko.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.vukko.MainActivity
import com.vukko.data.local.AppDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class VukkoWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val database = AppDatabase.getInstance(context)
        val lastMsg = withContext(Dispatchers.IO) {
            try {
                database.chatMessageDao().getGlobalLastMessage()
            } catch (e: Exception) {
                null
            }
        }

        provideContent {
            GlanceTheme {
                Column(
                    modifier = GlanceModifier
                        .fillMaxSize()
                        .background(androidx.compose.ui.graphics.Color(0xFF0B0E14))
                        .padding(16.dp)
                        .clickable(actionStartActivity<MainActivity>()),
                    verticalAlignment = Alignment.Vertical.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.Vertical.CenterVertically) {
                        Text(
                            text = "Vukko AI",
                            style = TextStyle(
                                color = androidx.glance.unit.ColorProvider(androidx.compose.ui.graphics.Color(0xFF0052FF)),
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                        )
                        Spacer(modifier = GlanceModifier.width(6.dp))
                        Text(
                            text = "• Sovereign Chat",
                            style = TextStyle(
                                color = androidx.glance.unit.ColorProvider(androidx.compose.ui.graphics.Color(0xFF94A3B8)),
                                fontSize = 12.sp
                            )
                        )
                    }

                    Spacer(modifier = GlanceModifier.height(8.dp))

                    Text(
                        text = lastMsg?.content ?: "No messages yet. Tap to open Vukko AI workspace!",
                        style = TextStyle(
                            color = androidx.glance.unit.ColorProvider(androidx.compose.ui.graphics.Color(0xFFF8FAFC)),
                            fontSize = 13.sp
                        ),
                        maxLines = 2
                    )
                }
            }
        }
    }
}

class VukkoWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = VukkoWidget()
}
