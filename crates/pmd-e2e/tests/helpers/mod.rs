//! Shared helpers for pmd-e2e WebDriver tests.

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::Command;
use std::time::{Duration, Instant};

const WEBDRIVER_ADDR: &str = "127.0.0.1:4444";
const APPLICATION_PATH: &str = "/work/target/release/btr-md";

#[allow(dead_code)]
pub struct ProbedApp {
    session: WebDriverSession,
    app_url: String,
}

#[allow(dead_code)]
pub async fn spawn_app_with_network_probe() -> Result<ProbedApp> {
    let session = WebDriverSession::with_args(&["/work/tests/corpus/hello.md"])?;
    session.wait_for_selector(".cm-editor", Duration::from_secs(5))?;
    install_network_probe(&session)?;
    let app_url = session.url()?;
    Ok(ProbedApp { session, app_url })
}

#[allow(dead_code)]
impl ProbedApp {
    pub async fn open_markdown(&self, markdown: &str) -> Result<()> {
        let script = r#"
            const markdown = arguments[0];
            const done = arguments[arguments.length - 1];
            const view = document.querySelector('.cm-editor')?.view
                ?? document.querySelector('.cm-editor')?.cmView?.view;
            if (!view) { done({ ok: false, error: 'no-editor' }); return; }
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: markdown }
            });
            setTimeout(() => done({ ok: true }), 350);
        "#;
        let value = self.session.js_object(script, &[json!(markdown)])?;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(())
        } else {
            Err(anyhow!("open markdown failed: {value}"))
        }
    }

    pub async fn wait_for_text(&self, text: &str) -> Result<()> {
        let needle = text.to_owned();
        self.session
            .wait_for_condition(&format!("text `{text}`"), Duration::from_secs(5), || {
                let source = self.session.source()?;
                Ok(source.contains(&needle))
            })
    }

    pub async fn network_requests(&self) -> Vec<String> {
        read_string_array(&self.session, "window.__pmdNetworkRequests").unwrap_or_default()
    }

    pub async fn image_load_attempts(&self) -> Vec<String> {
        read_string_array(&self.session, "window.__pmdImageLoadAttempts").unwrap_or_default()
    }

    pub async fn external_open_log(&self) -> Vec<String> {
        read_string_array(&self.session, "window.__pmdExternalOpenLog").unwrap_or_default()
    }

    pub async fn new_window_log(&self) -> Vec<String> {
        read_string_array(&self.session, "window.__pmdNewWindowLog").unwrap_or_default()
    }

    pub async fn download_log(&self) -> Vec<String> {
        read_string_array(&self.session, "window.__pmdDownloadLog").unwrap_or_default()
    }

    pub async fn link_activation_log(&self) -> Vec<String> {
        read_string_array(&self.session, "window.__pmdLinkActivationLog").unwrap_or_default()
    }

    pub async fn click_preview_link(&self, label: &str) -> Result<()> {
        self.dispatch_preview_link(label, "click").await
    }

    pub async fn focus_preview_link(&self, label: &str) -> Result<()> {
        self.dispatch_preview_link(label, "focus").await
    }

    pub async fn middle_click_preview_link(&self, label: &str) -> Result<()> {
        self.dispatch_preview_link(label, "auxclick").await
    }

    pub async fn context_menu_preview_link(&self, label: &str) -> Result<()> {
        self.dispatch_preview_link(label, "contextmenu").await
    }

    pub async fn drag_preview_link(&self, label: &str) -> Result<()> {
        self.dispatch_preview_link(label, "dragstart").await
    }

    async fn dispatch_preview_link(&self, label: &str, event_name: &str) -> Result<()> {
        let script = r#"
            const label = arguments[0];
            const eventName = arguments[1];
            const done = arguments[arguments.length - 1];
            const links = Array.from(document.querySelectorAll(
                '[data-pmd-link-id], #preview-pane a, .pmd-preview a'
            ));
            const link = links.find((node) => node.textContent?.trim() === label);
            if (!link) { done({ ok: false, error: 'missing-link' }); return; }
            if (eventName === 'focus') {
                link.focus();
            } else if (eventName === 'dragstart') {
                const dataTransfer = typeof DataTransfer === 'function' ? new DataTransfer() : {
                    types: [],
                    setData(type, value) { this.types.push(type); this[type] = String(value); },
                    getData(type) { return this[type] || ''; },
                };
                const event = typeof DragEvent === 'function'
                    ? new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer })
                    : new Event('dragstart', { bubbles: true, cancelable: true });
                if (!event.dataTransfer) {
                    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
                }
                link.dispatchEvent(event);
            } else {
                const button = eventName === 'auxclick' ? 1 : eventName === 'contextmenu' ? 2 : 0;
                link.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, button }));
            }
            setTimeout(() => done({ ok: true }), 100);
        "#;
        let value = self
            .session
            .js_object(script, &[json!(label), json!(event_name)])?;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(())
        } else {
            Err(anyhow!("dispatch preview link failed: {value}"))
        }
    }

    pub async fn press_key(&self, key: &str) -> Result<()> {
        let script = r#"
            const key = arguments[0];
            const done = arguments[arguments.length - 1];
            const target = document.activeElement?.matches?.('[data-pmd-link-id]')
                ? document.activeElement
                : document.querySelector('[data-pmd-link-id]');
            if (!target) { done({ ok: false, error: 'missing-link' }); return; }
            target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            setTimeout(() => done({ ok: true }), 100);
        "#;
        let value = self.session.js_object(script, &[json!(key)])?;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(())
        } else {
            Err(anyhow!("press key failed: {value}"))
        }
    }

    pub async fn confirm_external_link(&self) -> Result<()> {
        let script = r#"
            const done = arguments[arguments.length - 1];
            const root = document.querySelector('[data-testid="confirm-external-open"]');
            const button = root?.querySelector('[data-action="confirm"]');
            if (!button) { done({ ok: false, error: 'missing-confirm-button' }); return; }
            button.click();
            setTimeout(() => done({ ok: true }), 100);
        "#;
        let value = self.session.js_object(script, &[])?;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(())
        } else {
            Err(anyhow!("confirm external link failed: {value}"))
        }
    }

    pub async fn current_webview_url(&self) -> Result<String> {
        self.session.url()
    }

    pub async fn force_document_navigation_attempt_for_test(&self, url: &str) -> Result<()> {
        let script = r#"
            const url = arguments[0];
            const done = arguments[arguments.length - 1];
            window.location.assign(url);
            setTimeout(() => done({ ok: true }), 150);
        "#;
        let value = self.session.js_object(script, &[json!(url)])?;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(())
        } else {
            Err(anyhow!("force navigation failed: {value}"))
        }
    }

    pub async fn force_new_window_attempt_for_test(&self, url: &str) -> Result<bool> {
        let handles_before = self.session.window_handles()?;
        let script = r#"
            const url = arguments[0];
            const done = arguments[arguments.length - 1];
            const opened = window.open(url, '_blank', 'noopener');
            setTimeout(() => done({ ok: true, opened: Boolean(opened && !opened.closed) }), 150);
        "#;
        let value = self.session.js_object(script, &[json!(url)])?;
        if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            return Err(anyhow!("force new window failed: {value}"));
        }
        let handles_after = self.session.window_handles()?;
        Ok(value
            .get("opened")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || handles_after.len() > handles_before.len())
    }

    pub async fn force_download_attempt_for_test(&self, url: &str) -> Result<bool> {
        let before = self.current_webview_url().await?;
        let script = r#"
            const url = arguments[0];
            const done = arguments[arguments.length - 1];
            const link = document.createElement('a');
            link.href = url;
            link.download = 'payload.txt';
            link.textContent = 'download';
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => done({ ok: true, href: window.location.href }), 150);
        "#;
        let value = self.session.js_object(script, &[json!(url)])?;
        if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            return Err(anyhow!("force download failed: {value}"));
        }
        Ok(value.get("href").and_then(Value::as_str) != Some(before.as_str()))
    }

    pub async fn wait_for_download_denied(&self, url: &str) -> Result<()> {
        let needle = url.to_owned();
        self.session
            .wait_for_condition("download deny event", Duration::from_secs(5), || {
                Ok(read_string_array(&self.session, "window.__pmdDownloadLog")
                    .unwrap_or_default()
                    .iter()
                    .any(|entry| entry == &needle))
            })
    }

    pub fn app_url(&self) -> String {
        self.app_url.clone()
    }
}

impl Drop for ProbedApp {
    fn drop(&mut self) {
        let _ = webdriver_request("DELETE", &format!("/session/{}", self.session.id), None);
    }
}

fn install_network_probe(session: &WebDriverSession) -> Result<()> {
    let script = r#"
        const done = arguments[arguments.length - 1];
        if (window.__pmdProbeInstalled) { done(true); return; }
        window.__pmdProbeInstalled = true;
        window.__pmdE2e = true;
        window.__pmdNetworkRequests = [];
        window.__pmdImageLoadAttempts = [];
        window.__pmdExternalOpenLog = [];
        window.__pmdNewWindowLog = [];
        window.__pmdDownloadLog = [];
        window.__pmdLinkActivationLog = [];

        const originalFetch = window.fetch?.bind(window);
        if (originalFetch) {
            window.fetch = (input, init) => {
                const url = typeof input === 'string' ? input : input?.url;
                if (url) window.__pmdNetworkRequests.push(String(url));
                return originalFetch(input, init);
            };
        }

        const originalSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') {
                window.__pmdImageLoadAttempts.push(String(value));
            }
            return originalSetAttribute.call(this, name, value);
        };

        const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        if (src?.set) {
            Object.defineProperty(HTMLImageElement.prototype, 'src', {
                configurable: true,
                get: src.get,
                set(value) {
                    window.__pmdImageLoadAttempts.push(String(value));
                    return src.set.call(this, value);
                },
            });
        }

        const observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    const images = node instanceof HTMLImageElement
                        ? [node]
                        : Array.from(node.querySelectorAll('img'));
                    for (const img of images) {
                        const value = img.getAttribute('src') || img.currentSrc || '';
                        if (value) window.__pmdImageLoadAttempts.push(value);
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        const originalOpen = window.open?.bind(window);
        if (originalOpen) {
            window.open = (url, target, features) => {
                if (url) window.__pmdNewWindowLog.push(String(url));
                return originalOpen(url, target, features);
            };
        }

        document.addEventListener('pmd-link-activation', (event) => {
            const kind = event.detail?.activationKind;
            if (kind) window.__pmdLinkActivationLog.push(String(kind));
        });

        document.addEventListener('pmd-external-open', (event) => {
            const url = event.detail?.url;
            if (url) window.__pmdExternalOpenLog.push(String(url));
        });

        document.addEventListener('pmd-download-denied', (event) => {
            const url = event.detail?.url;
            if (url) window.__pmdDownloadLog.push(String(url));
        });
        done(true);
    "#;
    session.execute_script(script, &[])?;
    Ok(())
}

fn read_string_array(session: &WebDriverSession, expression: &str) -> Result<Vec<String>> {
    let script = r#"
        const expression = arguments[0];
        const done = arguments[arguments.length - 1];
        const value = Function(`return (${expression})`)();
        done(Array.isArray(value) ? value : []);
    "#;
    let value = session.execute_script(script, &[json!(expression)])?;
    let array = value
        .as_array()
        .ok_or_else(|| anyhow!("script did not return array: {value}"))?;
    Ok(array
        .iter()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect())
}

#[allow(dead_code)]
pub struct WebDriverSession {
    pub id: String,
}

#[allow(dead_code)]
impl WebDriverSession {
    pub fn new() -> Result<Self> {
        Self::with_args(&[])
    }

    pub fn with_args(args: &[&str]) -> Result<Self> {
        let mut tauri_opts = serde_json::Map::new();
        tauri_opts.insert(
            "application".to_string(),
            serde_json::Value::String(APPLICATION_PATH.to_string()),
        );
        if !args.is_empty() {
            tauri_opts.insert(
                "args".to_string(),
                serde_json::Value::Array(
                    args.iter()
                        .map(|s| serde_json::Value::String(s.to_string()))
                        .collect(),
                ),
            );
        }
        let payload = json!({
            "capabilities": {
                "alwaysMatch": {
                    "tauri:options": serde_json::Value::Object(tauri_opts)
                }
            }
        });
        let response = webdriver_request("POST", "/session", Some(&payload))?;
        let id = response
            .pointer("/value/sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                anyhow!("WebDriver new session response missing sessionId: {response}")
            })?;
        Ok(Self { id: id.to_owned() })
    }

    pub fn source(&self) -> Result<String> {
        self.string_value("GET", "source", None)
    }

    pub fn url(&self) -> Result<String> {
        self.string_value("GET", "url", None)
    }

    pub fn title(&self) -> Result<String> {
        self.string_value("GET", "title", None)
    }

    pub fn window_handles(&self) -> Result<Vec<String>> {
        let response = webdriver_request("GET", &self.path("window/handles"), None)?;
        let value = response
            .get("value")
            .and_then(Value::as_array)
            .ok_or_else(|| anyhow!("window handles response missing array value: {response}"))?;
        Ok(value
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect())
    }

    pub fn screenshot_to(&self, path: &str) -> Result<()> {
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create screenshot dir {}", parent.display()))?;
        }

        // CI WebDriver screenshot can flake with EAGAIN; retry before ImageMagick fallback.
        const ATTEMPTS: u32 = 3;
        let mut last_error: Option<anyhow::Error> = None;
        for attempt in 1..=ATTEMPTS {
            match webdriver_request_with_read_timeout(
                "GET",
                &self.path("screenshot"),
                None,
                Duration::from_secs(10),
            ) {
                Ok(response) => match write_webdriver_screenshot_png(path, &response) {
                    Ok(()) => return Ok(()),
                    Err(err) => last_error = Some(err),
                },
                Err(err) => last_error = Some(err),
            }
            if attempt < ATTEMPTS {
                std::thread::sleep(Duration::from_millis(250 * u64::from(attempt)));
            }
        }

        let webdriver_error =
            last_error.unwrap_or_else(|| anyhow!("unknown WebDriver screenshot failure"));
        capture_container_screenshot(path).with_context(|| {
            format!("WebDriver screenshot failed after {ATTEMPTS} attempts: {webdriver_error:#}")
        })?;
        Ok(())
    }

    pub fn fetch_csp(&self) -> Result<String> {
        let script = r#"
            const done = arguments[arguments.length - 1];
            (async () => {
                try {
                    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
                    if (meta && meta.content) {
                        return { source: 'meta', csp: meta.content };
                    }
                    if (typeof window.__TAURI_CSP__ === 'string' && window.__TAURI_CSP__.length > 0) {
                        return { source: 'window.__TAURI_CSP__', csp: window.__TAURI_CSP__ };
                    }
                    const res = await fetch(location.href, { method: 'GET', cache: 'no-store' });
                    const header = res.headers.get('content-security-policy');
                    if (header) {
                        return { source: 'response-header', csp: header };
                    }
                    return { source: 'none', csp: '' };
                } catch (err) {
                    return { source: 'error', csp: '', error: String(err) };
                }
            })().then(done);
        "#;
        let payload = json!({ "script": script, "args": [] });
        let response = webdriver_request("POST", &self.path("execute/async"), Some(&payload))?;
        let value = response
            .get("value")
            .ok_or_else(|| anyhow!("CSP script response missing value: {response}"))?;
        let source = value
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let csp = value
            .get("csp")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        if csp.is_empty() {
            let detail = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("no CSP in meta, window.__TAURI_CSP__, or response headers");
            return Err(anyhow!(
                "could not resolve Content-Security-Policy (source={source}): {detail}"
            ));
        }
        eprintln!("[pmd-e2e] CSP resolved via {source}");
        Ok(csp)
    }

    pub fn close(self) -> Result<()> {
        webdriver_request("DELETE", &self.path(""), None)?;
        Ok(())
    }

    pub fn execute_script(&self, script: &str, args: &[Value]) -> Result<Value> {
        let payload = json!({ "script": script, "args": args });
        let response = webdriver_request("POST", &self.path("execute/async"), Some(&payload))?;
        response
            .get("value")
            .ok_or_else(|| anyhow!("execute script response missing value: {response}"))
            .cloned()
    }

    pub fn js_object(&self, script: &str, args: &[Value]) -> Result<Value> {
        let value = self.execute_script(script, args)?;
        match value {
            Value::Object(_) => Ok(value),
            Value::String(text) => {
                let parsed: Value = serde_json::from_str(&text)
                    .with_context(|| format!("parse script result as JSON object: {text}"))?;
                if parsed.is_object() {
                    Ok(parsed)
                } else {
                    Err(anyhow!("script result JSON was not an object: {parsed}"))
                }
            }
            other => Err(anyhow!("script result was not an object: {other}")),
        }
    }

    pub fn wait_for_condition<F>(
        &self,
        description: &str,
        timeout: Duration,
        mut condition: F,
    ) -> Result<()>
    where
        F: FnMut() -> Result<bool>,
    {
        let started = Instant::now();
        let mut last_error = None;
        while started.elapsed() <= timeout {
            match condition() {
                Ok(true) => return Ok(()),
                Ok(false) => last_error = None,
                Err(err) => last_error = Some(err),
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        if let Some(err) = last_error {
            Err(anyhow!(
                "timed out waiting for {description}; last error: {err:#}"
            ))
        } else {
            Err(anyhow!("timed out waiting for {description}"))
        }
    }

    pub fn wait_for_selector(&self, selector: &str, timeout: Duration) -> Result<()> {
        let script = r#"
            const selector = arguments[0];
            const done = arguments[arguments.length - 1];
            done(Boolean(document.querySelector(selector)));
        "#;
        self.wait_for_condition(&format!("selector `{selector}`"), timeout, || {
            let found = self.execute_script(script, &[json!(selector)])?;
            Ok(found.as_bool().unwrap_or(false))
        })
    }

    fn path(&self, suffix: &str) -> String {
        if suffix.is_empty() {
            format!("/session/{}", self.id)
        } else {
            format!("/session/{}/{}", self.id, suffix)
        }
    }

    fn string_value(&self, method: &str, suffix: &str, payload: Option<&Value>) -> Result<String> {
        let response = webdriver_request(method, &self.path(suffix), payload)?;
        response
            .get("value")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| {
                anyhow!("WebDriver `{suffix}` response missing string value: {response}")
            })
    }
}

fn webdriver_request(method: &str, path: &str, payload: Option<&Value>) -> Result<Value> {
    webdriver_request_with_read_timeout(method, path, payload, Duration::from_secs(15))
}

fn webdriver_request_with_read_timeout(
    method: &str,
    path: &str,
    payload: Option<&Value>,
    read_timeout: Duration,
) -> Result<Value> {
    let body = payload.map(Value::to_string).unwrap_or_default();
    let mut stream = TcpStream::connect(WEBDRIVER_ADDR)
        .with_context(|| format!("connect WebDriver at {WEBDRIVER_ADDR}"))?;
    stream
        .set_read_timeout(Some(read_timeout))
        .context("set WebDriver read timeout")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .context("set WebDriver write timeout")?;

    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: {WEBDRIVER_ADDR}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
    .with_context(|| format!("write WebDriver request {method} {path}"))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .with_context(|| format!("read WebDriver response {method} {path}"))?;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| anyhow!("malformed WebDriver HTTP response: {response:?}"))?;
    let status = head.lines().next().unwrap_or_default();
    if !status.contains(" 200 ") {
        return Err(anyhow!(
            "WebDriver {method} {path} failed with {status}: {body}"
        ));
    }
    serde_json::from_str(body)
        .with_context(|| format!("parse WebDriver JSON response for {method} {path}: {body}"))
}

fn write_webdriver_screenshot_png(path: &str, response: &Value) -> Result<()> {
    let encoded = response
        .get("value")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("screenshot response missing base64 value: {response}"))?;
    let png = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .context("decode screenshot png")?;
    std::fs::write(path, png).with_context(|| format!("write screenshot to {path}"))?;
    Ok(())
}

fn capture_container_screenshot(path: &str) -> Result<()> {
    let container_id = std::env::var("PMD_E2E_CONTAINER_ID")
        .context("PMD_E2E_CONTAINER_ID must be set for screenshot fallback")?;
    let container_path = format!("/work/{path}");
    if let Some(parent) = std::path::Path::new(path).parent() {
        let container_parent = format!("/work/{}", parent.display());
        let mkdir = Command::new("docker")
            .args(["exec", &container_id, "mkdir", "-p", &container_parent])
            .output()
            .context("create screenshot dir inside e2e container")?;
        if !mkdir.status.success() {
            return Err(anyhow!(
                "mkdir -p {container_parent} in container failed (status {:?}): {}",
                mkdir.status.code(),
                String::from_utf8_lossy(&mkdir.stderr)
            ));
        }
    }
    let output = Command::new("docker")
        .args([
            "exec",
            "-e",
            "DISPLAY=:99",
            &container_id,
            "import",
            "-window",
            "root",
            &container_path,
        ])
        .output()
        .context("run ImageMagick screenshot fallback in e2e container")?;
    if !output.status.success() {
        return Err(anyhow!(
            "container screenshot fallback failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}
