use chrono::Local;

/// Current local datetime as ISO-ish `YYYY-MM-DDTHH:MM:SS`.
pub fn now_local_iso() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Extracts a compact `YYYYMMDD` from an ISO datetime string (first 10 chars).
#[cfg(test)]
pub fn to_yyyymmdd(iso: &str) -> String {
    iso.chars()
        .take(10)
        .filter(|c| c.is_ascii_digit())
        .collect()
}

/// Parses `#hashtag` tokens from a string. Supports slashes for namespaced
/// tags such as `#tema/science` and `#tema/code`.
pub fn parse_hashtags(text: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'#' {
            let mut j = i + 1;
            while j < bytes.len() {
                let c = bytes[j];
                if c.is_ascii_alphanumeric() || c == b'_' || c == b'/' || c == b'-' {
                    j += 1;
                } else {
                    break;
                }
            }
            if j > i + 1 {
                let tag = text[i + 1..j].to_string();
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    tags
}

/// Strips a leading `NN - ` / `NN — ` numbering prefix from a heading.
pub fn strip_number_prefix(heading: &str) -> String {
    let heading = heading.trim();
    let mut split_at = None;
    for (idx, ch) in heading.char_indices() {
        if ch == '-' || ch == '—' {
            let prefix = heading[..idx].trim();
            if !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit()) {
                split_at = Some(idx);
            }
            break;
        }
    }
    match split_at {
        Some(idx) => {
            // Skip the dash itself (+1 char) and any surrounding spaces.
            let rest = &heading[idx..];
            let trimmed = rest.trim_start_matches(['-', '—', ' ']);
            trimmed.trim().to_string()
        }
        None => heading.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hashtags() {
        assert_eq!(
            parse_hashtags("Hacer algo #foco y más #tema/science"),
            vec!["foco", "tema/science"]
        );
        assert_eq!(parse_hashtags("sin tags"), Vec::<String>::new());
    }

    #[test]
    fn test_strip_number_prefix() {
        assert_eq!(
            strip_number_prefix("01 - Website Refresh"),
            "Website Refresh"
        );
        assert_eq!(
            strip_number_prefix("02 — Team Operations"),
            "Team Operations"
        );
        assert_eq!(strip_number_prefix("Historial"), "Historial");
    }

    #[test]
    fn test_yyyymmdd() {
        assert_eq!(to_yyyymmdd("2026-11-04T10:00:00"), "20261104");
    }
}
