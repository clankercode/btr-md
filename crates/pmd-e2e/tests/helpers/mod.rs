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

    pub fn screenshot_to(&self, path: &str) -> Result<()> {
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create screenshot dir {}", parent.display()))?;
        }
        match webdriver_request_with_read_timeout(
            "GET",
            &self.path("screenshot"),
            None,
            Duration::from_secs(5),
        ) {
            Ok(response) => {
                let encoded = response
                    .get("value")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        anyhow!("screenshot response missing base64 value: {response}")
                    })?;
                let png = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .context("decode screenshot png")?;
                std::fs::write(path, png).with_context(|| format!("write screenshot to {path}"))?;
            }
            Err(webdriver_error) => {
                capture_container_screenshot(path).with_context(|| {
                    format!("WebDriver screenshot failed first: {webdriver_error:#}")
                })?;
            }
        }
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

fn capture_container_screenshot(path: &str) -> Result<()> {
    let container_id = std::env::var("PMD_E2E_CONTAINER_ID")
        .context("PMD_E2E_CONTAINER_ID must be set for screenshot fallback")?;
    let container_path = format!("/work/{path}");
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
