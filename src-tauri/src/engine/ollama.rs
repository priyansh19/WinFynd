//! Client for the local Ollama server, which runs EmbeddingGemma 2 and the
//! Ask-mode chat model on this PC. Only loopback addresses are allowed.

use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone)]
pub struct Ollama {
    base: String,
    http: reqwest::blocking::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledModel {
    pub name: String,
    #[serde(default)]
    pub size: u64,
}

/// One thing to embed. EmbeddingGemma 2 puts text and images in one space.
pub enum EmbedInput {
    Query(String),
    Document { title: String, text: String },
    /// Base64-encoded JPEG or PNG.
    Image(String),
}

impl EmbedInput {
    fn to_json(&self) -> Value {
        // Prompt formats from the EmbeddingGemma 2 model card; media takes no prefix.
        match self {
            EmbedInput::Query(q) => json!(format!("task: search result | query: {q}")),
            EmbedInput::Document { title, text } => json!(format!("title: {title} | text: {text}")),
            EmbedInput::Image(b64) => json!({ "image": b64 }),
        }
    }
}

impl Ollama {
    pub fn new(base: &str) -> Result<Self, String> {
        let url = reqwest::Url::parse(base).map_err(|e| format!("Bad Ollama address: {e}"))?;
        let loopback = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("[::1]") | Some("::1"));
        if !loopback {
            return Err("WinFynd only talks to an Ollama server on this PC (127.0.0.1)".into());
        }
        let http = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { base: base.trim_end_matches('/').to_string(), http })
    }

    pub fn models(&self) -> Result<Vec<InstalledModel>, String> {
        #[derive(Deserialize)]
        struct Tags {
            models: Vec<InstalledModel>,
        }
        let tags: Tags = self
            .http
            .get(format!("{}/api/tags", self.base))
            .timeout(Duration::from_secs(5))
            .send()
            .map_err(|_| "Ollama isn't running. Install it from ollama.com and start it.".to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;
        Ok(tags.models)
    }

    /// Unit-length vectors, one per input.
    pub fn embed(&self, model: &str, inputs: &[EmbedInput], dimensions: usize) -> Result<Vec<Vec<f32>>, String> {
        #[derive(Deserialize)]
        struct Resp {
            embeddings: Vec<Vec<f32>>,
        }
        let body = json!({
            "model": model,
            "input": inputs.iter().map(EmbedInput::to_json).collect::<Vec<_>>(),
            "dimensions": dimensions,
            "truncate": true,
            "keep_alive": "10m",
        });
        let resp = self
            .http
            .post(format!("{}/api/embed", self.base))
            .json(&body)
            .send()
            .map_err(|e| format!("Ollama embed failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().unwrap_or_default();
            return Err(format!("Ollama embed failed ({status}): {text}"));
        }
        let parsed: Resp = resp.json().map_err(|e| e.to_string())?;
        if parsed.embeddings.len() != inputs.len() {
            return Err("Ollama returned the wrong number of embeddings".into());
        }
        Ok(parsed.embeddings.into_iter().map(|v| normalize(truncate(v, dimensions))).collect())
    }

    pub fn chat(&self, model: &str, system: &str, user: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct Msg {
            content: String,
        }
        #[derive(Deserialize)]
        struct Resp {
            message: Msg,
        }
        let body = json!({
            "model": model,
            "stream": false,
            "keep_alive": "10m",
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
        });
        let resp: Resp = self
            .http
            .post(format!("{}/api/chat", self.base))
            .json(&body)
            .send()
            .map_err(|e| format!("Ollama chat failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Ollama chat failed: {e}"))?
            .json()
            .map_err(|e| e.to_string())?;
        Ok(resp.message.content)
    }

    /// Download a model into Ollama, reporting (completed, total) bytes.
    pub fn pull(&self, model: &str, mut progress: impl FnMut(String, u64, u64)) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/pull", self.base))
            .timeout(Duration::from_secs(6 * 3600))
            .json(&json!({ "model": model, "stream": true }))
            .send()
            .map_err(|e| format!("Ollama pull failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Ollama pull failed: {e}"))?;
        for line in BufReader::new(resp).lines() {
            let line = line.map_err(|e| e.to_string())?;
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if let Some(err) = v.get("error").and_then(Value::as_str) {
                return Err(err.to_string());
            }
            let status = v.get("status").and_then(Value::as_str).unwrap_or("").to_string();
            let total = v.get("total").and_then(Value::as_u64).unwrap_or(0);
            let done = v.get("completed").and_then(Value::as_u64).unwrap_or(0);
            progress(status, done, total);
        }
        Ok(())
    }
}

fn truncate(mut v: Vec<f32>, dims: usize) -> Vec<f32> {
    v.truncate(dims);
    v
}

/// Matryoshka truncation needs re-normalizing; doing it always makes dot
/// product equal cosine similarity.
pub fn normalize(mut v: Vec<f32>) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
    v
}

/// True when an installed model name refers to `wanted` (with or without a tag).
pub fn has_model(installed: &[InstalledModel], wanted: &str) -> bool {
    let base = |n: &str| n.split(':').next().unwrap_or(n).to_string();
    installed.iter().any(|m| {
        m.name == wanted || (!wanted.contains(':') && base(&m.name) == wanted) || m.name == format!("{wanted}:latest")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_loopback() {
        assert!(Ollama::new("http://example.com:11434").is_err());
        assert!(Ollama::new("http://127.0.0.1:11434").is_ok());
        assert!(Ollama::new("http://localhost:11434").is_ok());
    }

    #[test]
    fn normalizes_after_truncation() {
        let v = normalize(truncate(vec![3.0, 4.0, 12.0], 2));
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn model_matching() {
        let m = vec![InstalledModel { name: "embeddinggemma-2:latest".into(), size: 0 }];
        assert!(has_model(&m, "embeddinggemma-2"));
        assert!(!has_model(&m, "embeddinggemma-2:270m"));
    }
}
