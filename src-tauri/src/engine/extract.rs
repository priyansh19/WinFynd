//! Turn a file into things to embed: windows of text (labelled with the page,
//! slide or sheet they came from) or a downscaled image.

use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;

use base64::Engine as _;

/// Biggest text-ish file read whole; larger ones are indexed by name only.
const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 40 * 1024 * 1024;
/// Roughly 250 tokens per window, with overlap so a sentence split across a
/// boundary still matches.
const WINDOW_CHARS: usize = 1000;
const OVERLAP_CHARS: usize = 150;
const MAX_CHUNKS_PER_FILE: usize = 300;
/// Long side of images sent to the embedder.
const IMAGE_MAX_SIDE: u32 = 896;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Document,
    Slides,
    Spreadsheet,
    Code,
    Image,
    Video,
    Audio,
    Other,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Document => "document",
            Kind::Slides => "slides",
            Kind::Spreadsheet => "spreadsheet",
            Kind::Code => "code",
            Kind::Image => "image",
            Kind::Video => "video",
            Kind::Audio => "audio",
            Kind::Other => "other",
        }
    }
}

pub fn kind_of(path: &Path) -> Kind {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "txt" | "md" | "markdown" | "rst" | "log" | "pdf" | "docx" | "rtf" | "html" | "htm" | "eml" | "odt" => Kind::Document,
        "pptx" => Kind::Slides,
        "xlsx" | "xlsm" | "xls" | "ods" | "csv" | "tsv" => Kind::Spreadsheet,
        "rs" | "py" | "js" | "ts" | "tsx" | "jsx" | "java" | "kt" | "c" | "h" | "cpp" | "hpp" | "cs" | "go" | "rb" | "php"
        | "swift" | "sql" | "sh" | "ps1" | "bat" | "json" | "yaml" | "yml" | "toml" | "ini" | "xml" | "css" | "scss" | "vue"
        | "svelte" | "lua" | "r" | "dart" | "ipynb" => Kind::Code,
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" => Kind::Image,
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "m4v" => Kind::Video,
        "mp3" | "wav" | "m4a" | "flac" | "ogg" | "aac" | "wma" | "opus" => Kind::Audio,
        _ => Kind::Other,
    }
}

pub struct TextChunk {
    pub label: Option<String>,
    pub text: String,
}

pub enum Extracted {
    Text(Vec<TextChunk>),
    /// Base64 PNG/JPEG, ready for the embedder.
    Image(String),
    /// Nothing to read inside; the file is still findable by name.
    NameOnly,
}

pub fn extract(path: &Path, kind: Kind, with_images: bool) -> Extracted {
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    // Parsers for third-party formats can panic on malformed files; a bad
    // file must never take the indexer down.
    let result = std::panic::catch_unwind(|| match kind {
        Kind::Image if with_images && size <= MAX_IMAGE_BYTES => image_b64(path).map(Extracted::Image),
        Kind::Image | Kind::Video | Kind::Audio | Kind::Other => None,
        _ if size > MAX_TEXT_BYTES => None,
        _ => text_chunks(path, kind).map(Extracted::Text),
    });
    match result {
        Ok(Some(Extracted::Text(chunks))) if chunks.is_empty() => Extracted::NameOnly,
        Ok(Some(e)) => e,
        _ => Extracted::NameOnly,
    }
}

fn text_chunks(path: &Path, kind: Kind) -> Option<Vec<TextChunk>> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let sections: Vec<(Option<String>, String)> = match ext.as_str() {
        "pdf" => pdf_extract::extract_text_by_pages(path)
            .ok()?
            .into_iter()
            .enumerate()
            .map(|(i, t)| (Some(format!("Page {}", i + 1)), t))
            .collect(),
        "docx" => vec![(None, office_text(path, |n| n == "word/document.xml", "w:p")?.join("\n"))],
        "odt" => vec![(None, office_text(path, |n| n == "content.xml", "text:p")?.join("\n"))],
        "pptx" => pptx_slides(path)?,
        "xlsx" | "xlsm" | "xls" | "ods" => spreadsheet(path)?,
        "html" | "htm" => vec![(None, strip_tags(&read_lossy(path)?))],
        _ if matches!(kind, Kind::Document | Kind::Code | Kind::Spreadsheet) => vec![(None, read_lossy(path)?)],
        _ => return None,
    };

    let mut out = Vec::new();
    for (label, text) in sections {
        for window in windows(&text) {
            out.push(TextChunk { label: label.clone(), text: window });
            if out.len() >= MAX_CHUNKS_PER_FILE {
                return Some(out);
            }
        }
    }
    Some(out)
}

fn read_lossy(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    // Skip binaries that happen to have a text extension.
    if bytes.iter().take(4096).filter(|b| **b == 0).count() > 8 {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Split into overlapping windows on whitespace, collapsing runs of blank space.
fn windows(text: &str) -> Vec<String> {
    let clean: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = clean.chars().collect();
    if chars.len() < 3 {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + WINDOW_CHARS).min(chars.len());
        if end < chars.len() {
            if let Some(space) = chars[start..end].iter().rposition(|c| *c == ' ') {
                if space > WINDOW_CHARS / 2 {
                    end = start + space;
                }
            }
        }
        out.push(chars[start..end].iter().collect::<String>().trim().to_string());
        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(OVERLAP_CHARS).max(start + 1);
    }
    out
}

/// Text of every `para_tag` element in the matching zip entries, one string per paragraph.
fn office_text(path: &Path, want: impl Fn(&str) -> bool, para_tag: &str) -> Option<Vec<String>> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).ok()?).ok()?;
    let names: Vec<String> = zip.file_names().filter_map(Result::ok).filter(|n| want(n)).map(|n| n.into_owned()).collect();
    let mut paras = Vec::new();
    for name in names {
        let mut xml = String::new();
        zip.by_name(&name).ok()?.read_to_string(&mut xml).ok()?;
        paras.extend(xml_paragraphs(&xml, para_tag));
    }
    Some(paras)
}

fn xml_paragraphs(xml: &str, para_tag: &str) -> Vec<String> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut paras = Vec::new();
    let mut current = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Text(t)) => current.push_str(&t.xml10_content()),
            Ok(Event::GeneralRef(r)) => {
                if let Ok(Some(c)) = r.resolve_char_ref() {
                    current.push(c);
                } else {
                    let name = r.xml10_content();
                    current.push_str(match name.as_ref() {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "quot" => "\"",
                        "apos" => "'",
                        _ => "",
                    });
                }
            }
            Ok(Event::End(e)) if AsRef::<str>::as_ref(&e.name()) == para_tag => {
                if !current.trim().is_empty() {
                    paras.push(std::mem::take(&mut current));
                }
                current.clear();
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    if !current.trim().is_empty() {
        paras.push(current);
    }
    paras
}

fn pptx_slides(path: &Path) -> Option<Vec<(Option<String>, String)>> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).ok()?).ok()?;
    let mut slides: Vec<(usize, String)> = zip
        .file_names()
        .filter_map(Result::ok)
        .filter_map(|n| {
            let num = n.strip_prefix("ppt/slides/slide")?.strip_suffix(".xml")?.parse().ok()?;
            Some((num, n.to_string()))
        })
        .collect();
    slides.sort();
    let mut out = Vec::new();
    for (num, name) in slides {
        let mut xml = String::new();
        zip.by_name(&name).ok()?.read_to_string(&mut xml).ok()?;
        out.push((Some(format!("Slide {num}")), xml_paragraphs(&xml, "a:p").join("\n")));
    }
    Some(out)
}

fn spreadsheet(path: &Path) -> Option<Vec<(Option<String>, String)>> {
    use calamine::Reader;
    let mut book = calamine::open_workbook_auto(path).ok()?;
    let mut out = Vec::new();
    for name in book.sheet_names().to_owned() {
        let Ok(range) = book.worksheet_range(&name) else { continue };
        let text = range
            .rows()
            .take(5000)
            .map(|row| row.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" | "))
            .collect::<Vec<_>>()
            .join("\n");
        out.push((Some(format!("Sheet {name}")), text));
    }
    Some(out)
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn image_b64(path: &Path) -> Option<String> {
    let img = image::open(path).ok()?;
    let img = if img.width().max(img.height()) > IMAGE_MAX_SIDE {
        img.thumbnail(IMAGE_MAX_SIDE, IMAGE_MAX_SIDE)
    } else {
        img
    };
    let mut buf = Cursor::new(Vec::new());
    img.to_rgb8().write_to(&mut buf, image::ImageFormat::Jpeg).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(buf.into_inner()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_overlap_and_cover_everything() {
        let text = "word ".repeat(600);
        let w = windows(&text);
        assert!(w.len() >= 3);
        assert!(w.iter().all(|s| s.chars().count() <= WINDOW_CHARS));
        assert!(w.last().unwrap().ends_with("word"));
    }

    #[test]
    fn short_text_is_one_window() {
        assert_eq!(windows("hello   there\n\nworld"), vec!["hello there world".to_string()]);
    }

    #[test]
    fn docx_paragraphs() {
        let xml = r#"<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>"#;
        assert_eq!(xml_paragraphs(xml, "w:p"), vec!["Hello world", "Second"]);
    }

    #[test]
    fn kinds() {
        assert_eq!(kind_of(Path::new("a/B.PDF")), Kind::Document);
        assert_eq!(kind_of(Path::new("x.pptx")), Kind::Slides);
        assert_eq!(kind_of(Path::new("x.jpeg")), Kind::Image);
        assert_eq!(kind_of(Path::new("x.mp4")), Kind::Video);
    }
}
