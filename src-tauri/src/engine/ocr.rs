//! Text in pictures (screenshots, scanned receipts, photographed slides),
//! read with the OCR built into Windows 10 and 11 in the languages the user
//! has installed. Nothing is downloaded and nothing leaves the PC. Elsewhere
//! no text is read from pictures.

use std::path::Path;

/// Words in the picture, one recognised line per line, or None when there's
/// no text (or no OCR on this PC).
#[cfg(windows)]
pub fn read(path: &Path) -> Option<String> {
    let text = windows_ocr::read(path).ok()?;
    let text = text.trim();
    (text.chars().filter(|c| c.is_alphanumeric()).count() >= 3).then(|| text.to_string())
}

#[cfg(not(windows))]
pub fn read(_path: &Path) -> Option<String> {
    None
}

/// Whether pictures can be read at all here, so files indexed before OCR
/// existed are read again once.
pub fn available() -> bool {
    cfg!(windows)
}

#[cfg(windows)]
mod windows_ocr {
    use std::path::Path;

    use windows::core::{Result, HSTRING};
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat, BitmapTransform,
        ColorManagementMode, ExifOrientationMode,
    };
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    pub fn read(path: &Path) -> Result<String> {
        // Each reader thread joins the shared apartment; already joined is fine.
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.to_string_lossy().as_ref()))?.join()?;
        let stream = file.OpenAsync(FileAccessMode::Read)?.join()?;
        let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
        // OCR refuses pictures past a size (a 4K screenshot is over), so
        // shrink those to fit.
        let (w, h) = (decoder.OrientedPixelWidth()?, decoder.OrientedPixelHeight()?);
        let shrink = (OcrEngine::MaxImageDimension()? as f64 / w.max(h).max(1) as f64).min(1.0);
        let transform = BitmapTransform::new()?;
        transform.SetScaledWidth(((w as f64 * shrink) as u32).max(1))?;
        transform.SetScaledHeight(((h as f64 * shrink) as u32).max(1))?;
        transform.SetInterpolationMode(BitmapInterpolationMode::Fant)?;
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Premultiplied,
                &transform,
                ExifOrientationMode::RespectExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )?
            .join()?;
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let lines = engine.RecognizeAsync(&bitmap)?.join()?.Lines()?;
        let mut out = String::new();
        for i in 0..lines.Size()? {
            out.push_str(&lines.GetAt(i)?.Text()?.to_string_lossy());
            out.push('\n');
        }
        Ok(out)
    }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn reads_text_in_a_screenshot() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ocr-invoice.png");
        // Windows without an OCR language (some server editions) reads nothing.
        let Some(text) = super::read(&fixture) else {
            eprintln!("no OCR on this Windows; skipped");
            return;
        };
        let text = text.to_lowercase();
        assert!(text.contains("invoice") && text.contains("4471"), "{text}");
    }
}
