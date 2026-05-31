//! Clipboard / asset workflow commands (Slice C).
//!
//! Two renderer-facing commands:
//!
//! - [`import_image_asset`] — copy pasted/dropped image bytes into
//!   `images/<document-stem>/<name>` beside a **saved** document, auto-extend
//!   the per-document asset grant for that subfolder, and hand the renderer a
//!   relative `images/<stem>/<name>` path to embed as `![](…)`.
//! - [`paste_html_as_markdown`] — sanitize untrusted clipboard HTML through the
//!   strict ammonia pipeline, then convert the *sanitized* HTML to Markdown.
//!
//! # Security model
//!
//! Image import writes only inside the active document's own directory tree
//! (`<doc-dir>/images/<stem>/`). The destination is built from the canonical
//! document path returned by the registry — the renderer never nominates a
//! directory. On Unix, `images/`, `<stem>/`, and the destination file are
//! created/opened with `openat`/`mkdirat` plus `O_NOFOLLOW`; other platforms use
//! best-effort symlink checks plus no-follow final writes. The grant we extend
//! is revalidated against the non-symlink document-relative folder and reuses
//! the existing
//! [`crate::preview::grants`] machinery (same `allow_directory` mirror that the
//! folder-grant dialog uses), so a freshly-written image renders immediately
//! without widening authority beyond that one subfolder.
//!
//! Clipboard HTML is treated as fully **untrusted**: it is run through
//! `pmd_core::sanitize::clean` (the strict markdown allowlist — strips
//! `<script>`, every `on*` handler, `javascript:` URLs, etc.) *before* it ever
//! reaches the HTML→Markdown converter, so no active content can survive into
//! the inserted Markdown. The render pipeline independently re-sanitizes on
//! display, so the inserted text is inert twice over.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::doc::state::DocId;
use crate::preview::render_pipeline::ValidationWorker;

const FALLBACK_IMAGE_NAME: &str = "image";
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_FILE_NAME_CHARS: usize = 120;

/// Outcome of a successful image import, returned to the renderer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportedImage {
    /// Document-relative path to embed, e.g. `images/notes/pasted-1.png`.
    /// Always forward-slash separated so it is portable inside Markdown.
    pub relative_path: String,
    /// Absolute canonical path the bytes were written to (diagnostics).
    pub absolute_path: PathBuf,
}

/// Sanitize a candidate file name into a single safe path component.
///
/// Strips any directory parts (keeps only the final component), drops control
/// characters and path separators, and falls back to `image` when nothing
/// usable remains. This defends against names like `../../etc/passwd` or
/// `a/b.png` smuggled through the drop payload — the result is always a plain
/// file name with no separators.
pub(crate) fn sanitize_file_name(raw: &str) -> String {
    // Keep only the final path component (defeats `../` and nested dirs).
    let raw_base = raw.rsplit(['/', '\\']).next().unwrap_or(raw).trim();
    let extension_only = raw_base.starts_with('.')
        && raw_base[1..].chars().all(|c| c.is_ascii_alphanumeric())
        && !raw_base[1..].is_empty();
    let owned_base;
    let base = if extension_only {
        owned_base = format!("{FALLBACK_IMAGE_NAME}{raw_base}");
        owned_base.as_str()
    } else {
        raw_base.trim_matches(|c| c == '.' || c == ' ')
    };
    let mut cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    while cleaned.contains("--") {
        cleaned = cleaned.replace("--", "-");
    }
    let cleaned = cleaned
        .trim_matches(|c| c == '.' || c == '-' || c == '_')
        .to_string();
    if cleaned.is_empty() {
        return FALLBACK_IMAGE_NAME.to_string();
    }

    let (stem, ext) = split_name(&cleaned);
    let stem = if stem.is_empty() {
        FALLBACK_IMAGE_NAME
    } else {
        stem
    };
    let max_stem_chars = MAX_FILE_NAME_CHARS
        .saturating_sub(ext.chars().count())
        .max(1);
    let mut truncated_stem: String = stem.chars().take(max_stem_chars).collect();
    truncated_stem = truncated_stem
        .trim_matches(|c| c == '.' || c == '-' || c == '_' || c == ' ')
        .to_string();
    if truncated_stem.is_empty() {
        truncated_stem = FALLBACK_IMAGE_NAME.to_string();
    }
    if ext.is_empty() {
        truncated_stem
    } else {
        format!("{truncated_stem}{ext}")
    }
}

/// Split a sanitized file name into `(stem, dot_extension)` where the extension
/// includes its leading dot (or is empty). A leading-dot name like `.png` is
/// treated as having no extension so collision suffixing stays readable.
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(idx) if idx > 0 => (&name[..idx], &name[idx..]),
        _ => (name, ""),
    }
}

/// Choose a non-colliding file name inside `dir` for `desired`, suffixing
/// `-1`, `-2`, … before the extension until a free name is found. Pure given a
/// predicate `exists` so it is unit-testable without the filesystem.
#[cfg(any(test, not(unix)))]
pub(crate) fn pick_unique_name(desired: &str, exists: impl Fn(&str) -> bool) -> String {
    if !exists(desired) {
        return desired.to_string();
    }
    let (stem, ext) = split_name(desired);
    let mut n = 1u32;
    loop {
        let candidate = format!("{stem}-{n}{ext}");
        if !exists(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// The document stem (file name without extension) used as the per-document
/// image subfolder name. Sanitized to a single safe component.
fn document_stem(doc_path: &Path) -> String {
    let stem = doc_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");
    sanitize_file_name(stem)
}

/// Build the absolute image-folder path (`<doc-dir>/images/<stem>`) for a
/// document. Returns an error if the document has no parent directory.
fn image_folder_for(doc_path: &Path) -> Result<PathBuf, String> {
    let parent = doc_path
        .parent()
        .ok_or_else(|| "document has no parent directory".to_string())?;
    Ok(parent.join("images").join(document_stem(doc_path)))
}

fn canonical_image_folder_for_grant(folder: &Path) -> Result<PathBuf, String> {
    let canonical = folder
        .canonicalize()
        .map_err(|e| format!("could not verify image folder {}: {e}", folder.display()))?;
    if canonical != folder {
        return Err(format!(
            "refusing to grant image folder {} because it resolves outside the document image folder",
            folder.display()
        ));
    }
    Ok(canonical)
}

fn ensure_reasonable_image_size(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("image import refused an empty file".to_string());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "image import refused {} bytes; maximum is {} MiB",
            bytes.len(),
            MAX_IMAGE_BYTES / (1024 * 1024)
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn cstring_component(component: &str) -> Result<std::ffi::CString, String> {
    use std::os::unix::ffi::OsStrExt;

    std::ffi::CString::new(std::ffi::OsStr::new(component).as_bytes())
        .map_err(|_| "path component contains a NUL byte".to_string())
}

#[cfg(unix)]
fn open_dir_no_follow(path: &Path) -> Result<std::fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| {
            format!(
                "could not open directory {} without following symlinks: {e}",
                path.display()
            )
        })
}

#[cfg(unix)]
fn open_or_create_child_dir_no_follow(
    parent: &std::fs::File,
    parent_path: &Path,
    component: &str,
) -> Result<std::fs::File, String> {
    use std::os::fd::{AsRawFd, FromRawFd};

    let c_component = cstring_component(component)?;
    let mkdir_result = unsafe { libc::mkdirat(parent.as_raw_fd(), c_component.as_ptr(), 0o755) };
    if mkdir_result != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::EEXIST) {
            return Err(format!(
                "could not create image folder {}: {err}",
                parent_path.join(component).display()
            ));
        }
    }

    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            c_component.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(format!(
            "refusing image folder {} because it is not a real directory: {}",
            parent_path.join(component).display(),
            std::io::Error::last_os_error()
        ));
    }
    Ok(unsafe { std::fs::File::from_raw_fd(fd) })
}

#[cfg(unix)]
fn write_unique_no_follow_in_dir(
    folder: &std::fs::File,
    folder_path: &Path,
    desired: &str,
    bytes: &[u8],
) -> Result<(String, PathBuf), String> {
    use std::io::Write;
    use std::os::fd::{AsRawFd, FromRawFd};

    let (stem, ext) = split_name(desired);
    for n in 0u32.. {
        let candidate = if n == 0 {
            desired.to_string()
        } else {
            format!("{stem}-{n}{ext}")
        };
        let c_candidate = cstring_component(&candidate)?;
        let fd = unsafe {
            libc::openat(
                folder.as_raw_fd(),
                c_candidate.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o644,
            )
        };
        if fd < 0 {
            let err = std::io::Error::last_os_error();
            if err.kind() == std::io::ErrorKind::AlreadyExists
                || err.raw_os_error() == Some(libc::EEXIST)
            {
                continue;
            }
            return Err(format!(
                "could not create image {} without following symlinks: {err}",
                folder_path.join(&candidate).display()
            ));
        }

        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| {
                format!(
                    "could not write image {}: {e}",
                    folder_path.join(&candidate).display()
                )
            })?;
        return Ok((candidate.clone(), folder_path.join(candidate)));
    }
    Err("could not choose a non-colliding image file name".to_string())
}

#[cfg(unix)]
fn import_image_to_doc_dir_no_follow(
    doc_path: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<(ImportedImage, PathBuf, bool), String> {
    ensure_reasonable_image_size(bytes)?;

    let parent = doc_path
        .parent()
        .ok_or_else(|| "document has no parent directory".to_string())?;
    let stem = document_stem(doc_path);
    let images_path = parent.join("images");
    let folder = images_path.join(&stem);
    let folder_existed = folder.exists();

    let parent_dir = open_dir_no_follow(parent)?;
    let images_dir = open_or_create_child_dir_no_follow(&parent_dir, parent, "images")?;
    let image_dir = open_or_create_child_dir_no_follow(&images_dir, &images_path, &stem)?;

    let safe = sanitize_file_name(file_name);
    let (unique, dest) = write_unique_no_follow_in_dir(&image_dir, &folder, &safe, bytes)?;

    let relative_path = format!("images/{stem}/{unique}");
    let absolute_path = dest.canonicalize().unwrap_or(dest);
    Ok((
        ImportedImage {
            relative_path,
            absolute_path,
        },
        folder,
        !folder_existed,
    ))
}

#[cfg(not(unix))]
fn ensure_real_dir(path: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| format!("could not inspect image folder {}: {e}", path.display()))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(format!(
            "refusing image folder {} because it is not a real directory",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn import_image_to_doc_dir_no_follow(
    doc_path: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<(ImportedImage, PathBuf, bool), String> {
    ensure_reasonable_image_size(bytes)?;

    let folder = image_folder_for(doc_path)?;
    let folder_existed = folder.exists();
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("could not create image folder {}: {e}", folder.display()))?;
    let images = folder
        .parent()
        .ok_or_else(|| "image folder has no parent".to_string())?;
    ensure_real_dir(images)?;
    ensure_real_dir(&folder)?;

    let safe = sanitize_file_name(file_name);
    let unique = pick_unique_name(&safe, |name| folder.join(name).exists());
    let dest = folder.join(&unique);
    crate::cmd::file::write_no_follow(&dest, bytes)
        .map_err(|e| format!("could not write image {}: {e}", dest.display()))?;

    let stem = document_stem(doc_path);
    let relative_path = format!("images/{stem}/{unique}");
    let absolute_path = dest.canonicalize().unwrap_or(dest);
    Ok((
        ImportedImage {
            relative_path,
            absolute_path,
        },
        folder,
        !folder_existed,
    ))
}

/// Core import logic, factored out of the Tauri command so it is unit-testable.
///
/// Writes `bytes` to `<doc-dir>/images/<stem>/<unique-name>` (creating the
/// folder), returning the chosen relative path and whether the per-document
/// image folder had to be created. The destination directory is *never*
/// renderer-supplied: it is derived from `doc_path`.
fn import_image_to_doc_dir(
    doc_path: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<(ImportedImage, PathBuf, bool), String> {
    import_image_to_doc_dir_no_follow(doc_path, file_name, bytes)
}

/// Copy a pasted/dropped image into the active document's `images/<stem>/`
/// folder and extend the asset grant so it renders immediately.
///
/// Preconditions enforced here:
/// - `doc_id` must be the active document (write authority) and have a saved
///   path; an unsaved buffer is rejected so the renderer can prompt to save.
/// - If the per-document image folder does not exist yet, `confirm_new_folder`
///   must be `true`; otherwise the call returns `Ok(None)` so the renderer can
///   ask the user to confirm the first write into a new folder.
#[tauri::command]
pub async fn import_image_asset(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    validation: tauri::State<'_, ValidationWorker>,
    doc_id: DocId,
    file_name: String,
    bytes: Vec<u8>,
    confirm_new_folder: bool,
) -> Result<Option<ImportedImage>, String> {
    if !state.docs.is_active(doc_id) {
        return Err("image import requires the active document".into());
    }
    let doc_path = state
        .docs
        .path_of(doc_id)
        .ok_or_else(|| "image import requires a saved document; save it first".to_string())?;

    // First write into a not-yet-created folder needs explicit confirmation.
    let folder = image_folder_for(&doc_path)?;
    if !folder.exists() && !confirm_new_folder {
        return Ok(None);
    }

    let (imported, folder, _newly_created) =
        import_image_to_doc_dir(&doc_path, &file_name, &bytes)?;

    // Extend the per-document grant for the image subfolder so the freshly
    // written file resolves on the next render. Reuses the same grant store /
    // asset-scope mirror as the folder-grant dialog; no new authority surface.
    let grant_root = canonical_image_folder_for_grant(&folder)?;
    crate::preview::grants::grant_remembered_root(window.label(), doc_id, &grant_root)?;
    validation.invalidate_for_grant_change(doc_id.0).await;

    Ok(Some(imported))
}

/// Convert untrusted clipboard HTML to Markdown: sanitize first, then convert.
///
/// The input is treated as fully untrusted clipboard data. It is cleaned with
/// the strict markdown allowlist (`pmd_core::sanitize::clean`) — which removes
/// scripts, event handlers and unsafe URL schemes — *before* the HTML→Markdown
/// conversion runs, so nothing executable can survive into the result.
///
/// Note: the strict allowlist also strips raw `<a href>` / `<img src>` URLs
/// (the live render pipeline resolves URLs via the resource policy, not raw
/// markup). For untrusted clipboard HTML this is the safe default — link/image
/// *text* is preserved but no clipboard-supplied URL is carried in.
pub(crate) fn html_clipboard_to_markdown(html: &str) -> String {
    let html = strip_html_comments(html);
    let html = strip_dangerous_html_blocks(&html);
    let sanitized = pmd_core::sanitize::clean(&html);
    match htmd::convert(&sanitized) {
        Ok(md) => md,
        // htmd only errors on malformed input; fall back to the sanitized HTML
        // as plain text so the user never silently loses their paste.
        Err(_) => sanitized,
    }
}

fn strip_dangerous_html_blocks(html: &str) -> std::borrow::Cow<'_, str> {
    const BLOCKS: &[&str] = &[
        "script", "style", "noscript", "iframe", "object", "embed", "template",
    ];

    let mut current = html.to_string();
    let mut changed = false;
    for tag in BLOCKS {
        let next = strip_html_element_blocks(&current, tag);
        changed |= matches!(next, std::borrow::Cow::Owned(_));
        current = next.into_owned();
    }
    if changed {
        std::borrow::Cow::Owned(current)
    } else {
        std::borrow::Cow::Borrowed(html)
    }
}

fn strip_html_element_blocks<'a>(html: &'a str, tag: &str) -> std::borrow::Cow<'a, str> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let Some(mut start) = lower.find(&open) else {
        return std::borrow::Cow::Borrowed(html);
    };

    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    loop {
        out.push_str(&html[cursor..start]);
        let after_open = start + open.len();
        let Some(end_offset) = lower[after_open..].find(&close) else {
            return std::borrow::Cow::Owned(out);
        };
        cursor = after_open + end_offset + close.len();
        let Some(next_start_offset) = lower[cursor..].find(&open) else {
            out.push_str(&html[cursor..]);
            return std::borrow::Cow::Owned(out);
        };
        start = cursor + next_start_offset;
    }
}

fn strip_html_comments(html: &str) -> std::borrow::Cow<'_, str> {
    let Some(mut start) = html.find("<!--") else {
        return std::borrow::Cow::Borrowed(html);
    };

    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    loop {
        out.push_str(&html[cursor..start]);
        let comment_body = start + 4;
        let Some(end_offset) = html[comment_body..].find("-->") else {
            return std::borrow::Cow::Owned(out);
        };
        cursor = comment_body + end_offset + 3;
        let Some(next_start_offset) = html[cursor..].find("<!--") else {
            out.push_str(&html[cursor..]);
            return std::borrow::Cow::Owned(out);
        };
        start = cursor + next_start_offset;
    }
}

/// Convert clipboard HTML to Markdown for paste-as-Markdown (`Ctrl+Shift+V`).
#[tauri::command]
pub async fn paste_html_as_markdown(html: String) -> Result<String, String> {
    Ok(html_clipboard_to_markdown(&html))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_file_name_strips_path_traversal_and_separators() {
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("a/b/c.png"), "c.png");
        assert_eq!(sanitize_file_name("foo\\bar.png"), "bar.png");
        assert_eq!(sanitize_file_name("  spaced.png  "), "spaced.png");
        assert_eq!(sanitize_file_name("/tmp/.png"), "image.png");
        assert_eq!(
            sanitize_file_name("x.png) [bad](javascript:evil)"),
            "x.png-bad-javascript-evil"
        );
        assert_eq!(
            sanitize_file_name("percent%2fslash.png"),
            "percent-2fslash.png"
        );
        assert_eq!(sanitize_file_name(""), "image");
        assert_eq!(sanitize_file_name("..."), "image");
    }

    #[test]
    fn sanitize_file_name_caps_very_long_names() {
        let name = format!("{}.png", "a".repeat(300));
        let safe = sanitize_file_name(&name);
        assert!(safe.ends_with(".png"), "{safe}");
        assert!(safe.chars().count() <= MAX_FILE_NAME_CHARS, "{safe}");
    }

    #[test]
    fn pick_unique_name_suffixes_before_extension() {
        let taken = ["a.png", "a-1.png"];
        let exists = |n: &str| taken.contains(&n);
        assert_eq!(pick_unique_name("a.png", exists), "a-2.png");
        assert_eq!(pick_unique_name("b.png", exists), "b.png");
    }

    #[test]
    fn pick_unique_name_handles_no_extension() {
        let taken = ["img"];
        let exists = |n: &str| taken.contains(&n);
        assert_eq!(pick_unique_name("img", exists), "img-1");
    }

    #[test]
    fn import_builds_path_under_images_stem_and_writes_bytes() {
        let dir = tempfile::tempdir().expect("tmp");
        let doc = dir.path().join("Notes.md");
        std::fs::write(&doc, "# hi").expect("doc");

        let (imported, folder, newly_created) =
            import_image_to_doc_dir(&doc, "diagram.png", b"\x89PNG").expect("import");

        assert_eq!(imported.relative_path, "images/Notes/diagram.png");
        assert!(newly_created, "folder did not exist before");
        assert_eq!(folder, dir.path().join("images").join("Notes"));
        let written = std::fs::read(dir.path().join("images/Notes/diagram.png")).expect("read");
        assert_eq!(written, b"\x89PNG");
    }

    #[test]
    fn import_suffixes_on_collision() {
        let dir = tempfile::tempdir().expect("tmp");
        let doc = dir.path().join("Notes.md");
        std::fs::write(&doc, "# hi").expect("doc");

        let (first, _, _) = import_image_to_doc_dir(&doc, "a.png", b"1").expect("first");
        let (second, _, second_new) = import_image_to_doc_dir(&doc, "a.png", b"2").expect("second");

        assert_eq!(first.relative_path, "images/Notes/a.png");
        assert_eq!(second.relative_path, "images/Notes/a-1.png");
        assert!(!second_new, "folder already existed for the second import");
    }

    #[test]
    fn import_refuses_to_escape_doc_dir_via_filename() {
        let dir = tempfile::tempdir().expect("tmp");
        let doc = dir.path().join("Notes.md");
        std::fs::write(&doc, "# hi").expect("doc");

        let (imported, _, _) =
            import_image_to_doc_dir(&doc, "../../evil.png", b"x").expect("import");
        // The traversal is stripped: the file lands under images/<stem>/, never
        // outside the document directory.
        assert_eq!(imported.relative_path, "images/Notes/evil.png");
        assert!(imported
            .absolute_path
            .starts_with(dir.path().canonicalize().unwrap()));
        assert!(!dir.path().parent().unwrap().join("evil.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn import_refuses_symlinked_images_directory() {
        let dir = tempfile::tempdir().expect("tmp");
        let outside = tempfile::tempdir().expect("outside");
        let doc = dir.path().join("Notes.md");
        std::fs::write(&doc, "# hi").expect("doc");
        std::os::unix::fs::symlink(outside.path(), dir.path().join("images")).expect("symlink");

        let err = import_image_to_doc_dir(&doc, "a.png", b"1").expect_err("symlink refused");

        assert!(
            err.contains("not a real directory") || err.contains("following symlinks"),
            "{err}"
        );
        assert!(!outside.path().join("Notes/a.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn import_refuses_symlinked_document_image_subfolder() {
        let dir = tempfile::tempdir().expect("tmp");
        let outside = tempfile::tempdir().expect("outside");
        let doc = dir.path().join("Notes.md");
        std::fs::write(&doc, "# hi").expect("doc");
        std::fs::create_dir(dir.path().join("images")).expect("images");
        std::os::unix::fs::symlink(outside.path(), dir.path().join("images/Notes"))
            .expect("symlink");

        let err = import_image_to_doc_dir(&doc, "a.png", b"1").expect_err("symlink refused");

        assert!(
            err.contains("not a real directory") || err.contains("following symlinks"),
            "{err}"
        );
        assert!(!outside.path().join("a.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn grant_root_verification_refuses_swapped_symlink_folder() {
        let dir = tempfile::tempdir().expect("tmp");
        let outside = tempfile::tempdir().expect("outside");
        let folder = dir.path().join("images/Notes");
        std::fs::create_dir_all(folder.parent().unwrap()).expect("images");
        std::os::unix::fs::symlink(outside.path(), &folder).expect("symlink");

        let err = canonical_image_folder_for_grant(&folder).expect_err("symlink refused");

        assert!(err.contains("resolves outside"), "{err}");
    }

    #[test]
    fn import_refuses_empty_and_oversized_images() {
        let dir = tempfile::tempdir().expect("tmp");
        let doc = dir.path().join("Notes.md");
        std::fs::write(&doc, "# hi").expect("doc");

        let err = import_image_to_doc_dir(&doc, "a.png", b"").expect_err("empty refused");
        assert!(err.contains("empty"), "{err}");

        let huge = vec![0u8; MAX_IMAGE_BYTES + 1];
        let err = import_image_to_doc_dir(&doc, "a.png", &huge).expect_err("huge refused");
        assert!(err.contains("maximum"), "{err}");
    }

    #[test]
    fn html_to_markdown_basic_mappings() {
        let md = html_clipboard_to_markdown("<h1>Title</h1><p>Hello <strong>world</strong></p>");
        assert!(md.contains("# Title"), "heading: {md}");
        assert!(md.contains("**world**"), "bold: {md}");
    }

    #[test]
    fn html_to_markdown_sanitizes_before_converting_script() {
        let md = html_clipboard_to_markdown("<p>safe</p><script>steal()</script>");
        assert!(md.contains("safe"), "kept text: {md}");
        assert!(!md.contains("steal"), "script body must not survive: {md}");
        assert!(!md.contains("<script"), "script tag must not survive: {md}");
    }

    #[test]
    fn html_to_markdown_strips_onerror_and_javascript_urls() {
        let md = html_clipboard_to_markdown(
            "<img src=x onerror=\"alert(1)\"><a href=\"javascript:evil()\">link</a>",
        );
        assert!(!md.contains("onerror"), "handler must be stripped: {md}");
        assert!(!md.contains("alert(1)"), "handler body must be gone: {md}");
        assert!(
            !md.contains("javascript:"),
            "javascript: URL must be stripped: {md}"
        );
    }

    #[test]
    fn html_to_markdown_strips_comments_svg_mathml_and_mxss_vectors() {
        let md = html_clipboard_to_markdown(
            "<!-- <img src=x onerror=evil()> -->\
             <svg><a href=\"javascript:evil()\"><text>svg text</text></a></svg>\
             <math href=\"javascript:evil()\"><mi>x</mi></math>\
             <noscript><img src=x onerror=evil()></noscript>\
             <p><style></p><img src=x onerror=evil()></style>ok</p>",
        );

        assert!(md.contains("ok"), "{md}");
        assert!(!md.contains("<!--"), "{md}");
        assert!(!md.contains("onerror"), "{md}");
        assert!(!md.contains("javascript:"), "{md}");
        assert!(!md.contains("<svg"), "{md}");
        assert!(!md.contains("<math"), "{md}");
        assert!(!md.contains("<style"), "{md}");
    }

    #[test]
    fn html_to_markdown_strips_data_html_urls_before_htmd() {
        let md = html_clipboard_to_markdown(
            "<a href=\"data:text/html,<script>alert(1)</script>\">data</a>\
             <img src=\"data:text/html,<script>alert(2)</script>\" alt=\"payload\">",
        );

        assert!(md.contains("data"), "{md}");
        assert!(!md.contains("data:text/html"), "{md}");
        assert!(!md.contains("script"), "{md}");
        assert!(!md.contains("alert"), "{md}");
    }

    #[test]
    fn html_to_markdown_lists_and_emphasis() {
        let md =
            html_clipboard_to_markdown("<ul><li>one</li><li>two</li></ul><p><em>note</em></p>");
        assert!(md.contains("one"), "list item: {md}");
        assert!(md.contains("two"), "list item: {md}");
        assert!(
            md.contains("*note*") || md.contains("_note_"),
            "emphasis: {md}"
        );
    }

    #[test]
    fn html_to_markdown_drops_link_and_image_urls_but_keeps_text() {
        // The strict markdown allowlist (`clean`) strips raw `<a href>` and
        // `<img src>` URLs — by design, the live render pipeline resolves URLs
        // through the resource policy, not from raw markup. For untrusted
        // clipboard HTML this is the safe default: link/image *text* survives,
        // but no clipboard-supplied URL is carried into the document.
        let md = html_clipboard_to_markdown(
            "<a href=\"https://example.com\">site</a> and <img src=\"https://x/y.png\" alt=\"pic\">",
        );
        assert!(md.contains("site"), "link text kept: {md}");
        assert!(
            !md.contains("https://example.com"),
            "raw link URL must not survive: {md}"
        );
        assert!(
            !md.contains("https://x/y.png"),
            "raw image URL must not survive: {md}"
        );
    }
}
