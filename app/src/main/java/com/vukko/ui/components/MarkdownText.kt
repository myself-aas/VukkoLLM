package com.vukko.ui.components

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vukko.theme.*

/**
 * Native Jetpack Compose Markdown (MD/MDX) renderer for LLM responses.
 * Formats headings, lists, blockquotes, tables, code blocks with 1-tap copy, and inline styles.
 */
@Composable
fun MarkdownText(
    markdown: String,
    modifier: Modifier = Modifier,
    textColor: Color = TextPrimary,
    fontSize: androidx.compose.ui.unit.TextUnit = 14.sp
) {
    val blocks = parseMarkdownBlocks(markdown)

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> {
                    val (fontSize, fontWeight, color, topPadding) = when (block.level) {
                        1 -> Quadruple(22.sp, FontWeight.Bold, textColor, 8.dp)
                        2 -> Quadruple(18.sp, FontWeight.Bold, textColor, 6.dp)
                        3 -> Quadruple(15.sp, FontWeight.SemiBold, CyanAccent, 4.dp)
                        else -> Quadruple(14.sp, FontWeight.SemiBold, TealAccent, 2.dp)
                    }
                    Text(
                        text = buildInlineMarkdown(block.text, color),
                        fontSize = fontSize,
                        fontWeight = fontWeight,
                        color = color,
                        lineHeight = (fontSize.value + 6).sp,
                        modifier = Modifier.padding(top = topPadding)
                    )
                }

                is MarkdownBlock.CodeBlock -> {
                    CodeBlockCard(
                        language = block.language,
                        code = block.code
                    )
                }

                is MarkdownBlock.Blockquote -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp))
                            .background(SurfaceCard.copy(alpha = 0.5f))
                            .padding(vertical = 4.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .height(IntrinsicSize.Min)
                                .clip(RoundedCornerShape(2.dp))
                                .background(CyanAccent)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = buildInlineMarkdown(block.text, TextSecondary),
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontStyle = FontStyle.Italic,
                                color = TextSecondary,
                                lineHeight = 20.sp
                            ),
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                is MarkdownBlock.BulletItem -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = (block.indent * 12).dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Box(
                            modifier = Modifier
                                .padding(top = 8.dp)
                                .size(5.dp)
                                .clip(CircleShape)
                                .background(CyanAccent)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = buildInlineMarkdown(block.text, textColor),
                            style = MaterialTheme.typography.bodyMedium.copy(fontSize = fontSize),
                            color = textColor,
                            lineHeight = (fontSize.value + 8).sp,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                is MarkdownBlock.NumberedItem -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = (block.indent * 12).dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Text(
                            text = "${block.number}.",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = CyanAccent,
                            modifier = Modifier.width(22.dp)
                        )
                        Text(
                            text = buildInlineMarkdown(block.text, textColor),
                            style = MaterialTheme.typography.bodyMedium.copy(fontSize = fontSize),
                            color = textColor,
                            lineHeight = (fontSize.value + 8).sp,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                is MarkdownBlock.TaskItem -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = if (block.isChecked) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank,
                            contentDescription = if (block.isChecked) "Completed" else "Incomplete",
                            tint = if (block.isChecked) GreenSuccess else TextMuted,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = buildInlineMarkdown(block.text, textColor),
                            style = MaterialTheme.typography.bodyMedium.copy(
                                textDecoration = if (block.isChecked) TextDecoration.LineThrough else TextDecoration.None,
                                fontSize = fontSize
                            ),
                            color = if (block.isChecked) TextMuted else textColor,
                            lineHeight = (fontSize.value + 8).sp
                        )
                    }
                }

                is MarkdownBlock.Table -> {
                    TableCard(headers = block.headers, rows = block.rows)
                }

                is MarkdownBlock.Divider -> {
                    HorizontalDivider(
                        color = BorderSubtle,
                        thickness = 1.dp,
                        modifier = Modifier.padding(vertical = 6.dp)
                    )
                }

                is MarkdownBlock.Paragraph -> {
                    Text(
                        text = buildInlineMarkdown(block.text, textColor),
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = fontSize),
                        color = textColor,
                        lineHeight = (fontSize.value + 8).sp
                    )
                }
            }
        }
    }
}

@Composable
private fun CodeBlockCard(language: String, code: String) {
    val clipboardManager = LocalClipboardManager.current
    val context = LocalContext.current
    val displayLang = language.ifBlank { "code" }.uppercase()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(CodeBlockBackground)
            .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(SurfaceCard)
                .padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = displayLang,
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary,
                fontWeight = FontWeight.Bold,
                fontSize = 11.sp
            )
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .clickable {
                        clipboardManager.setText(AnnotatedString(code.trim()))
                        Toast.makeText(context, "Code copied to clipboard", Toast.LENGTH_SHORT).show()
                    }
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Outlined.ContentCopy,
                    contentDescription = "Copy code",
                    tint = CyanAccent,
                    modifier = Modifier.size(12.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "Copy",
                    style = MaterialTheme.typography.labelSmall,
                    color = CyanAccent,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        // Code Content
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(12.dp)
        ) {
            Text(
                text = code.trim(),
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                color = TextPrimary,
                fontSize = 12.sp,
                lineHeight = 18.sp
            )
        }
    }
}

@Composable
private fun TableCard(headers: List<String>, rows: List<List<String>>) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(SurfaceCard)
            .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
            .horizontalScroll(rememberScrollState())
    ) {
        // Table Header
        Row(
            modifier = Modifier
                .background(SurfaceVariantDark)
                .padding(vertical = 8.dp, horizontal = 12.dp)
        ) {
            headers.forEach { header ->
                Text(
                    text = buildInlineMarkdown(header.trim(), TextPrimary),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = CyanAccent,
                    modifier = Modifier
                        .widthIn(min = 100.dp, max = 220.dp)
                        .padding(end = 12.dp)
                )
            }
        }

        HorizontalDivider(color = BorderSubtle, thickness = 1.dp)

        // Rows
        rows.forEachIndexed { index, rowCells ->
            Row(
                modifier = Modifier
                    .background(if (index % 2 == 0) SurfaceCard else SurfaceDark)
                    .padding(vertical = 8.dp, horizontal = 12.dp)
            ) {
                rowCells.forEach { cell ->
                    Text(
                        text = buildInlineMarkdown(cell.trim(), TextPrimary),
                        style = MaterialTheme.typography.bodySmall,
                        color = TextPrimary,
                        modifier = Modifier
                            .widthIn(min = 100.dp, max = 220.dp)
                            .padding(end = 12.dp)
                    )
                }
            }
            if (index < rows.size - 1) {
                HorizontalDivider(color = BorderSubtle.copy(alpha = 0.5f), thickness = 0.5.dp)
            }
        }
    }
}

/**
 * Builds an AnnotatedString from markdown text handling:
 * - **bold**
 * - *italic* / _italic_
 * - `inline code`
 * - ~~strikethrough~~
 * - [link](url)
 */
fun buildInlineMarkdown(raw: String, defaultColor: Color): AnnotatedString {
    return buildAnnotatedString {
        var cursor = 0
        val length = raw.length

        while (cursor < length) {
            when {
                // Bold: **text**
                raw.startsWith("**", cursor) -> {
                    val end = raw.indexOf("**", cursor + 2)
                    if (end != -1) {
                        pushStyle(SpanStyle(fontWeight = FontWeight.Bold, color = defaultColor))
                        append(raw.substring(cursor + 2, end))
                        pop()
                        cursor = end + 2
                    } else {
                        append(raw[cursor])
                        cursor++
                    }
                }

                // Inline code: `code`
                raw.startsWith("`", cursor) -> {
                    val end = raw.indexOf("`", cursor + 1)
                    if (end != -1) {
                        pushStyle(
                            SpanStyle(
                                fontFamily = FontFamily.Monospace,
                                background = SurfaceVariantDark,
                                color = CyanAccent,
                                fontSize = 12.sp
                            )
                        )
                        append(" ${raw.substring(cursor + 1, end)} ")
                        pop()
                        cursor = end + 1
                    } else {
                        append(raw[cursor])
                        cursor++
                    }
                }

                // Strikethrough: ~~text~~
                raw.startsWith("~~", cursor) -> {
                    val end = raw.indexOf("~~", cursor + 2)
                    if (end != -1) {
                        pushStyle(SpanStyle(textDecoration = TextDecoration.LineThrough, color = TextMuted))
                        append(raw.substring(cursor + 2, end))
                        pop()
                        cursor = end + 2
                    } else {
                        append(raw[cursor])
                        cursor++
                    }
                }

                // Italic: *text* (single asterisk)
                raw.startsWith("*", cursor) && !raw.startsWith("**", cursor) -> {
                    val end = raw.indexOf("*", cursor + 1)
                    if (end != -1 && !raw.startsWith("**", end)) {
                        pushStyle(SpanStyle(fontStyle = FontStyle.Italic, color = defaultColor))
                        append(raw.substring(cursor + 1, end))
                        pop()
                        cursor = end + 1
                    } else {
                        append(raw[cursor])
                        cursor++
                    }
                }

                // Links: [text](url)
                raw.startsWith("[", cursor) -> {
                    val textEnd = raw.indexOf("]", cursor + 1)
                    if (textEnd != -1 && textEnd + 1 < length && raw[textEnd + 1] == '(') {
                        val urlEnd = raw.indexOf(")", textEnd + 2)
                        if (urlEnd != -1) {
                            val linkText = raw.substring(cursor + 1, textEnd)
                            val url = raw.substring(textEnd + 2, urlEnd)
                            pushStyle(
                                SpanStyle(
                                    color = CyanAccent,
                                    textDecoration = TextDecoration.Underline,
                                    fontWeight = FontWeight.Medium
                                )
                            )
                            append(linkText)
                            pop()
                            cursor = urlEnd + 1
                        } else {
                            append(raw[cursor])
                            cursor++
                        }
                    } else {
                        append(raw[cursor])
                        cursor++
                    }
                }

                else -> {
                    append(raw[cursor])
                    cursor++
                }
            }
        }
    }
}

// Sealed hierarchy for Markdown Blocks
sealed class MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock()
    data class CodeBlock(val language: String, val code: String) : MarkdownBlock()
    data class Blockquote(val text: String) : MarkdownBlock()
    data class BulletItem(val indent: Int, val text: String) : MarkdownBlock()
    data class NumberedItem(val indent: Int, val number: String, val text: String) : MarkdownBlock()
    data class TaskItem(val isChecked: Boolean, val text: String) : MarkdownBlock()
    data class Table(val headers: List<String>, val rows: List<List<String>>) : MarkdownBlock()
    object Divider : MarkdownBlock()
    data class Paragraph(val text: String) : MarkdownBlock()
}

/**
 * Parses raw markdown into structured blocks.
 */
fun parseMarkdownBlocks(markdown: String): List<MarkdownBlock> {
    val blocks = mutableListOf<MarkdownBlock>()
    val lines = markdown.lines()
    var i = 0

    while (i < lines.size) {
        val line = lines[i]

        when {
            // Code block start
            line.trimStart().startsWith("```") -> {
                val language = line.trimStart().removePrefix("```").trim()
                val codeLines = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) {
                    codeLines.add(lines[i])
                    i++
                }
                blocks.add(MarkdownBlock.CodeBlock(language, codeLines.joinToString("\n")))
                i++ // skip closing ```
            }

            // Headings: # H1, ## H2, ### H3, #### H4
            line.startsWith("#") -> {
                val level = line.takeWhile { it == '#' }.length.coerceAtMost(6)
                val text = line.removePrefix("#".repeat(level)).trim()
                blocks.add(MarkdownBlock.Heading(level, text))
                i++
            }

            // Horizontal rules: --- or ***
            line.trim() in listOf("---", "***", "___") -> {
                blocks.add(MarkdownBlock.Divider)
                i++
            }

            // Blockquote: > text
            line.trimStart().startsWith(">") -> {
                val quoteLines = mutableListOf<String>()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                    quoteLines.add(lines[i].trimStart().removePrefix(">").trim())
                    i++
                }
                blocks.add(MarkdownBlock.Blockquote(quoteLines.joinToString("\n")))
            }

            // Task list item: - [x] or - [ ]
            line.trimStart().matches(Regex("^[-*]\\s+\\[[ xX]\\]\\s+.*")) -> {
                val isChecked = line.contains("[x]", ignoreCase = true)
                val text = line.replace(Regex("^[-*]\\s+\\[[ xX]\\]\\s+"), "").trim()
                blocks.add(MarkdownBlock.TaskItem(isChecked, text))
                i++
            }

            // Bullet list item: * or -
            line.trimStart().matches(Regex("^[-*•]\\s+.*")) -> {
                val indent = (line.takeWhile { it.isWhitespace() }.length / 2)
                val text = line.trimStart().removePrefix("-").removePrefix("*").removePrefix("•").trim()
                blocks.add(MarkdownBlock.BulletItem(indent, text))
                i++
            }

            // Numbered list item: 1. 2. etc.
            line.trimStart().matches(Regex("^\\d+\\.\\s+.*")) -> {
                val match = Regex("^(\\d+)\\.\\s+(.*)").find(line.trimStart())
                val num = match?.groupValues?.getOrNull(1) ?: "1"
                val text = match?.groupValues?.getOrNull(2) ?: line
                val indent = (line.takeWhile { it.isWhitespace() }.length / 2)
                blocks.add(MarkdownBlock.NumberedItem(indent, num, text))
                i++
            }

            // Table row: | Col 1 | Col 2 |
            line.trim().startsWith("|") && line.trim().endsWith("|") -> {
                val tableLines = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
                    tableLines.add(lines[i].trim())
                    i++
                }
                if (tableLines.size >= 2) {
                    val headerCells = tableLines[0].split("|").filter { it.isNotBlank() }
                    // skip tableLines[1] if it's separator (|---|---|)
                    val dataRows = tableLines.drop(if (tableLines.size > 1 && tableLines[1].contains("-")) 2 else 1)
                        .map { rowLine ->
                            rowLine.split("|").filter { it.isNotBlank() }
                        }
                    blocks.add(MarkdownBlock.Table(headerCells, dataRows))
                }
            }

            // Empty line
            line.isBlank() -> {
                i++
            }

            // Standard Paragraph
            else -> {
                val paragraphLines = mutableListOf<String>()
                while (i < lines.size &&
                    lines[i].isNotBlank() &&
                    !lines[i].startsWith("#") &&
                    !lines[i].trimStart().startsWith("```") &&
                    !lines[i].trimStart().startsWith(">") &&
                    !lines[i].trimStart().matches(Regex("^[-*•]\\s+.*")) &&
                    !lines[i].trimStart().matches(Regex("^\\d+\\.\\s+.*")) &&
                    !lines[i].trim().startsWith("|")
                ) {
                    paragraphLines.add(lines[i])
                    i++
                }
                blocks.add(MarkdownBlock.Paragraph(paragraphLines.joinToString(" ")))
            }
        }
    }

    return blocks
}

data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)
