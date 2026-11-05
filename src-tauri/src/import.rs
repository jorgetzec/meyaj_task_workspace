use std::collections::HashMap;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::util::{now_local_iso, parse_hashtags, strip_number_prefix};

#[derive(Default)]
pub struct ImportStats {
    pub tasks_imported: usize,
    pub history_imported: usize,
}

struct ParsedLine {
    indent: usize,
    completed: bool,
    code: Option<String>,
    content: String,
    created_at: String,
    completed_at: Option<String>,
}

/// Imports Markdown checklists, optionally with structured headings and metadata.
///
/// `## NN - Label` sections become projects (otherwise `General`). A valid
/// `date | **CODE** | content` prefix supplies a timestamp and optional global
/// classifier; plain checklist items keep a NULL classifier. Checked items go
/// to history, using the nearest subgroup or project heading as their label.
pub async fn import_markdown(
    pool: &SqlitePool,
    panel_id: &str,
    markdown: &str,
) -> Result<ImportStats, Box<dyn std::error::Error>> {
    let mut stats = ImportStats::default();

    // H2 projects and optional H3/H4 subgroups supply history labels.
    let mut current_area: Option<String> = None;
    let mut current_sub: Option<String> = None;
    let mut in_history = false;

    // Cache: project label -> project id (avoids repeated DB lookups).
    let mut project_cache: HashMap<String, String> = HashMap::new();

    // Stack for indent-based subtask parenting (active tasks only).
    let mut parent_stack: Vec<(usize, String)> = Vec::new();

    // Per-project counter for stable sort_order.
    let mut task_counter: HashMap<String, i64> = HashMap::new();

    let mut code_fence: Option<(char, usize)> = None;

    let mut in_frontmatter = false;
    let mut frontmatter_handled = false;

    for raw_line in markdown.trim_start_matches('\u{feff}').lines() {
        let line = raw_line.trim_end_matches('\r');
        let trimmed = line.trim();

        // Frontmatter handling (only at the very start of the document).
        if !frontmatter_handled {
            if !in_frontmatter {
                if trimmed == "---" {
                    in_frontmatter = true;
                    continue;
                } else if trimmed.is_empty() {
                    continue;
                } else {
                    frontmatter_handled = true;
                }
            } else {
                if trimmed == "---" || trimmed == "..." {
                    in_frontmatter = false;
                    frontmatter_handled = true;
                }
                continue;
            }
        }

        // A closing fence must match the opener's marker and minimum length.
        if let Some((marker, length)) = code_fence {
            if let Some((found, count, rest)) = parse_fence(line) {
                if found == marker && count >= length && rest.trim().is_empty() {
                    code_fence = None;
                }
            }
            continue;
        }
        if let Some((marker, length, rest)) = parse_fence(line) {
            if marker != '`' || !rest.contains('`') {
                code_fence = Some((marker, length));
                continue;
            }
        }

        if let Some((level, title)) = parse_heading(trimmed) {
            parent_stack.clear();
            handle_heading(
                title,
                level,
                &mut current_area,
                &mut current_sub,
                &mut in_history,
            );
            continue;
        }

        // Task line?
        if let Some(parsed) = parse_task_line(line) {
            // Ignore empty task lines.
            if parsed.content.trim().is_empty() {
                continue;
            }

            if let Some(classifier) = parsed.code.as_deref() {
                ensure_classifier(pool, classifier).await?;
            }

            if parsed.completed {
                while let Some((indent, _)) = parent_stack.last() {
                    if *indent >= parsed.indent {
                        parent_stack.pop();
                    } else {
                        break;
                    }
                }
                let classifier = parsed.code.clone();
                let label = current_sub
                    .clone()
                    .or_else(|| current_area.clone())
                    .or_else(|| classifier.clone());
                insert_history_entry(pool, panel_id, &parsed, classifier, label).await?;
                stats.history_imported += 1;
            } else {
                // Project = the `##` area heading the task belongs to.
                let label = current_area
                    .clone()
                    .unwrap_or_else(|| "General".to_string());

                // Resolve (or create) the project by label.
                let project_id = match project_cache.get(&label) {
                    Some(id) => id.clone(),
                    None => {
                        let id = find_or_create_project(pool, panel_id, &label).await?;
                        project_cache.insert(label.clone(), id.clone());
                        id
                    }
                };

                // Resolve parent from the indent stack.
                while let Some((indent, _)) = parent_stack.last() {
                    if *indent >= parsed.indent {
                        parent_stack.pop();
                    } else {
                        break;
                    }
                }
                let parent_id = parent_stack.last().map(|(_, id)| id.clone());

                let sort_order = task_counter.entry(project_id.clone()).or_insert(0);
                let task_id = insert_active_task(
                    pool,
                    &project_id,
                    &parsed,
                    parsed.code.as_deref(),
                    parent_id.as_deref(),
                    *sort_order,
                )
                .await?;
                *sort_order += 1;

                parent_stack.push((parsed.indent, task_id));
                stats.tasks_imported += 1;
            }
        }
    }

    Ok(stats)
}

fn handle_heading(
    title: &str,
    level: usize,
    current_area: &mut Option<String>,
    current_sub: &mut Option<String>,
    in_history: &mut bool,
) {
    let lower = title.trim().to_lowercase();
    if level <= 2 {
        let history = matches!(lower.as_str(), "history" | "historial");
        let active = matches!(
            lower.as_str(),
            "active" | "registro" | "en foco" | "en pausa" | "pendientes"
        );
        if history || active {
            *in_history = history;
            *current_area = None;
            *current_sub = None;
        } else if level == 2 {
            *current_area = Some(strip_number_prefix(title));
            *current_sub = None;
        }
        // Other H1 titles are organizational, not project names.
    } else if level == 3 || level == 4 {
        *current_sub = Some(strip_number_prefix(title));
    }
}

async fn ensure_classifier(pool: &SqlitePool, name: &str) -> Result<(), sqlx::Error> {
    let name = name.trim().to_uppercase();
    if name.is_empty() {
        return Ok(());
    }
    let id = format!("cls-{}", name);
    sqlx::query("INSERT OR IGNORE INTO classifier (id, name) VALUES (?, ?)")
        .bind(&id)
        .bind(&name)
        .execute(pool)
        .await?;
    Ok(())
}

async fn find_or_create_project(
    pool: &SqlitePool,
    panel_id: &str,
    label: &str,
) -> Result<String, sqlx::Error> {
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM project WHERE panel_id = ? AND label = ? LIMIT 1")
            .bind(panel_id)
            .bind(label)
            .fetch_optional(pool)
            .await?;
    if let Some(id) = existing {
        return Ok(id);
    }

    let id = Uuid::new_v4().to_string();
    let sort_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM project WHERE panel_id = ?",
    )
    .bind(panel_id)
    .fetch_one(pool)
    .await?;

    sqlx::query("INSERT INTO project (id, label, color_accent, sort_order, panel_id) VALUES (?, ?, NULL, ?, ?)")
        .bind(&id)
        .bind(label)
        .bind(sort_order)
        .bind(panel_id)
        .execute(pool)
        .await?;

    Ok(id)
}

async fn insert_active_task(
    pool: &SqlitePool,
    project_id: &str,
    parsed: &ParsedLine,
    classifier: Option<&str>,
    parent_id: Option<&str>,
    sort_order: i64,
) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO task (id, content, completed, created_at, completed_at, project_id, classifier, sort_order, parent_task_id) \
         VALUES (?, ?, 0, ?, NULL, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&parsed.content)
    .bind(&parsed.created_at)
    .bind(project_id)
    .bind(classifier)
    .bind(sort_order)
    .bind(parent_id)
    .execute(pool)
    .await?;

    sync_hashtags(pool, &id, &parsed.content).await?;
    Ok(id)
}

async fn insert_history_entry(
    pool: &SqlitePool,
    panel_id: &str,
    parsed: &ParsedLine,
    classifier: Option<String>,
    label: Option<String>,
) -> Result<(), sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO history_entry (id, panel_id, task_id, classifier, project_label, snapshot_content, created_at, completed_at) \
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(panel_id)
    .bind(&classifier)
    .bind(&label)
    .bind(&parsed.content)
    .bind(&parsed.created_at)
    .bind(parsed.completed_at.as_deref().unwrap_or(&parsed.created_at))
    .execute(pool)
    .await?;

    Ok(())
}

/// Re-syncs the hashtag junction table for a task from its content.
pub async fn sync_hashtags(
    pool: &SqlitePool,
    task_id: &str,
    content: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM task_hashtag WHERE task_id = ?")
        .bind(task_id)
        .execute(pool)
        .await?;

    for tag in parse_hashtags(content) {
        let hashtag_id: Option<(String,)> = sqlx::query_as("SELECT id FROM hashtag WHERE name = ?")
            .bind(&tag)
            .fetch_optional(pool)
            .await?;

        let hashtag_id = match hashtag_id {
            Some((id,)) => id,
            None => {
                let id = Uuid::new_v4().to_string();
                sqlx::query("INSERT INTO hashtag (id, name) VALUES (?, ?)")
                    .bind(&id)
                    .bind(&tag)
                    .execute(pool)
                    .await?;
                id
            }
        };

        sqlx::query("INSERT OR IGNORE INTO task_hashtag (task_id, hashtag_id) VALUES (?, ?)")
            .bind(task_id)
            .bind(&hashtag_id)
            .execute(pool)
            .await?;
    }

    Ok(())
}

fn parse_fence(line: &str) -> Option<(char, usize, &str)> {
    let unindented = line.trim_start_matches(' ');
    if line.len() - unindented.len() > 3 {
        return None;
    }
    let line = unindented;
    let marker = line.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let length = line.chars().take_while(|ch| *ch == marker).count();
    // Both permitted markers are ASCII, so this offset is a UTF-8 boundary.
    (length >= 3).then(|| (marker, length, &line[length..]))
}

fn parse_heading(line: &str) -> Option<(usize, &str)> {
    let level = line.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let title = &line[level..];
    if !title.is_empty() && !title.starts_with(char::is_whitespace) {
        return None;
    }
    let title = title.trim();
    let without_closing = title.trim_end_matches('#');
    let title = if without_closing.ends_with(char::is_whitespace) {
        without_closing.trim_end()
    } else {
        title
    };
    Some((level, title))
}

fn parse_task_line(line: &str) -> Option<ParsedLine> {
    let trimmed_start = line.trim_start_matches([' ', '\t']);
    let indent = line
        .chars()
        .take_while(|ch| *ch == ' ' || *ch == '\t')
        .fold(0, |column, ch| {
            if ch == '\t' {
                column + 4 - column % 4
            } else {
                column + 1
            }
        });

    let rest = if let Some(rest) = trimmed_start.strip_prefix(['-', '*', '+']) {
        // Also accept the common compact extension `-[ ]`.
        rest.trim_start_matches([' ', '\t'])
    } else {
        let number = trimmed_start
            .chars()
            .take_while(char::is_ascii_digit)
            .count();
        if number == 0 {
            return None;
        }
        let rest = trimmed_start[number..].strip_prefix(['.', ')'])?;
        if !rest.starts_with([' ', '\t']) {
            return None;
        }
        rest.trim_start_matches([' ', '\t'])
    };
    let (completed, rest) = if let Some(rest) = rest.strip_prefix("[ ]") {
        (false, rest)
    } else if let Some(rest) = rest
        .strip_prefix("[x]")
        .or_else(|| rest.strip_prefix("[X]"))
    {
        (true, rest)
    } else {
        return None;
    };
    if !rest.is_empty() && !rest.starts_with([' ', '\t']) {
        return None;
    }
    let rest = rest.trim();
    let mut content = rest;
    let mut code = None;
    let mut created_at = String::new();

    if let Some((date, remainder)) = rest.split_once('|') {
        if let Some((classifier, body)) = remainder.split_once('|') {
            let parsed_date = parse_datetime(date);
            if !parsed_date.is_empty() {
                created_at = parsed_date;
                let classifier = classifier.trim();
                let classifier = classifier
                    .strip_prefix("**")
                    .and_then(|value| value.strip_suffix("**"))
                    .unwrap_or(classifier)
                    .trim();
                if !classifier.is_empty() {
                    code = Some(classifier.to_uppercase());
                }
                content = body.trim();
            }
        }
    }

    let mut completed_at = None;
    if completed {
        if let Some((body, date)) = content.rsplit_once('✅') {
            let date = date.trim();
            // Only remove an unambiguous trailing marker, never ordinary prose.
            if date.len() == 10 {
                if let Ok(date) = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
                    completed_at = Some(date.format("%Y-%m-%d").to_string());
                    content = body.trim_end();
                }
            }
        }
    }

    Some(ParsedLine {
        indent,
        completed,
        code,
        content: content.to_string(),
        created_at: if created_at.is_empty() {
            now_local_iso()
        } else {
            created_at
        },
        completed_at,
    })
}

/// Validates the entire input; malformed text must remain literal task content.
fn parse_datetime(s: &str) -> String {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat};

    let normalized = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Ok(date) = DateTime::parse_from_rfc3339(&normalized) {
        // Keep an explicit offset rather than silently reinterpreting it as local time.
        return date.to_rfc3339_opts(SecondsFormat::AutoSi, true);
    }
    for format in [
        "%Y-%m-%d %I:%M %p",
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%dT%H:%M:%S%.f",
    ] {
        if let Ok(date) = NaiveDateTime::parse_from_str(&normalized, format) {
            return date.format("%Y-%m-%dT%H:%M:%S%.f").to_string();
        }
    }
    if let Ok(date) = NaiveDate::parse_from_str(&normalized, "%Y-%m-%d") {
        return format!("{}T00:00:00", date.format("%Y-%m-%d"));
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    const STRUCTURED: &str = include_str!("../../examples/structured-workspace.md");
    const CHECKLIST: &str = include_str!("../../examples/markdown-checklist.md");
    const PANEL: &str = "synthetic-panel";

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .in_memory(true)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        crate::db::apply_schema(&pool).await.unwrap();
        // The importer must discover arbitrary classifiers without relying on seeds.
        sqlx::query("DELETE FROM classifier")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO panel (id, title, created_at) VALUES (?, 'Synthetic panel', '2032-01-01T00:00:00')")
            .bind(PANEL).execute(&pool).await.unwrap();
        pool
    }

    async fn count(pool: &SqlitePool, query: &str) -> i64 {
        sqlx::query_scalar(query).fetch_one(pool).await.unwrap()
    }

    async fn assert_parent(pool: &SqlitePool, child: &str, parent: Option<&str>) {
        let actual: Option<String> = sqlx::query_scalar(
            "SELECT parent.content FROM task child LEFT JOIN task parent ON parent.id = child.parent_task_id WHERE child.content = ?",
        )
        .bind(child).fetch_one(pool).await.unwrap();
        assert_eq!(actual.as_deref(), parent, "child: {child}");
    }

    #[tokio::test]
    #[ignore = "Requires MEYAJ_IMPORT_SMOKE_FILE pointing to a local Markdown file"]
    async fn smoke_import_local_markdown() {
        let path = std::env::var("MEYAJ_IMPORT_SMOKE_FILE")
            .unwrap_or_else(|_| panic!("MEYAJ_IMPORT_SMOKE_FILE must be set"));
        let markdown = std::fs::read_to_string(path)
            .unwrap_or_else(|_| panic!("Unable to read the local Markdown smoke file"));
        let pool = test_pool().await;
        let stats = import_markdown(&pool, PANEL, &markdown)
            .await
            .unwrap_or_else(|_| panic!("Local Markdown smoke import failed"));

        let active = count(&pool, "SELECT COUNT(*) FROM task").await;
        let history = count(&pool, "SELECT COUNT(*) FROM history_entry").await;
        let projects = count(&pool, "SELECT COUNT(*) FROM project").await;
        let classifier = count(&pool, "SELECT COUNT(*) FROM classifier").await;
        assert!(active + history > 0, "No Markdown tasks were imported");
        assert_eq!(active as usize, stats.tasks_imported);
        assert_eq!(history as usize, stats.history_imported);
        let cross_project = count(
            &pool,
            "SELECT COUNT(*) FROM task child JOIN task parent ON parent.id = child.parent_task_id WHERE child.project_id IS NOT parent.project_id",
        )
        .await;
        assert_eq!(cross_project, 0, "Parent and child projects must match");

        println!("active={active} history={history} projects={projects} classifier={classifier}");
        pool.close().await;
    }

    #[tokio::test]
    async fn public_structured_fixture_maps_projects_classifiers_and_history() {
        let pool = test_pool().await;
        let stats = import_markdown(&pool, PANEL, STRUCTURED).await.unwrap();
        assert_eq!((stats.tasks_imported, stats.history_imported), (6, 2));

        let mappings: Vec<(String, i64)> = sqlx::query_as(
            "SELECT p.label, COUNT(t.id) FROM project p LEFT JOIN task t ON t.project_id = p.id GROUP BY p.id ORDER BY p.sort_order",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(
            mappings,
            vec![("Website Refresh".into(), 4), ("Team Operations".into(), 2)]
        );
        let classifiers: Vec<String> =
            sqlx::query_scalar("SELECT name FROM classifier ORDER BY name")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(classifiers, vec!["DESIGN", "DOCS", "REVIEW"]);
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM task WHERE classifier IS NULL").await,
            3
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_hashtag").await, 6);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM hashtag").await, 5);
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM task WHERE trim(content) = ''").await,
            0
        );

        let task_codes: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT content, classifier FROM task ORDER BY content")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            task_codes,
            vec![
                ("Check contrast ratios #review".into(), None),
                ("Compare button labels A | B | C #design/ui".into(), None),
                (
                    "Draft the navigation outline #focus".into(),
                    Some("DESIGN".into())
                ),
                (
                    "Prepare the onboarding checklist #next".into(),
                    Some("DOCS".into())
                ),
                (
                    "Review the mobile layout #review".into(),
                    Some("REVIEW".into())
                ),
                ("Update the meeting template #waiting".into(), None),
            ]
        );
        let history: Vec<(String, Option<String>, Option<String>, String, String)> = sqlx::query_as(
            "SELECT snapshot_content, classifier, project_label, created_at, completed_at FROM history_entry ORDER BY completed_at",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(
            history[0],
            (
                "Approve the initial wireframe".into(),
                Some("DESIGN".into()),
                Some("Archived Designs".into()),
                "2032-04-01T00:05:00".into(),
                "2032-04-02".into(),
            )
        );
        assert_eq!(history[1].0, "Archive the previous checklist");
        assert_eq!(history[1].1, None);
        assert_eq!(history[1].2.as_deref(), Some("Completed Checklist"));
        assert_eq!(history[1].4, "2032-04-03");
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task child JOIN task parent ON parent.id = child.parent_task_id WHERE child.project_id != parent.project_id").await, 0);
        pool.close().await;
    }

    #[tokio::test]
    async fn public_structured_fixture_keeps_parents_inside_heading_context() {
        let pool = test_pool().await;
        import_markdown(&pool, PANEL, STRUCTURED).await.unwrap();
        assert_parent(
            &pool,
            "Review the mobile layout #review",
            Some("Draft the navigation outline #focus"),
        )
        .await;
        assert_parent(
            &pool,
            "Check contrast ratios #review",
            Some("Review the mobile layout #review"),
        )
        .await;
        assert_parent(&pool, "Compare button labels A | B | C #design/ui", None).await;
        assert_parent(&pool, "Prepare the onboarding checklist #next", None).await;
        pool.close().await;
    }

    #[tokio::test]
    async fn public_checklist_fixture_uses_general_without_invented_classifiers() {
        let pool = test_pool().await;
        let stats = import_markdown(&pool, PANEL, CHECKLIST).await.unwrap();
        assert_eq!((stats.tasks_imported, stats.history_imported), (6, 2));
        let labels: Vec<String> = sqlx::query_scalar("SELECT label FROM project")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(labels, vec!["General"]);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM classifier").await, 0);
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM task WHERE classifier IS NULL").await,
            6
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_hashtag").await, 6);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM hashtag").await, 5);
        assert_parent(
            &pool,
            "Review the acceptance criteria #planning",
            Some("Plan the release checklist #planning"),
        )
        .await;
        assert_parent(
            &pool,
            "Confirm the release owner #review",
            Some("Plan the release checklist #planning"),
        )
        .await;
        assert_parent(&pool, "Compare status labels A|B|C #labels", None).await;
        let history: Vec<(Option<String>, Option<String>, String, String)> = sqlx::query_as(
            "SELECT classifier, project_label, snapshot_content, completed_at FROM history_entry ORDER BY completed_at",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(
            history,
            vec![
                (
                    None,
                    None,
                    "Approve the release summary".into(),
                    "2032-05-06".into()
                ),
                (
                    None,
                    None,
                    "Archive the previous release notes".into(),
                    "2032-05-07".into()
                ),
            ]
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn bom_crlf_frontmatter_and_fence_lengths_are_ignored() {
        let pool = test_pool().await;
        let markdown = "\u{feff}---\r\n- [ ] Hidden YAML sample\r\n...\r\n# Active\r\n- [ ] Visible synthetic root\r\n````query\r\n```\r\n# History\r\n- [x] Hidden short-fence sample\r\n~~~~\r\n- [ ] Hidden mixed-fence sample\r\n```` not a closing fence\r\n- [ ] Hidden trailing-text sample\r\n`````\r\n~~~text\r\n- [ ] Hidden tilde sample\r\n~~~\r\n    - [ ] Visible synthetic child\r\n";
        let stats = import_markdown(&pool, PANEL, markdown).await.unwrap();
        assert_eq!((stats.tasks_imported, stats.history_imported), (2, 0));
        assert_parent(
            &pool,
            "Visible synthetic child",
            Some("Visible synthetic root"),
        )
        .await;
        pool.close().await;
    }

    #[tokio::test]
    async fn regression_completed_sibling_preserves_active_ancestors() {
        let pool = test_pool().await;
        let markdown = "- [ ] Parent\n    - [x] Finished\n    - [ ] Pending\n- [x] Finished root\n    - [ ] Independent pending\n";
        let stats = import_markdown(&pool, PANEL, markdown).await.unwrap();
        assert_eq!((stats.tasks_imported, stats.history_imported), (3, 2));
        assert_parent(&pool, "Pending", Some("Parent")).await;
        assert_parent(&pool, "Independent pending", None).await;
        let history: Vec<String> = sqlx::query_scalar(
            "SELECT snapshot_content FROM history_entry ORDER BY snapshot_content",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(history, vec!["Finished", "Finished root"]);
        pool.close().await;
    }

    #[test]
    fn regression_fence_indentation_allows_only_up_to_three_ascii_spaces() {
        for marker in ["```", "~~~"] {
            for indent in 0..=3 {
                let line = format!("{}{marker}text", " ".repeat(indent));
                assert_eq!(
                    parse_fence(&line),
                    Some((marker.chars().next().unwrap(), 3, "text"))
                );
            }
            for indent in ["    ", "\t", " \t", "\u{a0}"] {
                assert!(parse_fence(&format!("{indent}{marker}")).is_none());
            }
        }
    }

    #[tokio::test]
    async fn regression_indented_fence_cannot_close_root_code_block() {
        for marker in ["```", "~~~"] {
            for indent in ["    ", "\t"] {
                let pool = test_pool().await;
                let markdown = format!(
                    "{marker}\n{indent}{marker}\n- [ ] Excluded code sample\n{marker}\n- [ ] Visible checklist item\n"
                );
                let stats = import_markdown(&pool, PANEL, &markdown).await.unwrap();
                assert_eq!((stats.tasks_imported, stats.history_imported), (1, 0));
                let tasks: Vec<String> = sqlx::query_scalar("SELECT content FROM task")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
                assert_eq!(tasks, vec!["Visible checklist item"]);
                pool.close().await;
            }
        }
    }

    #[tokio::test]
    async fn regression_indented_fence_does_not_open_root_code_block() {
        for marker in ["```", "~~~"] {
            for indent in ["    ", "\t"] {
                let pool = test_pool().await;
                let markdown = format!("{indent}{marker}\n- [ ] Visible after indented opener\n");
                let stats = import_markdown(&pool, PANEL, &markdown).await.unwrap();
                assert_eq!((stats.tasks_imported, stats.history_imported), (1, 0));
                assert_parent(&pool, "Visible after indented opener", None).await;
                pool.close().await;
            }
        }
    }

    #[tokio::test]
    async fn every_heading_level_resets_parent_context() {
        let pool = test_pool().await;
        for level in 1..=6 {
            let markdown = format!(
                "## 01 - Boundary Lab {level}\n- [ ] Synthetic boundary root {level}\n{} Boundary sample\n    - [ ] Synthetic boundary leaf {level}\n",
                "#".repeat(level)
            );
            import_markdown(&pool, PANEL, &markdown).await.unwrap();
            assert_parent(&pool, &format!("Synthetic boundary leaf {level}"), None).await;
        }
        pool.close().await;
    }

    #[tokio::test]
    async fn arbitrary_completed_classifier_is_registered_without_seed() {
        let pool = test_pool().await;
        let stats = import_markdown(&pool, PANEL, "# History\n### Synthetic Archive\n- [X] 2032-06-01 | **archive_facet-42** | Store a fictional facet ✅ 2032-06-02").await.unwrap();
        assert_eq!((stats.tasks_imported, stats.history_imported), (0, 1));
        let name: String = sqlx::query_scalar("SELECT name FROM classifier")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "ARCHIVE_FACET-42");
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM project").await, 0);
        pool.close().await;
    }

    #[test]
    fn checkboxes_accept_markers_case_whitespace_and_visual_tabs() {
        for marker in [
            "- [ ]", "* [ ]", "+ [ ]", "1. [ ]", "42) [ ]", "-[ ]", "-\t[ ]",
        ] {
            let parsed = parse_task_line(&format!("{marker}\tSynthetic marker sample")).unwrap();
            assert!(!parsed.completed);
            assert!(parsed.code.is_none());
            assert_eq!(parsed.content, "Synthetic marker sample");
        }
        for marker in ["- [x]", "* [X]", "+ [x]", "3) [X]"] {
            assert!(
                parse_task_line(&format!("{marker} Synthetic checked sample"))
                    .unwrap()
                    .completed
            );
        }
        assert_eq!(
            parse_task_line("\t- [ ] Synthetic tab sample")
                .unwrap()
                .indent,
            4
        );
        assert_eq!(
            parse_task_line("    - [ ] Synthetic space sample")
                .unwrap()
                .indent,
            4
        );
        assert_eq!(
            parse_task_line(" \t- [ ] Synthetic mixed sample")
                .unwrap()
                .indent,
            4
        );
        for line in [
            "[ ] Not a list",
            "1.[ ] Missing list space",
            "- [z] Invalid state",
            "- [ ]missing space",
            "- ordinary list",
        ] {
            assert!(parse_task_line(line).is_none(), "{line}");
        }
    }

    #[test]
    fn metadata_requires_valid_date_and_preserves_content_pipes() {
        let parsed = parse_task_line(
            "- [ ] 2032-04-05 12:09 pm | **facet_custom-17** | Synthetic channels A | B | C",
        )
        .unwrap();
        assert_eq!(parsed.code.as_deref(), Some("FACET_CUSTOM-17"));
        assert_eq!(parsed.created_at, "2032-04-05T12:09:00");
        assert_eq!(parsed.content, "Synthetic channels A | B | C");
        let unclassified =
            parse_task_line("- [ ] 2032-04-05 17:42 | | Synthetic empty-class sample").unwrap();
        assert!(unclassified.code.is_none());
        assert_eq!(unclassified.content, "Synthetic empty-class sample");
        let bare = parse_task_line("- [ ] 2032-04-05 | custom facet | Synthetic bare-class sample")
            .unwrap();
        assert_eq!(bare.code.as_deref(), Some("CUSTOM FACET"));
        for content in [
            "A|B|C",
            "Synthetic A | **B** | C",
            "2032-02-30 | **FACET** | Invalid calendar sample",
            "abcd-xy-日 | **FACET** | Unicode sample",
        ] {
            let parsed = parse_task_line(&format!("- [ ] {content}")).unwrap();
            assert!(parsed.code.is_none(), "{content}");
            assert_eq!(parsed.content, content);
        }
    }

    #[test]
    fn completed_markers_work_for_plain_and_extended_tasks_without_data_loss() {
        for line in [
            "- [X] Synthetic completion sample ✅ 2032-02-29",
            "- [x] 2032-02-28 | **FACET** | Synthetic completion sample ✅ 2032-02-29",
        ] {
            let parsed = parse_task_line(line).unwrap();
            assert!(parsed.completed);
            assert_eq!(parsed.content, "Synthetic completion sample");
            assert_eq!(parsed.completed_at.as_deref(), Some("2032-02-29"));
        }
        for content in [
            "Synthetic emoji ✅ without date",
            "Synthetic invalid ✅ 2031-02-29",
            "Synthetic suffix ✅ 2032-04-03 keep this",
            "Synthetic long token ✅ 2032-04-030",
        ] {
            let parsed = parse_task_line(&format!("- [x] {content}")).unwrap();
            assert_eq!(parsed.content, content);
            assert!(parsed.completed_at.is_none());
        }
    }

    #[test]
    fn datetimes_validate_calendar_clock_and_common_iso_formats() {
        for (input, expected) in [
            ("2032-02-29", "2032-02-29T00:00:00"),
            ("2032-04-05 12:00 am", "2032-04-05T00:00:00"),
            ("2032-04-05 12:00 PM", "2032-04-05T12:00:00"),
            ("2032-04-05 1:07 pm", "2032-04-05T13:07:00"),
            ("2032-04-05 23:59", "2032-04-05T23:59:00"),
            ("2032-04-05 16:08:09", "2032-04-05T16:08:09"),
            ("2032-04-05T16:08", "2032-04-05T16:08:00"),
            ("2032-04-05T16:08:09", "2032-04-05T16:08:09"),
            ("2032-04-05T16:08:09Z", "2032-04-05T16:08:09Z"),
            ("2032-04-05T16:08:09+02:00", "2032-04-05T16:08:09+02:00"),
        ] {
            assert_eq!(parse_datetime(input), expected, "{input}");
        }
    }

    #[test]
    fn malformed_unicode_datetimes_never_panic_or_become_metadata() {
        for input in [
            "",
            "日",
            "abcd-xy-日",
            "2032-04-é日",
            "2031-02-29",
            "2032-13-01",
            "2032-04-31",
            "2032-04-05 24:00",
            "2032-04-05 12:60",
            "2032-04-05 13:00 PM",
            "2032-04-05 00:30 am",
            "2032-04-05 garbage",
            "2032-04-05T25:00:00",
            "2032-04-05 12:00 pm trailing",
        ] {
            let result = std::panic::catch_unwind(|| parse_datetime(input));
            assert!(result.is_ok(), "panicked for {input}");
            assert!(result.unwrap().is_empty(), "accepted {input}");
        }
    }

    #[test]
    fn heading_aliases_preserve_projects_subgroups_and_history_mode() {
        let mut area = None;
        let mut sub = None;
        let mut history = false;
        for alias in ["History", "Historial"] {
            for level in [1, 2] {
                handle_heading(alias, level, &mut area, &mut sub, &mut history);
                assert!(history);
                assert!(area.is_none() && sub.is_none());
                handle_heading(
                    "07 — Synthetic Archive Area",
                    2,
                    &mut area,
                    &mut sub,
                    &mut history,
                );
                assert!(history);
                assert_eq!(area.as_deref(), Some("Synthetic Archive Area"));
                handle_heading("Synthetic Subgroup", 3, &mut area, &mut sub, &mut history);
                assert_eq!(sub.as_deref(), Some("Synthetic Subgroup"));
                handle_heading("Synthetic Detail", 4, &mut area, &mut sub, &mut history);
                assert_eq!(sub.as_deref(), Some("Synthetic Detail"));
                for active in ["Active", "Registro", "En foco", "En pausa", "Pendientes"] {
                    handle_heading(active, level, &mut area, &mut sub, &mut history);
                    assert!(!history);
                    assert!(area.is_none() && sub.is_none());
                }
            }
        }
    }
}
