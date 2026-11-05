//! Document imports (MIGRATION_PLAN.md §10 Step 7.3).
//!
//! Rust receives a sandboxed path — never a platform URI — and decides what the
//! file is from its bytes and its extension. The Kotlin importer trusted the
//! MIME type the picker reported, which is why a renamed `.zip` could be
//! embedded as text; here the extension and the magic bytes must agree.

use std::path::{Path, PathBuf};

use crate::domain::{DocumentType, VukkoError};

/// The largest file the importer will accept in one go (25 MiB).
pub const MAX_IMPORT_BYTES: u64 = 25 * 1024 * 1024;

/// A validated document ready for ingestion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedDocument {
    pub path: PathBuf,
    pub name: String,
    pub document_type: DocumentType,
    pub size_bytes: u64,
}

/// What a file is, decided from its extension and its first bytes.
///
/// Images are deliberately absent: a picture is a chat attachment (it travels to
/// the model as vision input), not an embedded document. `DocumentType` is
/// persisted, so an `IMAGE` variant would be a schema change for a case the
/// ingestion pipeline does not handle.
pub fn document_type(path: &Path, head: &[u8]) -> Option<DocumentType> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "pdf" if head.starts_with(b"%PDF-") => Some(DocumentType::PDF),
        "md" | "markdown" => Some(DocumentType::MARKDOWN),
        "txt" | "log" | "json" => Some(DocumentType::TEXT),
        _ => None,
    }
}

/// True when the file is an image, so the caller can say *why* it is refused
/// instead of reporting a generic unsupported type.
pub fn is_image(path: &Path, head: &[u8]) -> bool {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => head.starts_with(&[0x89, b'P', b'N', b'G']),
        "jpg" | "jpeg" => head.starts_with(&[0xFF, 0xD8]),
        "webp" => head.starts_with(b"RIFF"),
        _ => false,
    }
}

/// Validates a candidate file before it is ingested.
///
/// Every rejection is a distinct, actionable error: the user picked something
/// the importer cannot read, and saying so is the whole point.
pub fn validate(path: &Path, sandbox_root: &Path) -> Result<ImportedDocument, VukkoError> {
    let canonical = path
        .canonicalize()
        .map_err(|_| VukkoError::not_found(path.display()))?;

    // A path outside the sandbox means the host handed over a foreign URI's
    // path: refuse rather than reading something the user did not share.
    let root = sandbox_root
        .canonicalize()
        .map_err(|_| VukkoError::not_found(sandbox_root.display()))?;
    if !canonical.starts_with(&root) {
        return Err(VukkoError::new(
            crate::domain::ErrorCode::VALIDATION,
            format!(
                "{} is outside the app sandbox; copy it in first",
                path.display()
            ),
        ));
    }

    let metadata = canonical
        .metadata()
        .map_err(|error| VukkoError::storage(format!("could not read the file: {}", error)))?;
    if !metadata.is_file() {
        return Err(VukkoError::validation(format!(
            "{} is not a file",
            path.display()
        )));
    }
    if metadata.len() == 0 {
        return Err(VukkoError::validation(format!(
            "{} is empty",
            path.display()
        )));
    }
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err(VukkoError::validation(format!(
            "{} is larger than the {} MiB import limit",
            path.display(),
            MAX_IMPORT_BYTES / (1024 * 1024)
        )));
    }

    let head = read_head(&canonical, 8)?;
    let name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let document_type = document_type(&canonical, &head).ok_or_else(|| {
        if is_image(&canonical, &head) {
            return VukkoError::new(
                crate::domain::ErrorCode::UNSUPPORTED,
                format!("{} is an image; attach it to a message to use vision", name),
            );
        }
        VukkoError::new(
            crate::domain::ErrorCode::UNSUPPORTED,
            format!("{} is not a supported document type", name),
        )
    })?;

    Ok(ImportedDocument {
        path: canonical,
        name,
        document_type,
        size_bytes: metadata.len(),
    })
}

fn read_head(path: &Path, bytes: usize) -> Result<Vec<u8>, VukkoError> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)
        .map_err(|error| VukkoError::storage(format!("could not open the file: {}", error)))?;
    let mut buffer = vec![0u8; bytes];
    let read = file
        .read(&mut buffer)
        .map_err(|error| VukkoError::storage(format!("could not read the file: {}", error)))?;
    buffer.truncate(read);
    Ok(buffer)
}

/// The file name an export is written under, matching the Rust exporter.
pub fn export_file_name(thread_id: &str, completed_at: i64, format: &str) -> String {
    format!("vukko_thread_{}_{}.{}", thread_id, completed_at, format)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn sandbox() -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().expect("temp dir");
        let root = directory.path().to_path_buf();
        (directory, root)
    }

    fn write(root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = root.join(name);
        let mut file = std::fs::File::create(&path).expect("create");
        file.write_all(bytes).expect("write");
        path
    }

    #[test]
    fn a_pdf_is_recognised_by_its_magic_bytes() {
        let (_guard, root) = sandbox();
        let path = write(&root, "paper.pdf", b"%PDF-1.7\n...");
        let document = validate(&path, &root).expect("valid");
        assert_eq!(document.document_type, DocumentType::PDF);
        assert_eq!(document.name, "paper.pdf");
    }

    #[test]
    fn a_renamed_archive_is_refused_instead_of_ingested_as_text() {
        let (_guard, root) = sandbox();
        let path = write(&root, "notes.txt.zip", b"PK\x03\x04");
        assert_eq!(document_type(&path, b"PK\x03\x04"), None);
        let error = validate(&path, &root).expect_err("unsupported");
        assert_eq!(error.code, crate::domain::ErrorCode::UNSUPPORTED);
    }

    #[test]
    fn a_path_outside_the_sandbox_is_refused() {
        let (_guard, root) = sandbox();
        let outside = tempfile::tempdir().expect("other dir");
        let path = write(outside.path(), "secret.md", b"# hi");

        let error = validate(&path, &root).expect_err("outside the sandbox");
        assert_eq!(error.code, crate::domain::ErrorCode::VALIDATION);
        assert!(error.message.contains("sandbox"));
    }

    #[test]
    fn an_empty_file_is_refused() {
        let (_guard, root) = sandbox();
        let path = write(&root, "empty.md", b"");
        let error = validate(&path, &root).expect_err("empty");
        assert_eq!(error.code, crate::domain::ErrorCode::VALIDATION);
    }

    #[test]
    fn a_missing_file_is_not_found() {
        let (_guard, root) = sandbox();
        let error = validate(&root.join("nope.pdf"), &root).expect_err("missing");
        assert_eq!(error.code, crate::domain::ErrorCode::NOT_FOUND);
    }

    #[test]
    fn markdown_is_a_markdown_document_and_text_is_text() {
        let (_guard, root) = sandbox();
        let markdown = write(&root, "notes.md", b"# Sovereignty");
        assert_eq!(
            validate(&markdown, &root).expect("markdown").document_type,
            DocumentType::MARKDOWN
        );

        let text = write(&root, "log.txt", b"line");
        assert_eq!(
            validate(&text, &root).expect("text").document_type,
            DocumentType::TEXT
        );
    }

    #[test]
    fn an_image_is_refused_with_advice_instead_of_a_generic_error() {
        let (_guard, root) = sandbox();
        let image = write(&root, "chart.png", &[0x89, b'P', b'N', b'G', 0x0D]);

        assert!(is_image(&image, &[0x89, b'P', b'N', b'G']));
        let error = validate(&image, &root).expect_err("images are attachments");
        assert_eq!(error.code, crate::domain::ErrorCode::UNSUPPORTED);
        assert!(error.message.contains("attach it to a message"));
    }

    #[test]
    fn export_names_match_the_exporter() {
        assert_eq!(
            export_file_name("th_abc", 1_767_225_600_000, "md"),
            "vukko_thread_th_abc_1767225600000.md"
        );
    }
}
