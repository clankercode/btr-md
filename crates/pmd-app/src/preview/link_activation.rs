use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use pmd_core::facts::LinkKind;
use serde::{Deserialize, Serialize};

use crate::cmd::file::OpenedDoc;

type ExternalOpener = fn(&str) -> Result<(), String>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationKind {
    Primary,
    Keyboard,
    Auxiliary,
    ContextMenu,
    Drag,
    WebviewNavigation,
}

impl ActivationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Keyboard => "keyboard",
            Self::Auxiliary => "auxiliary",
            Self::ContextMenu => "context_menu",
            Self::Drag => "drag",
            Self::WebviewNavigation => "webview_navigation",
        }
    }
}

#[derive(Serialize)]
pub struct LinkActivationResponse {
    pub kind: LinkActivationResponseKind,
    pub block_id: Option<String>,
    pub opened_document: Option<OpenedDoc>,
    pub normalized_url: Option<String>,
    pub scheme: Option<String>,
    pub host: Option<String>,
    pub label_text: Option<String>,
    pub action_token: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkActivationResponseKind {
    ScrollToBlock,
    OpenDocument,
    OpenDefaultApp,
    ExternalConfirmation,
    Denied,
}

impl LinkActivationResponseKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ScrollToBlock => "scroll_to_block",
            Self::OpenDocument => "open_document",
            Self::OpenDefaultApp => "open_default_app",
            Self::ExternalConfirmation => "external_confirmation",
            Self::Denied => "denied",
        }
    }
}

#[derive(Debug, Clone)]
struct StoredLink {
    target: String,
    label_text: String,
    kind: LinkKind,
    doc_path: Option<PathBuf>,
    line_start: u32,
    line_end: u32,
}

#[derive(Debug, Clone)]
struct PendingExternalOpen {
    doc_id: u64,
    version: u64,
    link_id: String,
    activation_kind: ActivationKind,
    normalized_url: String,
    scheme: String,
    host: Option<String>,
    label_text: String,
}

pub struct LinkActivationStore {
    links: Mutex<BTreeMap<(u64, u64, String), StoredLink>>,
    tokens: Mutex<BTreeMap<String, PendingExternalOpen>>,
    external_opener: ExternalOpener,
}

impl Default for LinkActivationStore {
    fn default() -> Self {
        Self {
            links: Mutex::new(BTreeMap::new()),
            tokens: Mutex::new(BTreeMap::new()),
            external_opener: crate::cmd::reveal::open_external_url,
        }
    }
}

impl LinkActivationStore {
    pub fn test_noop_external_opener() -> Self {
        Self {
            links: Mutex::new(BTreeMap::new()),
            tokens: Mutex::new(BTreeMap::new()),
            external_opener: |_| Ok(()),
        }
    }

    pub fn record_render_links(
        &self,
        doc_id: u64,
        version: u64,
        doc_path: Option<&Path>,
        facts: &crate::preview::contracts::DocumentFacts,
    ) {
        let mut links = self
            .links
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        links.retain(|(stored_doc, _, _), _| *stored_doc != doc_id);
        self.tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .retain(|_, pending| pending.doc_id != doc_id);
        for (idx, link) in facts.core.links.iter().enumerate() {
            let Some(target) = &link.target else {
                continue;
            };
            links.insert(
                (doc_id, version, format!("link-{idx}")),
                StoredLink {
                    target: target.clone(),
                    label_text: link.label_text.clone(),
                    kind: link.kind.clone(),
                    doc_path: doc_path.map(Path::to_path_buf),
                    line_start: link.line_start,
                    line_end: link.line_end,
                },
            );
        }
    }

    pub fn prepare_link_activation(
        &self,
        doc_id: u64,
        version: u64,
        link_id: &str,
        activation_kind: ActivationKind,
    ) -> Result<LinkActivationResponse, String> {
        let link = self.stored_link(doc_id, version, link_id)?;
        Ok(classify_stored_link(
            self,
            doc_id,
            version,
            link_id,
            activation_kind,
            link,
        ))
    }

    pub fn confirm_external_open(
        &self,
        doc_id: u64,
        version: u64,
        action_token: &str,
    ) -> Result<(), String> {
        let pending = self.take_token(doc_id, version, action_token)?;
        let _ = (
            pending.doc_id,
            pending.version,
            pending.link_id,
            pending.activation_kind,
            pending.scheme,
            pending.host,
            pending.label_text,
        );
        (self.external_opener)(&pending.normalized_url)
    }

    pub fn confirm_external_open_with_renderer_url_for_test(
        &self,
        doc_id: u64,
        version: u64,
        action_token: &str,
        renderer_url: &str,
    ) -> Result<(), String> {
        let pending = self.peek_token(doc_id, version, action_token)?;
        if pending.normalized_url != renderer_url {
            return Err("Renderer URL does not match backend-issued token".to_string());
        }
        self.confirm_external_open(doc_id, version, action_token)
    }

    pub fn insert_link_for_test(
        &self,
        doc_id: u64,
        version: u64,
        link_id: &str,
        target: &str,
        label_text: &str,
    ) {
        self.insert_link_for_test_inner(doc_id, version, link_id, target, label_text, None);
    }

    pub fn insert_link_for_test_with_doc_path(
        &self,
        doc_id: u64,
        version: u64,
        link_id: &str,
        target: &str,
        label_text: &str,
        doc_path: &Path,
    ) {
        self.insert_link_for_test_inner(
            doc_id,
            version,
            link_id,
            target,
            label_text,
            Some(doc_path.to_path_buf()),
        );
    }

    fn insert_link_for_test_inner(
        &self,
        doc_id: u64,
        version: u64,
        link_id: &str,
        target: &str,
        label_text: &str,
        doc_path: Option<PathBuf>,
    ) {
        let kind = classify_target(target);
        self.links
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                (doc_id, version, link_id.to_string()),
                StoredLink {
                    target: target.to_string(),
                    label_text: label_text.to_string(),
                    kind,
                    doc_path,
                    line_start: 1,
                    line_end: 1,
                },
            );
    }

    fn stored_link(&self, doc_id: u64, version: u64, link_id: &str) -> Result<StoredLink, String> {
        self.links
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&(doc_id, version, link_id.to_string()))
            .cloned()
            .ok_or_else(|| "Unknown or stale preview link".to_string())
    }

    fn insert_token(&self, pending: PendingExternalOpen) -> String {
        let token = generate_token();
        self.tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(token.clone(), pending);
        token
    }

    fn peek_token(
        &self,
        doc_id: u64,
        version: u64,
        action_token: &str,
    ) -> Result<PendingExternalOpen, String> {
        let tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let pending = tokens
            .get(action_token)
            .cloned()
            .ok_or_else(|| "Unknown or expired external-open token".to_string())?;
        if pending.doc_id != doc_id || pending.version != version {
            return Err("External-open token is stale for this document version".to_string());
        }
        Ok(pending)
    }

    fn take_token(
        &self,
        doc_id: u64,
        version: u64,
        action_token: &str,
    ) -> Result<PendingExternalOpen, String> {
        self.peek_token(doc_id, version, action_token)?;
        self.tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(action_token)
            .ok_or_else(|| "Unknown or expired external-open token".to_string())
    }
}

pub fn test_state() -> LinkActivationStore {
    LinkActivationStore::test_noop_external_opener()
}

#[tauri::command]
pub fn prepare_link_activation(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    links: tauri::State<'_, LinkActivationStore>,
    doc_id: u64,
    version: u64,
    link_id: String,
    activation_kind: ActivationKind,
) -> Result<LinkActivationResponse, String> {
    let link = links.stored_link(doc_id, version, &link_id)?;
    let mut response = classify_stored_link(
        &links,
        doc_id,
        version,
        &link_id,
        activation_kind,
        link.clone(),
    );
    if response.kind == LinkActivationResponseKind::OpenDocument {
        if let Some(path) = response.normalized_url.as_deref() {
            response.opened_document = Some(open_markdown_from_backend(
                &app,
                &state,
                window.label(),
                path,
            )?);
        }
    }
    if response.kind == LinkActivationResponseKind::OpenDefaultApp {
        if let Some(path) = response.normalized_url.as_deref() {
            crate::cmd::reveal::open_path_from_backend(Path::new(path))?;
            response.message = Some(format!("Opened {}", path));
        }
    }
    Ok(response)
}

#[tauri::command]
pub fn confirm_external_open(
    links: tauri::State<'_, LinkActivationStore>,
    doc_id: u64,
    version: u64,
    action_token: String,
) -> Result<(), String> {
    links.confirm_external_open(doc_id, version, &action_token)
}

fn classify_stored_link(
    store: &LinkActivationStore,
    doc_id: u64,
    version: u64,
    link_id: &str,
    activation_kind: ActivationKind,
    link: StoredLink,
) -> LinkActivationResponse {
    if matches!(
        activation_kind,
        ActivationKind::Drag | ActivationKind::ContextMenu | ActivationKind::WebviewNavigation
    ) {
        return denied("Preview link action blocked; use primary activation.");
    }

    let _line_range = (link.line_start, link.line_end);
    match link.kind {
        LinkKind::Fragment => scroll_response(link.target.trim_start_matches('#')),
        LinkKind::LocalMarkdown => match resolve_local_target(&link) {
            Ok(path) => open_document_response(path),
            Err(message) => denied(message),
        },
        LinkKind::LocalFile => match resolve_local_target(&link) {
            Ok(path) => open_default_app_response(path),
            Err(message) => denied(message),
        },
        LinkKind::ExternalUrl | LinkKind::Mailto => {
            external_confirmation_response(store, doc_id, version, link_id, activation_kind, link)
        }
        LinkKind::Reference | LinkKind::UnknownScheme => denied("Preview link blocked."),
    }
}

fn scroll_response(fragment: &str) -> LinkActivationResponse {
    LinkActivationResponse {
        kind: LinkActivationResponseKind::ScrollToBlock,
        block_id: Some(fragment.to_string()),
        opened_document: None,
        normalized_url: None,
        scheme: None,
        host: None,
        label_text: None,
        action_token: None,
        message: None,
    }
}

fn open_document_response(path: PathBuf) -> LinkActivationResponse {
    LinkActivationResponse {
        kind: LinkActivationResponseKind::OpenDocument,
        block_id: None,
        opened_document: None,
        normalized_url: Some(path.display().to_string()),
        scheme: None,
        host: None,
        label_text: None,
        action_token: None,
        message: None,
    }
}

fn open_default_app_response(path: PathBuf) -> LinkActivationResponse {
    LinkActivationResponse {
        kind: LinkActivationResponseKind::OpenDefaultApp,
        block_id: None,
        opened_document: None,
        normalized_url: Some(path.display().to_string()),
        scheme: None,
        host: None,
        label_text: None,
        action_token: None,
        message: None,
    }
}

fn external_confirmation_response(
    store: &LinkActivationStore,
    doc_id: u64,
    version: u64,
    link_id: &str,
    activation_kind: ActivationKind,
    link: StoredLink,
) -> LinkActivationResponse {
    let (scheme, host) = split_scheme_host(&link.target);
    let token = store.insert_token(PendingExternalOpen {
        doc_id,
        version,
        link_id: link_id.to_string(),
        activation_kind,
        normalized_url: link.target.clone(),
        scheme: scheme.clone(),
        host: host.clone(),
        label_text: link.label_text.clone(),
    });
    LinkActivationResponse {
        kind: LinkActivationResponseKind::ExternalConfirmation,
        block_id: None,
        opened_document: None,
        normalized_url: Some(link.target),
        scheme: Some(scheme),
        host,
        label_text: Some(link.label_text),
        action_token: Some(token),
        message: None,
    }
}

fn denied(message: impl Into<String>) -> LinkActivationResponse {
    LinkActivationResponse {
        kind: LinkActivationResponseKind::Denied,
        block_id: None,
        opened_document: None,
        normalized_url: None,
        scheme: None,
        host: None,
        label_text: None,
        action_token: None,
        message: Some(message.into()),
    }
}

fn resolve_local_target(link: &StoredLink) -> Result<PathBuf, String> {
    let doc_path = link
        .doc_path
        .as_ref()
        .ok_or_else(|| "Save this document before opening relative preview links.".to_string())?;
    let doc_dir = doc_path
        .parent()
        .ok_or_else(|| "Document parent directory is unavailable.".to_string())?;
    let candidate = normalize_path(doc_dir.join(&link.target))?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| format!("Linked target unavailable: {err}"))?;
    let root = doc_dir
        .canonicalize()
        .map_err(|err| format!("Document parent directory is unavailable: {err}"))?;
    if !canonical.starts_with(root) {
        return Err("Preview link blocked: target is outside the document folder.".to_string());
    }
    Ok(canonical)
}

fn open_markdown_from_backend(
    app: &tauri::AppHandle,
    state: &crate::AppState,
    window_label: &str,
    path: &str,
) -> Result<OpenedDoc, String> {
    let path = PathBuf::from(path);
    if !is_markdown_path(&path) {
        return Err("Linked document is not Markdown.".to_string());
    }
    let canon = crate::path_scope::PathScope::canonicalise(&path).map_err(|e| e.to_string())?;
    let canon = state.scope.allow_canonical(&canon);
    let contents = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    let contents_ui = contents.clone();
    let (doc_id, file_state) = state.docs.register(Some(canon.clone()), contents);
    state.watcher.set_target(app.clone(), doc_id, canon.clone());
    let applied = crate::preview::trust_roots::apply_remembered_trust_for_document_global(
        window_label,
        doc_id,
        &canon,
    )?;
    Ok(OpenedDoc {
        doc_id,
        path: canon,
        contents: contents_ui,
        state: file_state,
        trust_context: applied.trust_context,
    })
}

fn classify_target(target: &str) -> LinkKind {
    let lower = target.to_ascii_lowercase();
    if target.starts_with('#') {
        LinkKind::Fragment
    } else if lower.starts_with("mailto:") {
        LinkKind::Mailto
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        LinkKind::ExternalUrl
    } else if has_url_scheme(target) {
        LinkKind::UnknownScheme
    } else if target_without_fragment_or_query(&lower).ends_with(".md")
        || target_without_fragment_or_query(&lower).ends_with(".markdown")
    {
        LinkKind::LocalMarkdown
    } else {
        LinkKind::LocalFile
    }
}

fn target_without_fragment_or_query(target: &str) -> &str {
    let fragment = target.find('#').unwrap_or(target.len());
    let query = target.find('?').unwrap_or(target.len());
    &target[..fragment.min(query)]
}

fn has_url_scheme(target: &str) -> bool {
    let Some(colon) = target.find(':') else {
        return false;
    };
    let scheme = &target[..colon];
    !scheme.is_empty()
        && scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
}

fn split_scheme_host(target: &str) -> (String, Option<String>) {
    let Some((scheme, rest)) = target.split_once(':') else {
        return (String::new(), None);
    };
    let host = rest
        .strip_prefix("//")
        .and_then(|without_slashes| without_slashes.split(['/', '?', '#']).next())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    (scheme.to_ascii_lowercase(), host)
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            matches!(lower.as_str(), "md" | "markdown" | "mdown" | "mkd")
        })
        .unwrap_or(false)
}

fn normalize_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.as_ref().components() {
        match component {
            std::path::Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            std::path::Component::RootDir => normalized.push(component.as_os_str()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    return Err("Path escapes above the document root".to_string());
                }
            }
            std::path::Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}

fn generate_token() -> String {
    static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
    let counter = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let input = format!("{now}:{counter}");
    blake3::hash(input.as_bytes()).to_hex().to_string()
}
