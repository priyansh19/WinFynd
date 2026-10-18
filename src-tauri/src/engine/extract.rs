//! Turn a file into things to embed: windows of text (labelled with the page,
//! slide or sheet they came from) or a downscaled image.

use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;

use base64::Engine as _;

/// Biggest text-ish file read whole; larger ones are indexed by name only.
const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 40 * 1024 * 1024;
/// Chunks aim for about 250 tokens: big enough to hold a whole idea with its
/// context, small enough that one chunk is about one thing. Much smaller
/// chunks double the index and give long files more chances to win a
/// search on volume alone. They end on a sentence (or line, for code and
/// tables) and never run past the hard limit.
pub(crate) const TARGET_CHARS: usize = 1000;
const MAX_CHARS: usize = 1500;
/// A chunk ends early at a paragraph break or heading once it's this long.
const MIN_CHARS: usize = 300;
/// The last sentence of a chunk is repeated at the start of the next when
/// it's this short or shorter, so an idea split across a boundary still matches.
const OVERLAP_CHARS: usize = 200;
/// Longer files are sampled evenly across their length rather than cut off.
const MAX_CHUNKS_PER_FILE: usize = 300;
/// Code lines longer than this on average mean minified or generated output.
const MINIFIED_LINE_CHARS: usize = 400;
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
    /// A picture: base64 PNG/JPEG for the embedder (None when pictures
    /// aren't embedded), and any text read from it.
    Image { b64: Option<String>, text: Vec<TextChunk> },
    /// Nothing to read inside; the file is still findable by name.
    NameOnly,
    /// Audio or video: what's said, as timed text, and sampled frames as
    /// (timestamp, base64 JPEG). The file is findable by name as well.
    Media { transcript: Vec<TextChunk>, frames: Vec<(String, String)> },
}

pub fn extract(path: &Path, kind: Kind, with_images: bool) -> Extracted {
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    // Parsers for third-party formats can panic on malformed files; a bad
    // file must never take the indexer down.
    let result = std::panic::catch_unwind(|| match kind {
        Kind::Image if size <= MAX_IMAGE_BYTES => {
            let b64 = if with_images { image_b64(path) } else { None };
            let text: Vec<TextChunk> = super::ocr::read(path)
                .map(|t| chunk_text(&t, true).into_iter().map(|text| TextChunk { label: None, text }).collect())
                .unwrap_or_default();
            (b64.is_some() || !text.is_empty()).then_some(Extracted::Image { b64, text })
        }
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
        // Blank lines between paragraphs, so chunks can end where they do.
        "docx" => vec![(None, office_text(path, |n| n == "word/document.xml", "w:p")?.join("\n\n"))],
        "odt" => vec![(None, office_text(path, |n| n == "content.xml", "text:p")?.join("\n\n"))],
        "pptx" => pptx_slides(path)?,
        "xlsx" | "xlsm" | "xls" | "ods" => spreadsheet(path)?,
        "html" | "htm" => vec![(None, strip_tags(&read_lossy(path)?))],
        _ if matches!(kind, Kind::Document | Kind::Code | Kind::Spreadsheet) => vec![(None, read_lossy(path)?)],
        _ => return None,
    };

    if kind == Kind::Code && is_minified(path, &sections) {
        return None;
    }
    let prose = matches!(kind, Kind::Document | Kind::Slides);
    let mut out = Vec::new();
    for (label, text) in sections {
        for window in chunk_text(&text, prose) {
            out.push(TextChunk { label: label.clone(), text: window });
        }
    }
    Some(sample_evenly(out, MAX_CHUNKS_PER_FILE))
}

/// At most `max` items, spread evenly from first to last.
fn sample_evenly<T>(items: Vec<T>, max: usize) -> Vec<T> {
    let n = items.len();
    if n <= max {
        return items;
    }
    items.into_iter().enumerate().filter(|(i, _)| (i * max) % n < max).map(|(_, c)| c).take(max).collect()
}

fn is_minified(path: &Path, sections: &[(Option<String>, String)]) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if name.contains(".min.") || name.ends_with(".map") || name.ends_with(".lock") || name.ends_with("-lock.json") {
        return true;
    }
    let (chars, lines) = sections.iter().fold((0, 0), |(c, l), (_, t)| (c + t.len(), l + t.lines().count().max(1)));
    lines > 0 && chars / lines > MINIFIED_LINE_CHARS
}

/// Files whose text is worth finding by exact words but whose chunks say
/// little to an embedding model (logs, data and config); they get a file
/// card vector only, which keeps them from crowding out real documents.
pub fn keyword_only(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "log" | "json" | "csv" | "tsv" | "xml" | "yaml" | "yml" | "toml" | "ini" | "sql" | "ipynb")
}

fn read_lossy(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    // Skip binaries that happen to have a text extension.
    if bytes.iter().take(4096).filter(|b| **b == 0).count() > 8 {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Split text into small chunks that end on sentence (prose) or line (code,
/// tables) boundaries, prefer to end at paragraph breaks, and carry a short
/// last sentence over into the next chunk.
pub(crate) fn chunk_text(text: &str, prose: bool) -> Vec<String> {
    let units = units(text, prose);
    let sep = if prose { " " } else { "\n" };
    let mut out: Vec<String> = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    let mut len = 0;
    let mut fresh = 0; // units in `cur` not already in the previous chunk
    let flush = |cur: &mut Vec<&str>, len: &mut usize, fresh: &mut usize, out: &mut Vec<String>| {
        if *fresh > 0 {
            out.push(cur.join(sep));
        }
        let carry = match cur.last() {
            Some(last) if cur.len() > 1 && last.chars().count() <= OVERLAP_CHARS => Some(*last),
            _ => None,
        };
        cur.clear();
        *len = 0;
        *fresh = 0;
        if let Some(last) = carry {
            cur.push(last);
            *len = last.chars().count();
        }
    };
    for (unit, para_end) in &units {
        // No overlap carried into a new section.
        if unit.starts_with('#') && fresh == 0 {
            cur.clear();
            len = 0;
        }
        let n = unit.chars().count();
        if len > 0 && len + 1 + n > TARGET_CHARS {
            flush(&mut cur, &mut len, &mut fresh, &mut out);
            // A carried-over sentence must not push a long one past the limit.
            if len + 1 + n > MAX_CHARS {
                cur.clear();
                len = 0;
            }
        }
        cur.push(unit);
        len += n + usize::from(len > 0);
        fresh += 1;
        if *para_end && len >= MIN_CHARS {
            flush(&mut cur, &mut len, &mut fresh, &mut out);
        }
    }
    if fresh > 0 {
        let tail = cur.join(sep);
        // A scrap of a few words is folded into the previous chunk.
        match out.last_mut() {
            Some(prev) if tail.chars().count() < 80 && fresh == cur.len() && !tail.starts_with('#') && prev.chars().count() + 1 + tail.chars().count() <= MAX_CHARS => {
                prev.push_str(sep);
                prev.push_str(&tail);
            }
            _ => out.push(tail),
        }
    }
    out.retain(|c| c.chars().count() >= 3);
    out
}

/// Sentences (prose) or lines (everything else), whitespace collapsed, each
/// at most `MAX_CHARS`, flagged when a paragraph ends after them.
fn units(text: &str, prose: bool) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = Vec::new();
    // Paragraphs are separated by blank lines; in prose a single newline
    // (one paragraph per line from docx, slides, PDFs) also ends one when
    // the line ends a sentence.
    // Markdown headings start a paragraph of their own.
    let text = if prose { text.replace("\r\n", "\n").replace("\n#", "\n\n#") } else { text.to_string() };
    for para in text.split("\n\n").flat_map(|p| p.split("\r\n\r\n")) {
        let pieces: Vec<String> = if prose {
            sentences(&para.split_whitespace().collect::<Vec<_>>().join(" "))
        } else {
            para.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).collect()
        };
        for piece in pieces.into_iter().filter(|p| !p.is_empty()) {
            for part in split_long(&piece) {
                out.push((part, false));
            }
        }
        if let Some(last) = out.last_mut() {
            last.1 = true;
        }
    }
    // A chunk may end before a heading, so a new section starts a new chunk.
    for i in 1..out.len() {
        if out[i].0.starts_with('#') {
            out[i - 1].1 = true;
        }
    }
    out
}

/// Split on sentence ends: . ! ? (and CJK equivalents) followed by a space.
fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut start = 0;
    let bytes: Vec<(usize, char)> = text.char_indices().collect();
    for (i, &(at, c)) in bytes.iter().enumerate() {
        let end_mark = matches!(c, '.' | '!' | '?' | '。' | '！' | '？');
        let next_space = bytes.get(i + 1).is_none_or(|(_, n)| *n == ' ');
        if end_mark && next_space {
            // Don't split after a lone initial or short abbreviation ("e.g.", "Dr.").
            let word = text[start..at].rsplit(' ').next().unwrap_or("");
            let abbrev = !word.is_empty()
                && word.chars().all(|w| w.is_alphabetic() || w == '.')
                && (word.chars().count() <= 2 || word.contains('.'));
            if c == '.' && abbrev {
                continue;
            }
            let end = at + c.len_utf8();
            out.push(text[start..end].trim().to_string());
            start = end;
        }
    }
    if start < text.len() {
        out.push(text[start..].trim().to_string());
    }
    out
}

/// Break anything longer than `MAX_CHARS` at word boundaries.
fn split_long(s: &str) -> Vec<String> {
    if s.chars().count() <= MAX_CHARS {
        return vec![s.to_string()];
    }
    let mut out = Vec::new();
    let mut cur = String::new();
    for word in s.split(' ') {
        let mut word = word.to_string();
        // A single unbroken run (base64, minified code) is cut hard.
        while word.chars().count() > TARGET_CHARS {
            let head: String = word.chars().take(TARGET_CHARS).collect();
            word = word.chars().skip(TARGET_CHARS).collect();
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            out.push(head);
        }
        if !cur.is_empty() && cur.chars().count() + 1 + word.chars().count() > TARGET_CHARS {
            out.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(&word);
    }
    if !cur.is_empty() {
        out.push(cur);
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
    fn chunks_are_small_and_cover_everything() {
        let text = "The quarterly budget was approved by finance. ".repeat(150);
        let c = chunk_text(&text, true);
        assert!(c.len() >= 5, "{}", c.len());
        assert!(c.iter().all(|s| s.chars().count() <= MAX_CHARS));
        // Chunks end on whole sentences.
        assert!(c.iter().all(|s| s.ends_with("finance.")));
        assert!(c.last().unwrap().ends_with("finance."));
    }

    #[test]
    fn short_text_is_one_chunk() {
        assert_eq!(chunk_text("hello   there\n\nworld", true), vec!["hello there world".to_string()]);
    }

    #[test]
    fn paragraphs_split_topics() {
        let a = "Our trip to Lisbon was booked for March. We stayed near the river and ate pastel de nata every morning. The tram up the hill was packed. ".repeat(3);
        let b = "The car insurance renewal is due in May. The premium went up by twelve percent compared to last year. Call the broker before then. ".repeat(3);
        let c = chunk_text(&format!("{a}\n\n{b}"), true);
        assert_eq!(c.len(), 2, "{c:?}");
        assert!(c[0].contains("Lisbon") && !c[0].contains("insurance"));
        assert!(c[1].contains("insurance") && !c[1].contains("Lisbon"));
    }

    #[test]
    fn short_last_sentence_overlaps() {
        let long = "word ".repeat(180);
        let text = format!("{}. Short bridge. {}.", long.trim(), long.trim());
        let c = chunk_text(&text, true);
        assert!(c.len() >= 2);
        assert!(c[0].ends_with("Short bridge.") && c[1].starts_with("Short bridge."), "{c:?}");
    }

    #[test]
    fn code_splits_on_lines_and_long_runs_are_cut() {
        let code = (0..400).map(|i| format!("let value_{i} = compute({i});")).collect::<Vec<_>>().join("\n");
        let c = chunk_text(&code, false);
        assert!(c.len() > 5);
        assert!(c.iter().all(|s| s.lines().all(|l| l.starts_with("let value_"))));
        let blob = "x".repeat(5000);
        assert!(chunk_text(&blob, false).iter().all(|s| s.chars().count() <= MAX_CHARS));
    }

    #[test]
    fn long_files_are_sampled_across_their_length() {
        let s = sample_evenly((0..1000).collect::<Vec<_>>(), 300);
        assert_eq!(s.len(), 300);
        assert_eq!(s[0], 0);
        assert!(*s.last().unwrap() > 990);
    }

    #[test]
    fn minified_and_data_files() {
        let one_line = vec![(None, "a".repeat(5000))];
        assert!(is_minified(Path::new("app.js"), &one_line));
        assert!(is_minified(Path::new("vendor.min.js"), &[(None, "x\ny".into())]));
        assert!(!is_minified(Path::new("main.rs"), &[(None, "fn main() {\n    run();\n}".into())]));
        assert!(keyword_only(Path::new("server.LOG")) && keyword_only(Path::new("data.csv")));
        assert!(!keyword_only(Path::new("notes.md")));
    }

    #[test]
    fn headings_start_a_new_chunk() {
        let intro = "Intro sentence about the project and its goals. ".repeat(8);
        for prose in [true, false] {
            let c = chunk_text(&format!("{intro}\n# Budget\nThe budget is 4,210 euros."), prose);
            assert!(c.last().unwrap().starts_with("# Budget"), "{c:?}");
        }
    }

    #[test]
    fn abbreviations_dont_split() {
        assert_eq!(sentences("Meet Dr. Rao at 5. Bring e.g. the deck."), vec!["Meet Dr. Rao at 5.", "Bring e.g. the deck."]);
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
