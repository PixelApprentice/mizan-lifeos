// Team hosting over HTTP on the local network, and the small client replicas use to reach a
// host. Plain HTTP/1.1 with JSON bodies, so the phone page can talk to it with fetch().
//
//   GET  /team/v1/ping                       who is this (no auth)
//   POST /team/v1/join                       redeem an invite → member id + token
//   GET  /team/v1/ws/:id/pull?after=N        rows and ops after seq N
//   POST /team/v1/ws/:id/ops                 push ops → accepted / rejected
//   POST /team/v1/ws/:id/invites             new invite (owners and admins)

use super::store;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server};

const MAX_BODY: u64 = 8 * 1024 * 1024;
const MAX_RESPONSE: usize = 64 * 1024 * 1024;
/// A misbehaving device on the LAN must not be able to exhaust threads or memory on the host.
const MAX_IN_FLIGHT: usize = 32;
static IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);
struct Slot;
impl Drop for Slot {
    fn drop(&mut self) {
        IN_FLIGHT.fetch_sub(1, Ordering::SeqCst);
    }
}

static RUNNING: Mutex<Option<(Arc<Server>, u16)>> = Mutex::new(None);

pub fn running_port() -> Option<u16> {
    RUNNING.lock().ok().and_then(|r| r.as_ref().map(|(_, port)| *port))
}

pub fn stop() {
    if let Ok(mut running) = RUNNING.lock() {
        if let Some((server, _)) = running.take() {
            server.unblock();
        }
    }
}

pub fn start(port: u16) -> Result<(), String> {
    stop();
    let server = Arc::new(Server::http(("0.0.0.0", port)).map_err(|e| format!("Cannot listen on port {port}: {e}"))?);
    let worker = server.clone();
    std::thread::Builder::new()
        .name("mizan-team-host".into())
        .spawn(move || {
            for request in worker.incoming_requests() {
                if IN_FLIGHT.fetch_add(1, Ordering::SeqCst) >= MAX_IN_FLIGHT {
                    IN_FLIGHT.fetch_sub(1, Ordering::SeqCst);
                    respond(request, 503, json!({ "error": "Host is busy; try again in a moment." }));
                    continue;
                }
                // Released when the thread ends, even by panic, or when spawning fails.
                let slot = Slot;
                let _ = std::thread::Builder::new().spawn(move || {
                    let _slot = slot;
                    handle(request);
                });
            }
        })
        .map_err(|e| e.to_string())?;
    *RUNNING.lock().map_err(|e| e.to_string())? = Some((server, port));
    Ok(())
}

fn respond(request: Request, code: u16, value: Value) {
    let mut response = Response::from_data(value.to_string().into_bytes()).with_status_code(code);
    for (name, value) in [
        ("Content-Type", "application/json"),
        ("Cache-Control", "no-store"),
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Headers", "content-type, authorization"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Private-Network", "true"),
        ("X-Content-Type-Options", "nosniff"),
    ] {
        if let Ok(h) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(h);
        }
    }
    let _ = request.respond(response);
}

fn bearer(request: &Request) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv("authorization"))
        .and_then(|h| h.value.as_str().strip_prefix("Bearer ").map(|t| t.trim().to_string()))
}

fn body(request: &mut Request) -> Result<Value, String> {
    let mut text = String::new();
    request.as_reader().take(MAX_BODY).read_to_string(&mut text).map_err(|e| format!("Cannot read request: {e}"))?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {e}"))
}

fn after_param(url: &str) -> i64 {
    url.split_once('?')
        .and_then(|(_, q)| q.split('&').find_map(|p| p.strip_prefix("after=")))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn handle(mut request: Request) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("/").to_string();
    if method == Method::Options {
        return respond(request, 204, json!({}));
    }
    if (&method, path.as_str()) == (&Method::Get, "/team/v1/ping") {
        return respond(request, 200, json!({ "app": "mizan-team", "protocol": store::PROTOCOL, "version": env!("CARGO_PKG_VERSION") }));
    }
    let payload = if method == Method::Post { body(&mut request) } else { Ok(json!({})) };
    let payload = match payload {
        Ok(p) => p,
        Err(error) => return respond(request, 400, json!({ "error": error })),
    };
    if (&method, path.as_str()) == (&Method::Post, "/team/v1/join") {
        let result = tauri::async_runtime::block_on(join(&payload));
        return match result {
            Ok(value) => respond(request, 200, value),
            Err(error) => respond(request, 400, json!({ "error": error })),
        };
    }
    let Some(rest) = path.strip_prefix("/team/v1/ws/") else {
        return respond(request, 404, json!({ "error": "Not found." }));
    };
    let (ws, action) = rest.split_once('/').unwrap_or((rest, ""));
    let Some(token) = bearer(&request) else {
        return respond(request, 401, json!({ "error": "Sign-in token missing." }));
    };
    let ws = ws.to_string();
    let result = tauri::async_runtime::block_on(async {
        let pool = super::hosted_pool(&ws).await.map_err(|e| (404, e))?;
        let auth = store::authenticate(&pool, &token).await.ok_or((401, "Your access to this workspace was removed or the token is out of date. Ask for a new invite.".to_string()))?;
        match (&method, action) {
            (Method::Get, "pull") => {
                let mut value = store::pull(&pool, after_param(&url)).await.map_err(|e| (500, e))?;
                value["me"] = json!(auth.member);
                value["role"] = json!(auth.role);
                Ok(value)
            }
            (Method::Post, "ops") => {
                let ops: Vec<store::Op> = payload["ops"].as_array().into_iter().flatten().take(500).filter_map(|o| serde_json::from_value(o.clone()).ok()).collect();
                let result = store::host_apply(&pool, &auth.member, &auth.role, ops, false).await.map_err(|e| (500, e))?;
                if !result.accepted.is_empty() {
                    super::changed(&ws);
                }
                serde_json::to_value(result).map_err(|e| (500, e.to_string()))
            }
            (Method::Post, "invites") => {
                let role = payload["role"].as_str().unwrap_or("member");
                let code = store::create_invite(&pool, role, &auth.member, &auth.role).await.map_err(|e| (403, e))?;
                Ok(json!({ "code": code }))
            }
            _ => Err((404, "Not found.".to_string())),
        }
    });
    match result {
        Ok(value) => respond(request, 200, value),
        Err((code, error)) => respond(request, code, json!({ "error": error })),
    }
}

async fn join(payload: &Value) -> Result<Value, String> {
    let ws = payload["ws"].as_str().ok_or("Missing workspace.")?;
    let code = payload["code"].as_str().ok_or("Missing invite code.")?;
    let pool = super::hosted_pool(ws).await?;
    let (member, token, role) = store::redeem_invite(&pool, code, payload["name"].as_str().unwrap_or_default(), payload["device"].as_str().unwrap_or("device")).await?;
    super::changed(ws);
    let name = store::row(&pool, "workspace", "ws").await.and_then(|w| w["name"].as_str().map(String::from)).unwrap_or_default();
    Ok(json!({ "ws": ws, "name": name, "member": member, "token": token, "role": role, "protocol": store::PROTOCOL }))
}

// ---------------- client ----------------

/// One HTTP request to a host (`base` like `http://192.168.1.5:47616`).
pub fn request(base: &str, method: &str, path: &str, token: Option<&str>, body: Option<&Value>, timeout: Duration) -> Result<Value, (u16, String)> {
    let hostport = base.strip_prefix("http://").ok_or((0, "Only http:// hosts are supported.".to_string()))?.trim_end_matches('/');
    let addr: SocketAddr = hostport
        .to_socket_addrs()
        .map_err(|e| (0, e.to_string()))?
        .next()
        .ok_or((0, "Unknown host.".to_string()))?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout.min(Duration::from_secs(4))).map_err(|e| (0, format!("Cannot reach {hostport}: {e}")))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let payload = body.map(Value::to_string).unwrap_or_default();
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {hostport}\r\nConnection: close\r\nAccept: application/json\r\nContent-Length: {}\r\n", payload.len());
    if body.is_some() {
        head.push_str("Content-Type: application/json\r\n");
    }
    if let Some(token) = token {
        head.push_str(&format!("Authorization: Bearer {token}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(payload.as_bytes())).map_err(|e| (0, e.to_string()))?;
    let mut raw = Vec::new();
    stream.take(MAX_RESPONSE as u64).read_to_end(&mut raw).map_err(|e| (0, e.to_string()))?;
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or((0, "Bad response from host.".to_string()))?;
    let headers = String::from_utf8_lossy(&raw[..split]).to_string();
    let mut content = raw[split + 4..].to_vec();
    let status: u16 = headers.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    if headers.lines().any(|l| l.to_ascii_lowercase().starts_with("transfer-encoding:") && l.to_ascii_lowercase().contains("chunked")) {
        content = dechunk(&content);
    }
    let value: Value = serde_json::from_slice(&content).unwrap_or_else(|_| json!({ "error": String::from_utf8_lossy(&content).chars().take(200).collect::<String>() }));
    if (200..300).contains(&status) {
        Ok(value)
    } else {
        Err((status, value["error"].as_str().unwrap_or("The host refused the request.").to_string()))
    }
}

fn dechunk(mut data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(line_end) = data.windows(2).position(|w| w == b"\r\n") {
        let size = usize::from_str_radix(String::from_utf8_lossy(&data[..line_end]).split(';').next().unwrap_or("0").trim(), 16).unwrap_or(0);
        if size == 0 || data.len() < line_end + 2 + size {
            break;
        }
        out.extend_from_slice(&data[line_end + 2..line_end + 2 + size]);
        data = &data[(line_end + 4 + size).min(data.len())..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dechunks_bodies() {
        assert_eq!(dechunk(b"4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n"), b"Wikipedia");
        assert_eq!(after_param("/team/v1/ws/x/pull?after=42"), 42);
        assert_eq!(after_param("/team/v1/ws/x/pull"), 0);
    }
}
