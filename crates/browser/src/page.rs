use chromiumoxide::Page;
use serde_json::Value;

/// A tab-scoped session. Wraps a chromiumoxide `Page` with the small set of
/// primitives the agent layer needs: `evaluate_json` (the JS-extractor entry
/// point), `navigate`, and `page_info`. Higher-level tools (selector waits,
/// click-by-selector, fill, etc.) live in the sites/tools crate.
pub struct PageSession {
    page: Page,
}

const PAGE_INFO_JS: &str = r#"
return {
  url: location.href,
  title: document.title,
  readyState: document.readyState,
  viewport: { w: innerWidth, h: innerHeight },
  scroll: { x: scrollX, y: scrollY }
};
"#;

impl PageSession {
    pub(crate) fn new(page: Page) -> Self {
        Self { page }
    }

    pub fn target_id(&self) -> &str {
        self.page.target_id().inner()
    }

    /// Navigate to `url` and wait for the load event. Mirrors Python
    /// `PageSession.navigate(url, wait_until="domcontentloaded")` in spirit
    /// — chromiumoxide's `wait_for_navigation` blocks until lifecycle "load".
    pub async fn navigate(&self, url: &str) -> anyhow::Result<()> {
        self.page.goto(url).await?;
        self.page.wait_for_navigation().await?;
        Ok(())
    }

    /// Evaluate a JS snippet and deserialize its return value as
    /// `serde_json::Value`. The expression is wrapped in an IIFE when it
    /// contains a top-level `return`, matching the Python ergonomics.
    pub async fn evaluate_json(&self, expression: &str) -> anyhow::Result<Value> {
        let wrapped = wrap_expression(expression);
        let result = self.page.evaluate(wrapped.as_str()).await?;
        let value: Value = result.into_value()?;
        Ok(value)
    }

    pub async fn page_info(&self) -> anyhow::Result<Value> {
        self.evaluate_json(PAGE_INFO_JS).await
    }

    /// Close the underlying tab. Consumes the session — the chromiumoxide
    /// page handle is dropped on success.
    pub async fn close(self) -> anyhow::Result<()> {
        self.page.close().await?;
        Ok(())
    }
}

fn wrap_expression(expression: &str) -> String {
    let trimmed = expression.trim();
    if has_top_level_return(trimmed) && !trimmed.starts_with('(') {
        format!("(function(){{{}}})()", expression)
    } else {
        expression.to_string()
    }
}

/// Detect a top-level `return` statement, skipping strings, line comments,
/// and block comments. Direct port of the Python heuristic — handles the
/// common case where the user writes multi-line JS with a `return` at the
/// end and expects it to behave like a function body.
///
/// Iterates by char index, not byte index, so multi-byte UTF-8 (e.g. the
/// non-breaking space '\u{a0}' that appears in real-world JS bundles)
/// doesn't trip char-boundary panics on slicing.
fn has_top_level_return(src: &str) -> bool {
    #[derive(Clone, Copy)]
    enum S {
        Code,
        Line,
        Block,
        Str(char),
    }
    let chars: Vec<(usize, char)> = src.char_indices().collect();
    let mut state = S::Code;
    let mut i = 0;
    while i < chars.len() {
        let (byte_idx, c) = chars[i];
        let n = chars.get(i + 1).map(|(_, ch)| *ch).unwrap_or('\0');
        match state {
            S::Code => {
                if c == '"' || c == '\'' || c == '`' {
                    state = S::Str(c);
                    i += 1;
                    continue;
                }
                if c == '/' && n == '/' {
                    state = S::Line;
                    i += 2;
                    continue;
                }
                if c == '/' && n == '*' {
                    state = S::Block;
                    i += 2;
                    continue;
                }
                if c == 'r' && src[byte_idx..].starts_with("return") {
                    let before = if i > 0 { chars[i - 1].1 } else { ' ' };
                    let after = chars.get(i + 6).map(|(_, ch)| *ch).unwrap_or(' ');
                    let before_ok = !(before.is_alphanumeric() || before == '_');
                    let after_ok = !(after.is_alphanumeric() || after == '_');
                    if before_ok && after_ok {
                        return true;
                    }
                }
                i += 1;
            }
            S::Line => {
                if c == '\n' {
                    state = S::Code;
                }
                i += 1;
            }
            S::Block => {
                if c == '*' && n == '/' {
                    state = S::Code;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            S::Str(q) => {
                if c == '\\' {
                    i += 2;
                    continue;
                }
                if c == q {
                    state = S::Code;
                }
                i += 1;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn return_detected_at_top_level() {
        assert!(has_top_level_return("return 1;"));
        assert!(has_top_level_return("const x = 1; return x;"));
    }

    #[test]
    fn return_inside_string_ignored() {
        assert!(!has_top_level_return("'return inside'"));
        assert!(!has_top_level_return("`return inside`"));
    }

    #[test]
    fn return_inside_comment_ignored() {
        assert!(!has_top_level_return("// return\n"));
        assert!(!has_top_level_return("/* return */"));
    }

    #[test]
    fn return_inside_word_ignored() {
        assert!(!has_top_level_return("noreturn"));
        assert!(!has_top_level_return("return_value"));
    }

    #[test]
    fn handles_non_ascii_chars() {
        // Regression: \u{a0} is non-breaking space (2 bytes in UTF-8). The
        // previous byte-indexing scanner panicked here when slicing through
        // its first byte. The real-world trigger was the XHS page_scripts.js
        // bundle, which uses \u{a0} in a string literal.
        assert!(!has_top_level_return("const s = '\u{a0}';"));
        assert!(has_top_level_return(
            "const s = '\u{a0}'; const x = 1; return x;"
        ));
        assert!(has_top_level_return("// 中文注释\nreturn 1;"));
    }

    #[test]
    fn wrap_preserves_expressions() {
        assert_eq!(wrap_expression("1 + 2"), "1 + 2");
        assert_eq!(wrap_expression("document.title"), "document.title");
    }

    #[test]
    fn wrap_with_return() {
        assert_eq!(
            wrap_expression("return document.title;"),
            "(function(){return document.title;})()"
        );
    }
}
