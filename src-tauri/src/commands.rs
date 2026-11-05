use sqlx::{Row, SqliteConnection, SqlitePool};
use tauri::State;
use uuid::Uuid;

use std::collections::HashMap;

use crate::db::AppState;
use crate::import;
use crate::models::{Classifier, CreateTaskInput, HistoryEntry, Panel, PanelState, Project, Task};
use crate::util::{now_local_iso, parse_hashtags};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

async fn fetch_panels(pool: &SqlitePool) -> Result<Vec<Panel>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, sort_order, created_at, archived FROM panel ORDER BY sort_order, created_at",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Panel {
            id: r.get("id"),
            title: r.get("title"),
            sort_order: r.get("sort_order"),
            created_at: r.get("created_at"),
            archived: r.get::<i64, _>("archived") != 0,
        })
        .collect())
}

async fn fetch_classifiers(pool: &SqlitePool) -> Result<Vec<Classifier>, sqlx::Error> {
    let rows = sqlx::query("SELECT id, name FROM classifier ORDER BY name")
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(|r| Classifier {
            id: r.get("id"),
            name: r.get("name"),
        })
        .collect())
}

async fn fetch_projects(pool: &SqlitePool, panel_id: &str) -> Result<Vec<Project>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, label, color_accent, icon, sort_order, panel_id FROM project WHERE panel_id = ? ORDER BY sort_order, label",
    )
    .bind(panel_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Project {
            id: r.get("id"),
            label: r.get("label"),
            color_accent: r.get("color_accent"),
            icon: r.get("icon"),
            sort_order: r.get("sort_order"),
            panel_id: r.get("panel_id"),
        })
        .collect())
}

async fn fetch_tasks(pool: &SqlitePool, panel_id: &str) -> Result<Vec<Task>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT t.id, t.content, t.completed, t.created_at, t.completed_at, t.project_id, t.classifier, t.sort_order, t.parent_task_id \
         FROM task t JOIN project p ON p.id = t.project_id \
         WHERE p.panel_id = ? AND t.completed = 0 \
         ORDER BY p.sort_order, t.sort_order, t.created_at",
    )
    .bind(panel_id)
    .fetch_all(pool)
    .await?;

    let tag_rows = sqlx::query(
        "SELECT th.task_id, h.name \
         FROM task_hashtag th \
         JOIN hashtag h ON h.id = th.hashtag_id \
         JOIN task t ON t.id = th.task_id \
         JOIN project p ON p.id = t.project_id \
         WHERE p.panel_id = ? AND t.completed = 0",
    )
    .bind(panel_id)
    .fetch_all(pool)
    .await?;

    let mut tag_map: HashMap<String, Vec<String>> = HashMap::new();
    for r in tag_rows {
        let task_id: String = r.get("task_id");
        let name: String = r.get("name");
        tag_map.entry(task_id).or_default().push(name);
    }

    Ok(rows
        .into_iter()
        .map(|r| {
            let id: String = r.get("id");
            Task {
                hashtags: tag_map.remove(&id).unwrap_or_default(),
                id,
                content: r.get("content"),
                completed: r.get::<i64, _>("completed") != 0,
                created_at: r.get("created_at"),
                completed_at: r.get("completed_at"),
                project_id: r.get("project_id"),
                classifier: r.get("classifier"),
                sort_order: r.get("sort_order"),
                parent_task_id: r.get("parent_task_id"),
            }
        })
        .collect())
}

async fn build_panel_state(pool: &SqlitePool, panel_id: &str) -> Result<PanelState, sqlx::Error> {
    let panels = fetch_panels(pool).await?;
    let projects = fetch_projects(pool, panel_id).await?;
    let classifiers = fetch_classifiers(pool).await?;
    let tasks = fetch_tasks(pool, panel_id).await?;
    Ok(PanelState {
        active_panel_id: panel_id.to_string(),
        created_task_id: None,
        panels,
        projects,
        classifiers,
        tasks,
    })
}

async fn panel_id_for_task(
    pool: &SqlitePool,
    task_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT p.panel_id FROM task t JOIN project p ON p.id = t.project_id WHERE t.id = ?",
    )
    .bind(task_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.get("panel_id")))
}

async fn panel_id_for_project(pool: &SqlitePool, project_id: &str) -> Result<String, sqlx::Error> {
    let row = sqlx::query("SELECT panel_id FROM project WHERE id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await?;
    Ok(row.get("panel_id"))
}

async fn require_active_panel(conn: &mut SqliteConnection, panel_id: &str) -> CmdResult<()> {
    let active: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM panel WHERE id = ? AND archived = 0")
            .bind(panel_id)
            .fetch_one(conn)
            .await
            .map_err(err)?;
    if active == 0 {
        return Err("Panel not found or archived".into());
    }
    Ok(())
}

async fn active_project_panel(conn: &mut SqliteConnection, project_id: &str) -> CmdResult<String> {
    let panel: Option<String> = sqlx::query_scalar("SELECT panel_id FROM project WHERE id = ?")
        .bind(project_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(err)?;
    let panel = panel.ok_or("Project not found")?;
    require_active_panel(conn, &panel).await?;
    Ok(panel)
}

async fn active_task_owner(
    conn: &mut SqliteConnection,
    task_id: &str,
) -> CmdResult<(String, String)> {
    let project: Option<String> = sqlx::query_scalar(
        "SELECT project_id FROM task WHERE id = ? AND completed = 0 AND project_id IS NOT NULL",
    )
    .bind(task_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(err)?;
    let project = project.ok_or("Active task with a project not found")?;
    let panel = active_project_panel(conn, &project).await?;
    Ok((project, panel))
}

async fn relocate_subtree(
    conn: &mut SqliteConnection,
    task_id: &str,
    project_id: &str,
    parent_task_id: Option<&str>,
) -> CmdResult<()> {
    let sort: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task WHERE project_id = ? AND parent_task_id IS ?",
    ).bind(project_id).bind(parent_task_id).fetch_one(&mut *conn).await.map_err(err)?;
    sqlx::query(
        "WITH RECURSIVE subtree(id) AS (SELECT id FROM task WHERE id = ? \
         UNION SELECT t.id FROM task t JOIN subtree s ON t.parent_task_id = s.id) \
         UPDATE task SET project_id = ? WHERE id IN (SELECT id FROM subtree)",
    )
    .bind(task_id)
    .bind(project_id)
    .execute(&mut *conn)
    .await
    .map_err(err)?;
    sqlx::query("UPDATE task SET parent_task_id = ?, sort_order = ? WHERE id = ?")
        .bind(parent_task_id)
        .bind(sort)
        .bind(task_id)
        .execute(conn)
        .await
        .map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rename_panel(
    panel_id: String,
    title: String,
    state: State<'_, AppState>,
) -> CmdResult<Vec<Panel>> {
    rename_panel_inner(&state.pool, &panel_id, &title).await
}

async fn rename_panel_inner(
    pool: &SqlitePool,
    panel_id: &str,
    title: &str,
) -> CmdResult<Vec<Panel>> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Panel title cannot be empty".into());
    }
    let result = sqlx::query("UPDATE panel SET title = ? WHERE id = ?")
        .bind(title)
        .bind(panel_id)
        .execute(pool)
        .await
        .map_err(err)?;
    if result.rows_affected() == 0 {
        return Err("Panel not found".into());
    }
    fetch_panels(pool).await.map_err(err)
}

/// Permanently deletes a panel and all of its projects, tasks, and history.
/// The last remaining panel is protected so the workspace cannot become unusable.
#[tauri::command]
pub async fn delete_panel(panel_id: String, state: State<'_, AppState>) -> CmdResult<PanelState> {
    delete_panel_inner(&state.pool, &panel_id).await
}

async fn delete_panel_inner(pool: &SqlitePool, panel_id: &str) -> CmdResult<PanelState> {
    let mut tx = pool.begin().await.map_err(err)?;
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM panel WHERE id = ?")
        .bind(panel_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(err)?;
    if exists.is_none() {
        return Err("Panel not found".into());
    }

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM panel")
        .fetch_one(&mut *tx)
        .await
        .map_err(err)?;
    if total <= 1 {
        return Err("Cannot delete the last panel".into());
    }

    // Delete the panel's tasks explicitly: project deletion would only set
    // task.project_id to NULL because of the schema's ON DELETE SET NULL.
    sqlx::query("DELETE FROM task WHERE project_id IN (SELECT id FROM project WHERE panel_id = ?)")
        .bind(panel_id)
        .execute(&mut *tx)
        .await
        .map_err(err)?;

    let deleted = sqlx::query("DELETE FROM panel WHERE id = ?")
        .bind(panel_id)
        .execute(&mut *tx)
        .await
        .map_err(err)?;
    if deleted.rows_affected() == 0 {
        return Err("Panel not found".into());
    }

    // Prefer an active panel. If every remaining panel was archived, restore
    // the first one so deleting the current panel cannot leave the workspace
    // without an active panel.
    let fallback: Option<String> = sqlx::query_scalar(
        "SELECT id FROM panel WHERE archived = 0 ORDER BY sort_order, created_at LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(err)?;
    let fallback = match fallback {
        Some(id) => id,
        None => {
            let id: String =
                sqlx::query_scalar("SELECT id FROM panel ORDER BY sort_order, created_at LIMIT 1")
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(err)?;
            sqlx::query("UPDATE panel SET archived = 0 WHERE id = ?")
                .bind(&id)
                .execute(&mut *tx)
                .await
                .map_err(err)?;
            id
        }
    };

    tx.commit().await.map_err(err)?;
    build_panel_state(pool, &fallback).await.map_err(err)
}

#[tauri::command]
pub async fn move_project(
    project_id: String,
    target_panel_id: String,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    move_project_inner(&state.pool, &project_id, &target_panel_id).await
}

async fn move_project_inner(
    pool: &SqlitePool,
    project_id: &str,
    target_panel_id: &str,
) -> CmdResult<PanelState> {
    let mut tx = pool.begin().await.map_err(err)?;
    require_active_panel(&mut tx, target_panel_id).await?;
    let source: String = sqlx::query_scalar("SELECT panel_id FROM project WHERE id = ?")
        .bind(project_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(err)?
        .ok_or("Project not found")?;
    if source != target_panel_id {
        sqlx::query("UPDATE project SET panel_id = ?, sort_order = \
            (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM project WHERE panel_id = ?) WHERE id = ?")
            .bind(target_panel_id).bind(target_panel_id).bind(project_id)
            .execute(&mut *tx).await.map_err(err)?;
    }
    tx.commit().await.map_err(err)?;
    // IPC refreshes the source panel so the moved project disappears there.
    build_panel_state(pool, &source).await.map_err(err)
}

#[tauri::command]
pub async fn set_project_icon(
    project_id: String,
    icon: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    set_project_icon_inner(&state.pool, &project_id, icon.as_deref()).await
}

async fn set_project_icon_inner(
    pool: &SqlitePool,
    project_id: &str,
    icon: Option<&str>,
) -> CmdResult<PanelState> {
    const ICONS: &[&str] = &[
        "folder",
        "code",
        "flask",
        "book",
        "briefcase",
        "leaf",
        "star",
        "target",
        "rocket",
        "heart",
    ];
    if icon.is_some_and(|value| !ICONS.contains(&value)) {
        return Err("Invalid project icon".into());
    }
    let mut tx = pool.begin().await.map_err(err)?;
    let panel: String = sqlx::query_scalar("SELECT panel_id FROM project WHERE id = ?")
        .bind(project_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(err)?
        .ok_or("Project not found")?;
    sqlx::query("UPDATE project SET icon = ? WHERE id = ?")
        .bind(icon)
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(err)?;
    tx.commit().await.map_err(err)?;
    build_panel_state(pool, &panel).await.map_err(err)
}

/// Ensures a default panel exists and returns the full state of the active panel.
#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> CmdResult<PanelState> {
    let pool = &state.pool;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM panel")
        .fetch_one(pool)
        .await
        .map_err(err)?;

    let active_panel_id = if count == 0 {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO panel (id, title, sort_order, created_at, archived) VALUES (?, ?, 0, ?, 0)")
            .bind(&id)
            .bind("Inicio")
            .bind(now_local_iso())
            .execute(pool)
            .await
            .map_err(err)?;
        id
    } else {
        let id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM panel WHERE archived = 0 ORDER BY sort_order, created_at LIMIT 1",
        )
        .fetch_one(pool)
        .await
        .map_err(err)?;
        id.unwrap_or_default()
    };

    build_panel_state(pool, &active_panel_id).await.map_err(err)
}

#[tauri::command]
pub async fn load_state(panel_id: String, state: State<'_, AppState>) -> CmdResult<PanelState> {
    build_panel_state(&state.pool, &panel_id).await.map_err(err)
}

#[tauri::command]
pub async fn list_history(
    panel_id: String,
    state: State<'_, AppState>,
) -> CmdResult<Vec<HistoryEntry>> {
    let rows = sqlx::query(
        "SELECT id, panel_id, task_id, classifier, project_label, snapshot_content, created_at, completed_at \
         FROM history_entry WHERE panel_id = ? ORDER BY completed_at DESC, created_at DESC",
    )
    .bind(&panel_id)
    .fetch_all(&state.pool)
    .await
    .map_err(err)?;

    Ok(rows
        .into_iter()
        .map(|r| HistoryEntry {
            id: r.get("id"),
            panel_id: r.get("panel_id"),
            task_id: r.get("task_id"),
            classifier: r.get("classifier"),
            project_label: r.get("project_label"),
            snapshot_content: r.get("snapshot_content"),
            created_at: r.get("created_at"),
            completed_at: r.get("completed_at"),
        })
        .collect())
}

#[tauri::command]
pub async fn create_panel(title: String, state: State<'_, AppState>) -> CmdResult<PanelState> {
    let pool = &state.pool;
    let id = Uuid::new_v4().to_string();
    let sort_order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM panel")
        .fetch_one(pool)
        .await
        .map_err(err)?;

    sqlx::query(
        "INSERT INTO panel (id, title, sort_order, created_at, archived) VALUES (?, ?, ?, ?, 0)",
    )
    .bind(&id)
    .bind(&title)
    .bind(sort_order)
    .bind(now_local_iso())
    .execute(pool)
    .await
    .map_err(err)?;

    build_panel_state(pool, &id).await.map_err(err)
}

#[tauri::command]
pub async fn create_project(
    panel_id: String,
    label: String,
    color_accent: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    let pool = &state.pool;
    let id = Uuid::new_v4().to_string();

    let sort_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM project WHERE panel_id = ?",
    )
    .bind(&panel_id)
    .fetch_one(pool)
    .await
    .map_err(err)?;

    sqlx::query(
        "INSERT INTO project (id, label, color_accent, sort_order, panel_id) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&label)
    .bind(&color_accent)
    .bind(sort_order)
    .bind(&panel_id)
    .execute(pool)
    .await
    .map_err(err)?;

    build_panel_state(pool, &panel_id).await.map_err(err)
}

#[tauri::command]
pub async fn create_task(
    input: CreateTaskInput,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    create_task_inner(&state.pool, input).await
}

async fn create_task_inner(pool: &SqlitePool, input: CreateTaskInput) -> CmdResult<PanelState> {
    let id = Uuid::new_v4().to_string();
    let created_at = now_local_iso();
    let mut tx = pool.begin().await.map_err(err)?;
    require_active_panel(&mut tx, &input.panel_id).await?;
    let project_id = if let Some(parent) = input.parent_task_id.as_deref() {
        let (project, panel) = active_task_owner(&mut tx, parent).await?;
        if panel != input.panel_id {
            return Err("Parent task belongs to another panel".into());
        }
        // The parent is authoritative, including when IPC supplies a stale project.
        project
    } else if let Some(project) = input.project_id.as_deref() {
        let panel = active_project_panel(&mut tx, project).await?;
        if panel != input.panel_id {
            return Err("Project belongs to another panel".into());
        }
        project.to_string()
    } else {
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM project WHERE panel_id = ? AND label = 'Inbox' LIMIT 1",
        )
        .bind(&input.panel_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(err)?;
        match existing {
            Some(project) => project,
            None => {
                let project = Uuid::new_v4().to_string();
                sqlx::query("INSERT INTO project (id, label, sort_order, panel_id) \
                    SELECT ?, 'Inbox', COALESCE(MAX(sort_order), -1) + 1, ? FROM project WHERE panel_id = ?")
                    .bind(&project).bind(&input.panel_id).bind(&input.panel_id)
                    .execute(&mut *tx).await.map_err(err)?;
                project
            }
        }
    };

    if let Some(cls) = input.classifier.as_deref() {
        let name = cls.trim().to_uppercase();
        if !name.is_empty() {
            sqlx::query("INSERT OR IGNORE INTO classifier (id, name) VALUES (?, ?)")
                .bind(format!("cls-{}", name))
                .bind(&name)
                .execute(&mut *tx)
                .await
                .map_err(err)?;
        }
    }

    let sort_order: i64 = match &input.parent_task_id {
        Some(parent) => sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task WHERE project_id = ? AND parent_task_id = ?",
        )
        .bind(&project_id)
        .bind(parent)
        .fetch_one(&mut *tx)
        .await
        .map_err(err)?,
        None => sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task WHERE project_id = ? AND parent_task_id IS NULL",
        )
        .bind(&project_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(err)?,
    };

    sqlx::query(
        "INSERT INTO task (id, content, completed, created_at, completed_at, project_id, classifier, sort_order, parent_task_id) \
         VALUES (?, ?, 0, ?, NULL, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.content)
    .bind(&created_at)
    .bind(&project_id)
    .bind(&input.classifier)
    .bind(sort_order)
    .bind(&input.parent_task_id)
    .execute(&mut *tx)
    .await
    .map_err(err)?;

    for tag in parse_hashtags(&input.content) {
        sqlx::query("INSERT OR IGNORE INTO hashtag (id, name) VALUES (?, ?)")
            .bind(Uuid::new_v4().to_string())
            .bind(&tag)
            .execute(&mut *tx)
            .await
            .map_err(err)?;
        sqlx::query("INSERT OR IGNORE INTO task_hashtag (task_id, hashtag_id) SELECT ?, id FROM hashtag WHERE name = ?")
            .bind(&id).bind(&tag).execute(&mut *tx).await.map_err(err)?;
    }
    tx.commit().await.map_err(err)?;
    let mut snapshot = build_panel_state(pool, &input.panel_id)
        .await
        .map_err(err)?;
    snapshot.created_task_id = Some(id);
    Ok(snapshot)
}

#[tauri::command]
pub async fn update_task(
    task_id: String,
    content: String,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    let pool = &state.pool;

    sqlx::query("UPDATE task SET content = ? WHERE id = ?")
        .bind(&content)
        .bind(&task_id)
        .execute(pool)
        .await
        .map_err(err)?;

    import::sync_hashtags(pool, &task_id, &content)
        .await
        .map_err(err)?;

    let panel_id = panel_id_for_task(pool, &task_id)
        .await
        .map_err(err)?
        .unwrap_or_default();
    build_panel_state(pool, &panel_id).await.map_err(err)
}

#[tauri::command]
pub async fn set_task_classifier(
    task_id: String,
    classifier: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    let pool = &state.pool;

    let normalized = classifier
        .map(|value| value.trim().to_uppercase())
        .filter(|value| !value.is_empty());

    if let Some(name) = normalized.as_deref() {
        ensure_classifier(pool, name).await.map_err(err)?;
    }

    sqlx::query("UPDATE task SET classifier = ? WHERE id = ?")
        .bind(normalized.as_deref())
        .bind(&task_id)
        .execute(pool)
        .await
        .map_err(err)?;

    let panel_id = panel_id_for_task(pool, &task_id)
        .await
        .map_err(err)?
        .unwrap_or_default();
    build_panel_state(pool, &panel_id).await.map_err(err)
}

#[tauri::command]
pub async fn delete_task(task_id: String, state: State<'_, AppState>) -> CmdResult<PanelState> {
    let pool = &state.pool;
    let panel_id = panel_id_for_task(pool, &task_id)
        .await
        .map_err(err)?
        .unwrap_or_default();

    sqlx::query("DELETE FROM task WHERE id = ?")
        .bind(&task_id)
        .execute(pool)
        .await
        .map_err(err)?;

    build_panel_state(pool, &panel_id).await.map_err(err)
}

/// Completes only the requested task, rejecting pending descendants.
#[tauri::command]
pub async fn complete_task(task_id: String, state: State<'_, AppState>) -> CmdResult<PanelState> {
    let pool = &state.pool;
    let panel_id = match complete_task_inner(pool, &task_id).await? {
        Some(pid) => pid,
        None => {
            let pid: Option<String> = sqlx::query_scalar(
                "SELECT id FROM panel WHERE archived = 0 ORDER BY sort_order, created_at LIMIT 1",
            )
            .fetch_one(pool)
            .await
            .map_err(err)?;
            pid.unwrap_or_default()
        }
    };
    build_panel_state(pool, &panel_id).await.map_err(err)
}

async fn complete_task_inner(pool: &SqlitePool, task_id: &str) -> CmdResult<Option<String>> {
    let mut tx = pool.begin().await.map_err(err)?;
    let pending: i64 = sqlx::query_scalar(
        "WITH RECURSIVE descendants(id) AS ( \
             SELECT id FROM task WHERE parent_task_id = ? \
             UNION SELECT t.id FROM task t JOIN descendants d ON t.parent_task_id = d.id \
         ) SELECT COUNT(*) FROM task WHERE id IN (SELECT id FROM descendants) AND completed = 0",
    )
    .bind(task_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(err)?;
    if pending > 0 {
        return Err("Cannot complete a task with pending children".into());
    }
    let panel_id = move_to_history(&mut tx, task_id, &now_local_iso())
        .await
        .map_err(err)?;
    tx.commit().await.map_err(err)?;
    Ok(panel_id)
}

async fn move_to_history(
    conn: &mut SqliteConnection,
    task_id: &str,
    completed_at: &str,
) -> Result<Option<String>, sqlx::Error> {
    let task = sqlx::query("SELECT content, project_id, classifier, created_at FROM task WHERE id = ? AND completed = 0")
            .bind(task_id)
            .fetch_optional(&mut *conn)
            .await?;

    let Some(task) = task else {
        return Ok(None);
    };

    let content: String = task.get("content");
    let created_at: String = task.get("created_at");
    let project_id: Option<String> = task.get("project_id");
    let classifier: Option<String> = task.get("classifier");

    let project = sqlx::query("SELECT label, panel_id FROM project WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&mut *conn)
        .await?;

    let panel_id: Option<String> = match project {
        Some(p) => {
            let label: Option<String> = p.get("label");
            let panel_id: String = p.get("panel_id");

            let history_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO history_entry (id, panel_id, task_id, classifier, project_label, snapshot_content, created_at, completed_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&history_id)
            .bind(&panel_id)
            .bind(task_id)
            .bind(&classifier)
            .bind(&label)
            .bind(&content)
            .bind(&created_at)
            .bind(completed_at)
            .execute(&mut *conn)
            .await?;

            Some(panel_id)
        }
        None => return Err(sqlx::Error::RowNotFound),
    };

    // Keep legacy completed descendants intact instead of triggering ON DELETE CASCADE.
    sqlx::query("UPDATE task SET parent_task_id = NULL WHERE parent_task_id = ?")
        .bind(task_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM task_hashtag WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM task WHERE id = ?")
        .bind(task_id)
        .execute(&mut *conn)
        .await?;

    Ok(panel_id)
}

async fn ensure_inbox_project(pool: &SqlitePool, panel_id: &str) -> Result<String, sqlx::Error> {
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM project WHERE panel_id = ? AND label = 'Inbox' LIMIT 1")
            .bind(panel_id)
            .fetch_optional(pool)
            .await?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO project (id, label, color_accent, sort_order, panel_id) VALUES (?, 'Inbox', NULL, 0, ?)",
    )
    .bind(&id)
    .bind(panel_id)
    .execute(pool)
    .await?;

    Ok(id)
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

/// Finds a project by label (first match), or creates it. Returns its id.
async fn find_or_create_project_by_label(
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

#[tauri::command]
pub async fn set_task_parent(
    task_id: String,
    parent_task_id: Option<String>,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    set_task_parent_inner(&state.pool, &task_id, parent_task_id.as_deref()).await
}

async fn set_task_parent_inner(
    pool: &SqlitePool,
    task_id: &str,
    parent_task_id: Option<&str>,
) -> CmdResult<PanelState> {
    let mut tx = pool.begin().await.map_err(err)?;
    let (mut project_id, panel_id) = active_task_owner(&mut tx, task_id).await?;
    if let Some(parent) = parent_task_id {
        let cycle: i64 = sqlx::query_scalar(
            "WITH RECURSIVE subtree(id) AS (SELECT id FROM task WHERE id = ? \
             UNION SELECT t.id FROM task t JOIN subtree s ON t.parent_task_id = s.id) \
             SELECT COUNT(*) FROM subtree WHERE id = ?",
        )
        .bind(task_id)
        .bind(parent)
        .fetch_one(&mut *tx)
        .await
        .map_err(err)?;
        if cycle > 0 {
            return Err("A task cannot be parented to itself or a descendant".into());
        }
        let (parent_project, parent_panel) = active_task_owner(&mut tx, parent).await?;
        if parent_panel != panel_id {
            return Err("Parent task belongs to another panel".into());
        }
        project_id = parent_project;
    }
    relocate_subtree(&mut tx, task_id, &project_id, parent_task_id).await?;
    tx.commit().await.map_err(err)?;
    build_panel_state(pool, &panel_id).await.map_err(err)
}

/// Moves a task (and its descendants) to another project, appending it at the end.
#[tauri::command]
pub async fn move_task(
    task_id: String,
    project_id: String,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    move_task_inner(&state.pool, &task_id, &project_id).await
}

async fn move_task_inner(
    pool: &SqlitePool,
    task_id: &str,
    project_id: &str,
) -> CmdResult<PanelState> {
    let mut tx = pool.begin().await.map_err(err)?;
    active_task_owner(&mut tx, task_id).await?;
    let panel_id = active_project_panel(&mut tx, project_id).await?;
    relocate_subtree(&mut tx, task_id, project_id, None).await?;
    tx.commit().await.map_err(err)?;
    build_panel_state(pool, &panel_id).await.map_err(err)
}

#[tauri::command]
pub async fn set_panel_archived(
    panel_id: String,
    archived: bool,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    let pool = &state.pool;
    sqlx::query("UPDATE panel SET archived = ? WHERE id = ?")
        .bind(archived as i64)
        .bind(&panel_id)
        .execute(pool)
        .await
        .map_err(err)?;

    let active_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM panel WHERE archived = 0 ORDER BY sort_order, created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(err)?;

    build_panel_state(pool, active_id.as_deref().unwrap_or(&panel_id))
        .await
        .map_err(err)
}

/// Restores a completed task from history back into the active list.
#[tauri::command]
pub async fn restore_task(history_id: String, state: State<'_, AppState>) -> CmdResult<PanelState> {
    let pool = &state.pool;
    let row = sqlx::query(
        "SELECT panel_id, classifier, project_label, snapshot_content, created_at FROM history_entry WHERE id = ?",
    )
    .bind(&history_id)
    .fetch_optional(pool)
    .await
    .map_err(err)?;

    let Some(row) = row else {
        return Err("history entry not found".to_string());
    };

    let panel_id: String = row.get("panel_id");
    let classifier: Option<String> = row.get("classifier");
    let project_label: Option<String> = row.get("project_label");
    let content: String = row.get("snapshot_content");
    let created_at: String = row.get("created_at");

    let project_id = match project_label {
        Some(label) => find_or_create_project_by_label(pool, &panel_id, &label)
            .await
            .map_err(err)?,
        None => ensure_inbox_project(pool, &panel_id).await.map_err(err)?,
    };

    let sort_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task WHERE project_id = ? AND parent_task_id IS NULL",
    )
    .bind(&project_id)
    .fetch_one(pool)
    .await
    .map_err(err)?;

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO task (id, content, completed, created_at, completed_at, project_id, classifier, sort_order, parent_task_id) \
         VALUES (?, ?, 0, ?, NULL, ?, ?, ?, NULL)",
    )
    .bind(&id)
    .bind(&content)
    .bind(&created_at)
    .bind(&project_id)
    .bind(&classifier)
    .bind(sort_order)
    .execute(pool)
    .await
    .map_err(err)?;

    import::sync_hashtags(pool, &id, &content)
        .await
        .map_err(err)?;

    sqlx::query("DELETE FROM history_entry WHERE id = ?")
        .bind(&history_id)
        .execute(pool)
        .await
        .map_err(err)?;

    build_panel_state(pool, &panel_id).await.map_err(err)
}

/// Exports a panel (active tasks + history) as a Markdown string.
#[tauri::command]
pub async fn export_markdown(panel_id: String, state: State<'_, AppState>) -> CmdResult<String> {
    let pool = &state.pool;

    let title: String = sqlx::query_scalar("SELECT title FROM panel WHERE id = ?")
        .bind(&panel_id)
        .fetch_one(pool)
        .await
        .map_err(err)?;

    let projects = fetch_projects(pool, &panel_id).await.map_err(err)?;

    let rows = sqlx::query(
        "SELECT id, content, created_at, project_id, classifier, parent_task_id FROM task \
         WHERE project_id IN (SELECT id FROM project WHERE panel_id = ?) AND completed = 0 \
         ORDER BY project_id, sort_order",
    )
    .bind(&panel_id)
    .fetch_all(pool)
    .await
    .map_err(err)?;

    let mut children: HashMap<String, Vec<(String, String, String, Option<String>)>> =
        HashMap::new();
    let mut roots: Vec<(String, String, String, String, Option<String>)> = Vec::new();
    for r in rows {
        let id: String = r.get("id");
        let content: String = r.get("content");
        let created_at: String = r.get("created_at");
        let project_id: String = r.get("project_id");
        let classifier: Option<String> = r.get("classifier");
        let parent: Option<String> = r.get("parent_task_id");
        match parent {
            Some(p) => children
                .entry(p)
                .or_default()
                .push((id, content, created_at, classifier)),
            None => roots.push((id, content, created_at, project_id, classifier)),
        }
    }

    let history_rows = sqlx::query(
        "SELECT classifier, snapshot_content, created_at, completed_at FROM history_entry \
         WHERE panel_id = ? ORDER BY completed_at DESC, created_at DESC",
    )
    .bind(&panel_id)
    .fetch_all(pool)
    .await
    .map_err(err)?;

    let mut out = String::new();
    out.push_str(&format!("# {}\n", title));

    for proj in &projects {
        out.push_str(&format!("\n## {}\n", proj.label));
        for root in roots.iter().filter(|r| r.3 == proj.id) {
            emit_task(&mut out, &root.0, &root.1, &root.2, &root.4, &children, 0);
        }
    }

    if !history_rows.is_empty() {
        out.push_str("\n## Historial\n");
        for h in history_rows {
            let classifier: Option<String> = h.get("classifier");
            let content: String = h.get("snapshot_content");
            let created_at: String = h.get("created_at");
            let completed_at: String = h.get("completed_at");
            out.push_str(&format!(
                "- [x] {} | **{}** | {} ✅ {}\n",
                date10(&created_at),
                classifier.unwrap_or_default(),
                content,
                date10(&completed_at),
            ));
        }
    }

    Ok(out)
}

fn date10(s: &str) -> String {
    s.chars().take(10).collect()
}

#[allow(clippy::too_many_arguments)]
fn emit_task(
    out: &mut String,
    id: &str,
    content: &str,
    created_at: &str,
    classifier: &Option<String>,
    children: &HashMap<String, Vec<(String, String, String, Option<String>)>>,
    depth: usize,
) {
    let indent = "\t".repeat(depth);
    out.push_str(&format!(
        "{}- [ ] {} | **{}** | {}\n",
        indent,
        date10(created_at),
        classifier.as_deref().unwrap_or(""),
        content,
    ));
    if let Some(ch) = children.get(id) {
        for (cid, ccontent, ccreated, cclass) in ch {
            emit_task(out, cid, ccontent, ccreated, cclass, children, depth + 1);
        }
    }
}

/// Reorders the projects of a panel given their new id order.
#[tauri::command]
pub async fn reorder_projects(
    panel_id: String,
    ordered_ids: Vec<String>,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    let pool = &state.pool;
    for (idx, id) in ordered_ids.iter().enumerate() {
        sqlx::query("UPDATE project SET sort_order = ? WHERE id = ? AND panel_id = ?")
            .bind(idx as i64)
            .bind(id)
            .bind(&panel_id)
            .execute(pool)
            .await
            .map_err(err)?;
    }
    build_panel_state(pool, &panel_id).await.map_err(err)
}

/// Reorders the tasks of a single project given their new id order.
#[tauri::command]
pub async fn reorder_project_tasks(
    project_id: String,
    ordered_ids: Vec<String>,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    let pool = &state.pool;
    let panel_id = panel_id_for_project(pool, &project_id).await.map_err(err)?;

    for (idx, task_id) in ordered_ids.iter().enumerate() {
        sqlx::query("UPDATE task SET sort_order = ? WHERE id = ? AND project_id = ?")
            .bind(idx as i64)
            .bind(task_id)
            .bind(&project_id)
            .execute(pool)
            .await
            .map_err(err)?;
    }

    build_panel_state(pool, &panel_id).await.map_err(err)
}

/// Reads a UTF-8 text file chosen in the file dialog.
///
/// Reading in the backend avoids depending on the fs plugin scope for paths
/// the user picks outside the application directories.
#[tauri::command]
pub async fn read_text_file(path: String) -> CmdResult<String> {
    let shown = path.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(err)?
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .map_err(|e| format!("{}: {e}", shown))
}

/// One entry of a directory listing for the in-app file picker.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Shortcut shown in the picker sidebar.
#[derive(serde::Serialize)]
pub struct PlaceInfo {
    pub kind: String,
    pub path: String,
}

const DIR_LIST_LIMIT: usize = 2000;

/// Lists a directory without going through the Windows shell dialog.
///
/// The native picker depends on the shell namespace, which can block on cloud
/// providers and on the search index. Plain directory reads cannot hang the UI.
#[tauri::command]
pub async fn list_dir(path: String) -> CmdResult<Vec<DirEntryInfo>> {
    let shown = path.clone();
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<Vec<DirEntryInfo>> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(&path)?.flatten().take(DIR_LIST_LIMIT) {
            let is_dir = match entry.file_type() {
                Ok(kind) => kind.is_dir(),
                Err(_) => continue,
            };
            entries.push(DirEntryInfo {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                is_dir,
            });
        }
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    })
    .await
    .map_err(err)?
    .map_err(|e| format!("{}: {e}", shown))
}

/// Well-known folders offered as picker shortcuts.
#[tauri::command]
pub fn user_places(app: tauri::AppHandle) -> Vec<PlaceInfo> {
    use tauri::Manager;

    let paths = app.path();
    let mut places: Vec<PlaceInfo> = Vec::new();
    let mut push = |kind: &str, dir: Option<std::path::PathBuf>| {
        if let Some(dir) = dir {
            let path = dir.to_string_lossy().into_owned();
            if !places.iter().any(|p| p.path == path) {
                places.push(PlaceInfo {
                    kind: kind.to_string(),
                    path,
                });
            }
        }
    };

    push("home", paths.home_dir().ok());
    push("documents", paths.document_dir().ok());
    push("desktop", paths.desktop_dir().ok());
    push("downloads", paths.download_dir().ok());

    if let Ok(resources) = paths.resource_dir() {
        let examples = resources.join("examples");
        if examples.is_dir() {
            push("examples", Some(examples));
        }
    }

    places
}

/// Writes UTF-8 text chosen in the picker.
#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> CmdResult<()> {
    let shown = path.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&path, contents))
        .await
        .map_err(err)?
        .map_err(|e| format!("{}: {e}", shown))
}

/// Starting directory for the import dialog.
///
/// Pointing the native dialog at a plain filesystem folder keeps the shell
/// from resolving Quick Access, cloud folders, or the search index, which can
/// block the picker on Windows.
#[tauri::command]
pub fn import_default_dir(app: tauri::AppHandle) -> Option<String> {
    use tauri::Manager;

    if let Ok(resources) = app.path().resource_dir() {
        let examples = resources.join("examples");
        if examples.is_dir() {
            return Some(examples.to_string_lossy().into_owned());
        }
    }

    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .ok()
        .map(|dir| dir.to_string_lossy().into_owned())
}

/// Imports an Obsidian-style Markdown document into the given panel.
#[tauri::command]
pub async fn import_markdown(
    panel_id: String,
    markdown: String,
    state: State<'_, AppState>,
) -> CmdResult<PanelState> {
    import::import_markdown(&state.pool, &panel_id, &markdown)
        .await
        .map_err(err)?;

    build_panel_state(&state.pool, &panel_id).await.map_err(err)
}

// ---------------------------------------------------------------------------
// Classifiers (global)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_classifiers(state: State<'_, AppState>) -> CmdResult<Vec<Classifier>> {
    fetch_classifiers(&state.pool).await.map_err(err)
}

#[tauri::command]
pub async fn create_classifier(
    name: String,
    state: State<'_, AppState>,
) -> CmdResult<Vec<Classifier>> {
    let pool = &state.pool;
    ensure_classifier(pool, &name).await.map_err(err)?;
    fetch_classifiers(pool).await.map_err(err)
}

#[tauri::command]
pub async fn delete_classifier(
    name: String,
    state: State<'_, AppState>,
) -> CmdResult<Vec<Classifier>> {
    let pool = &state.pool;
    sqlx::query("DELETE FROM classifier WHERE name = ?")
        .bind(&name)
        .execute(pool)
        .await
        .map_err(err)?;
    fetch_classifiers(pool).await.map_err(err)
}

/// Convenience: returns the hashtags present in a content string (used by the
/// frontend for autocomplete candidates).
#[tauri::command]
pub async fn hashtags_from(content: String) -> CmdResult<Vec<String>> {
    Ok(parse_hashtags(&content))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    #[tokio::test]
    async fn read_text_file_reads_and_reports_missing_paths() {
        let dir = std::env::temp_dir().join(format!("meyaj-read-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("nota.md");
        std::fs::write(&file, "- [ ] tarea").unwrap();

        let content = read_text_file(file.to_string_lossy().into_owned())
            .await
            .unwrap();
        assert_eq!(content, "- [ ] tarea");

        let missing = read_text_file(dir.join("falta.md").to_string_lossy().into_owned()).await;
        assert!(missing.is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    async fn setup() -> SqlitePool {
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
        sqlx::query(
            "INSERT INTO panel (id, title, created_at, archived) VALUES \
            ('a', 'Origen', '2026-01-01', 0), ('b', 'Destino', '2026-01-02', 0), \
            ('archived', 'Archivo', '2026-01-03', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO project (id, label, panel_id, sort_order) VALUES \
            ('p', 'Proyecto', 'a', 0), ('q', 'Otro', 'a', 1), ('r', 'Destino', 'b', 7), \
            ('old', 'Archivado', 'archived', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn task(pool: &SqlitePool, id: &str, project: &str, parent: Option<&str>) {
        sqlx::query("INSERT INTO task (id, content, created_at, project_id, parent_task_id) VALUES (?, ?, '2026-01-01', ?, ?)")
            .bind(id).bind(format!("{} #regression", id)).bind(project).bind(parent)
            .execute(pool).await.unwrap();
        import::sync_hashtags(pool, id, &format!("{} #regression", id))
            .await
            .unwrap();
    }

    fn input(panel: &str, project: Option<&str>, parent: Option<&str>) -> CreateTaskInput {
        CreateTaskInput {
            panel_id: panel.into(),
            project_id: project.map(str::to_string),
            parent_task_id: parent.map(str::to_string),
            classifier: Some("CODE".into()),
            content: "Child #regression".into(),
        }
    }

    async fn count(pool: &SqlitePool, query: &str) -> i64 {
        sqlx::query_scalar(query).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn deleting_panel_cascades_its_projects_tasks_and_history_only() {
        let pool = setup().await;
        task(&pool, "parent", "p", None).await;
        task(&pool, "child", "p", Some("parent")).await;
        task(&pool, "other", "q", None).await;
        task(&pool, "destination", "r", None).await;
        sqlx::query(
            "INSERT INTO history_entry (id, panel_id, task_id, classifier, project_label, snapshot_content, created_at, completed_at) \
             VALUES ('h1', 'a', NULL, 'CODE', 'Proyecto', 'Archived #regression', '2026-01-01', '2026-01-02'), \
                    ('h2', 'b', NULL, 'CODE', 'Destino', 'Keep #regression', '2026-01-01', '2026-01-02')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let state = delete_panel_inner(&pool, "a").await.unwrap();
        assert_eq!(state.active_panel_id, "b");
        assert_eq!(state.panels.len(), 2);
        assert!(state.panels.iter().all(|panel| panel.id != "a"));
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM project WHERE panel_id = 'a'").await,
            0
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM task WHERE id IN ('parent','child','other')"
            )
            .await,
            0
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM history_entry WHERE panel_id = 'a'"
            )
            .await,
            0
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_hashtag").await, 1);
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM project WHERE id = 'r'").await,
            1
        );
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM task WHERE id = 'destination'").await,
            1
        );
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM history_entry WHERE id = 'h2'").await,
            1
        );
        assert!(state.projects.iter().any(|project| project.id == "r"));
    }

    #[tokio::test]
    async fn deleting_the_last_panel_is_rejected_and_rolls_back() {
        let pool = setup().await;
        delete_panel_inner(&pool, "a").await.unwrap();
        let fallback = delete_panel_inner(&pool, "b").await.unwrap();
        assert_eq!(fallback.active_panel_id, "archived");
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM panel WHERE id = 'archived' AND archived = 0"
            )
            .await,
            1
        );
        assert!(
            delete_panel_inner(&pool, "archived")
                .await
                .unwrap_err()
                .contains("last panel")
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM panel").await, 1);
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM project WHERE panel_id = 'archived'"
            )
            .await,
            1
        );
    }

    #[tokio::test]
    async fn creation_returns_exact_inserted_id_for_identical_tasks() {
        let pool = setup().await;
        task(&pool, "parent", "p", None).await;
        sqlx::query(
            "CREATE TABLE inserted_task (sequence INTEGER PRIMARY KEY, task_id TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TRIGGER record_insert AFTER INSERT ON task BEGIN \
            INSERT INTO inserted_task (task_id) VALUES (NEW.id); END",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut ids = std::collections::HashSet::new();
        for parent in [None, Some("parent")] {
            for _ in 0..2 {
                let response = create_task_inner(&pool, input("a", Some("p"), parent))
                    .await
                    .unwrap();
                let inserted_id: String = sqlx::query_scalar(
                    "SELECT task_id FROM inserted_task ORDER BY sequence DESC LIMIT 1",
                )
                .fetch_one(&pool)
                .await
                .unwrap();
                assert_eq!(
                    response.created_task_id.as_deref(),
                    Some(inserted_id.as_str())
                );
                assert!(ids.insert(inserted_id.clone()));
                let created = response.tasks.iter().find(|t| t.id == inserted_id).unwrap();
                assert_eq!(created.content, "Child #regression");
                assert_eq!(created.project_id.as_deref(), Some("p"));
                assert_eq!(created.parent_task_id.as_deref(), parent);
                let json = serde_json::to_value(&response).unwrap();
                assert_eq!(json["createdTaskId"], inserted_id);
                assert!(json.get("created_task_id").is_none());
            }
        }
        let (first, second) = tokio::join!(
            create_task_inner(&pool, input("a", Some("p"), Some("parent"))),
            create_task_inner(&pool, input("a", Some("p"), Some("parent"))),
        );
        for response in [first.unwrap(), second.unwrap()] {
            let id = response.created_task_id.unwrap();
            assert!(ids.insert(id.clone()));
            assert!(response.tasks.iter().any(|t| t.id == id));
            let persisted: String = sqlx::query_scalar("SELECT content FROM task WHERE id = ?")
                .bind(&id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(persisted, "Child #regression");
        }
        assert_eq!(ids.len(), 6);
    }

    #[tokio::test]
    async fn created_task_id_is_response_only_and_absent_from_other_snapshots() {
        let pool = setup().await;
        let created = create_task_inner(&pool, input("a", Some("p"), None))
            .await
            .unwrap();
        let id = created.created_task_id.unwrap();
        task(&pool, "parent", "q", None).await;
        let snapshots = [
            build_panel_state(&pool, "a").await.unwrap(),
            set_project_icon_inner(&pool, "p", Some("code"))
                .await
                .unwrap(),
            set_task_parent_inner(&pool, &id, Some("parent"))
                .await
                .unwrap(),
            move_task_inner(&pool, &id, "p").await.unwrap(),
            move_project_inner(&pool, "p", "b").await.unwrap(),
            build_panel_state(&pool, "b").await.unwrap(),
        ];
        for snapshot in snapshots {
            assert!(snapshot.created_task_id.is_none());
            assert!(serde_json::to_value(&snapshot).unwrap()["createdTaskId"].is_null());
        }
        complete_task_inner(&pool, &id).await.unwrap();
        assert!(
            build_panel_state(&pool, "b")
                .await
                .unwrap()
                .created_task_id
                .is_none()
        );
    }

    #[tokio::test]
    async fn children_inherit_parent_project_not_ipc_or_inbox() {
        let pool = setup().await;
        task(&pool, "parent", "p", None).await;
        for supplied in [None, Some("q"), Some("r"), Some("missing")] {
            let state = create_task_inner(&pool, input("a", supplied, Some("parent")))
                .await
                .unwrap();
            assert!(
                state
                    .tasks
                    .iter()
                    .all(|t| t.project_id.as_deref() == Some("p"))
            );
            assert!(
                state.tasks.iter().filter(|t| t.id != "parent").all(|t| t
                    .parent_task_id
                    .as_deref()
                    == Some("parent")
                    && t.hashtags == vec!["regression"])
            );
        }
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM project WHERE label = 'Inbox'").await,
            0
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task").await, 5);
    }

    #[tokio::test]
    async fn creation_rejects_missing_completed_cross_panel_and_archived_parents() {
        let pool = setup().await;
        task(&pool, "foreign", "r", None).await;
        task(&pool, "done", "p", None).await;
        task(&pool, "old-task", "old", None).await;
        sqlx::query("UPDATE task SET completed = 1 WHERE id = 'done'")
            .execute(&pool)
            .await
            .unwrap();
        for bad in [
            input("a", Some("p"), Some("missing")),
            input("a", Some("p"), Some("done")),
            input("a", Some("p"), Some("foreign")),
            input("archived", None, Some("old-task")),
            input("a", Some("r"), None),
            input("missing", None, None),
            input("a", Some("missing"), None),
        ] {
            assert!(create_task_inner(&pool, bad).await.is_err());
        }
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task").await, 3);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM project").await, 4);
    }

    #[tokio::test]
    async fn completion_rejects_pending_descendants_and_never_closes_ancestors() {
        let pool = setup().await;
        task(&pool, "parent", "p", None).await;
        task(&pool, "child", "p", Some("parent")).await;
        task(&pool, "grandchild", "p", Some("child")).await;
        assert!(
            complete_task_inner(&pool, "parent")
                .await
                .unwrap_err()
                .contains("pending")
        );
        assert!(complete_task_inner(&pool, "child").await.is_err());
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM history_entry").await, 0);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_hashtag").await, 3);
        assert_eq!(
            complete_task_inner(&pool, "grandchild")
                .await
                .unwrap()
                .as_deref(),
            Some("a")
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task").await, 2);
        complete_task_inner(&pool, "child").await.unwrap();
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM task WHERE id = 'parent' AND completed = 0"
            )
            .await,
            1
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM history_entry").await, 2);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_hashtag").await, 1);
        assert!(complete_task_inner(&pool, "child").await.unwrap().is_none());
        complete_task_inner(&pool, "parent").await.unwrap();
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM history_entry WHERE panel_id = 'a' AND project_label = 'Proyecto'").await, 3);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task").await, 0);
    }

    #[tokio::test]
    async fn completion_rolls_back_history_task_and_hashtags_on_failure() {
        let pool = setup().await;
        task(&pool, "leaf", "p", None).await;
        sqlx::query("CREATE TRIGGER fail_delete BEFORE DELETE ON task BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
            .execute(&pool).await.unwrap();
        assert!(
            complete_task_inner(&pool, "leaf")
                .await
                .unwrap_err()
                .contains("forced failure")
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task").await, 1);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_hashtag").await, 1);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM history_entry").await, 0);
    }

    #[tokio::test]
    async fn reparent_and_move_task_propagate_project_preserving_descendant_links() {
        let pool = setup().await;
        task(&pool, "root", "p", None).await;
        task(&pool, "child", "p", Some("root")).await;
        task(&pool, "grandchild", "p", Some("child")).await;
        task(&pool, "new-parent", "q", None).await;
        assert!(
            set_task_parent_inner(&pool, "root", Some("root"))
                .await
                .is_err()
        );
        assert!(
            set_task_parent_inner(&pool, "root", Some("grandchild"))
                .await
                .is_err()
        );
        assert!(
            set_task_parent_inner(&pool, "root", Some("missing"))
                .await
                .is_err()
        );
        task(&pool, "foreign", "r", None).await;
        assert!(
            set_task_parent_inner(&pool, "root", Some("foreign"))
                .await
                .is_err()
        );
        task(&pool, "done", "q", None).await;
        sqlx::query("UPDATE task SET completed = 1 WHERE id = 'done'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            set_task_parent_inner(&pool, "root", Some("done"))
                .await
                .is_err()
        );
        set_task_parent_inner(&pool, "root", Some("new-parent"))
            .await
            .unwrap();
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task WHERE id IN ('root', 'child', 'grandchild') AND project_id = 'q'").await, 3);
        set_task_parent_inner(&pool, "root", None).await.unwrap();
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task WHERE id = 'root' AND project_id = 'q' AND parent_task_id IS NULL").await, 1);
        assert!(move_task_inner(&pool, "root", "old").await.is_err());
        assert!(move_task_inner(&pool, "missing", "r").await.is_err());
        let state = move_task_inner(&pool, "root", "r").await.unwrap();
        assert_eq!(state.active_panel_id, "b");
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task WHERE id IN ('root', 'child', 'grandchild') AND project_id = 'r'").await, 3);
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM task WHERE id = 'child' AND parent_task_id = 'root'"
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM task WHERE id = 'grandchild' AND parent_task_id = 'child'"
            )
            .await,
            1
        );
        assert_eq!(
            count(&pool, "SELECT sort_order FROM task WHERE id = 'root'").await,
            1
        );
    }

    #[tokio::test]
    async fn subtree_moves_roll_back_project_and_parent_changes_on_failure() {
        let pool = setup().await;
        task(&pool, "root", "p", None).await;
        task(&pool, "child", "p", Some("root")).await;
        task(&pool, "new-parent", "q", None).await;
        sqlx::query(
            "CREATE TRIGGER fail_relocation BEFORE UPDATE OF parent_task_id ON task \
            WHEN OLD.id = 'root' BEGIN SELECT RAISE(ABORT, 'forced relocation failure'); END",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            set_task_parent_inner(&pool, "root", Some("new-parent"))
                .await
                .is_err()
        );
        assert!(move_task_inner(&pool, "root", "r").await.is_err());
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM task WHERE id IN ('root', 'child') AND project_id = 'p'"
            )
            .await,
            2
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM task WHERE id = 'root' AND parent_task_id IS NULL"
            )
            .await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM task WHERE id = 'child' AND parent_task_id = 'root'"
            )
            .await,
            1
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM task_hashtag").await, 3);
    }

    #[tokio::test]
    async fn moving_project_returns_source_and_preserves_tree_ids_icon_and_tags() {
        let pool = setup().await;
        task(&pool, "root", "p", None).await;
        task(&pool, "child", "p", Some("root")).await;
        set_project_icon_inner(&pool, "p", Some("rocket"))
            .await
            .unwrap();
        for target in ["missing", "archived"] {
            assert!(move_project_inner(&pool, "p", target).await.is_err());
        }
        assert!(move_project_inner(&pool, "missing", "b").await.is_err());
        let source = move_project_inner(&pool, "p", "b").await.unwrap();
        assert_eq!(source.active_panel_id, "a");
        assert!(source.projects.iter().all(|p| p.id != "p"));
        assert!(source.tasks.is_empty());
        let destination = build_panel_state(&pool, "b").await.unwrap();
        let project = destination.projects.iter().find(|p| p.id == "p").unwrap();
        assert_eq!(project.sort_order, 8);
        assert_eq!(project.icon.as_deref(), Some("rocket"));
        assert_eq!(destination.tasks.len(), 2);
        assert!(
            destination
                .tasks
                .iter()
                .all(|t| t.project_id.as_deref() == Some("p") && t.hashtags == vec!["regression"])
        );
        assert_eq!(
            destination
                .tasks
                .iter()
                .find(|t| t.id == "child")
                .unwrap()
                .parent_task_id
                .as_deref(),
            Some("root")
        );
        let same = move_project_inner(&pool, "p", "b").await.unwrap();
        assert_eq!(
            same.projects
                .iter()
                .find(|p| p.id == "p")
                .unwrap()
                .sort_order,
            8
        );
    }

    #[tokio::test]
    async fn rename_and_icon_allowlist_persist_and_validate() {
        let pool = setup().await;
        let panels = rename_panel_inner(&pool, "a", "  Trabajo  ").await.unwrap();
        assert_eq!(
            panels.iter().find(|p| p.id == "a").unwrap().title,
            "Trabajo"
        );
        assert!(rename_panel_inner(&pool, "a", " \n ").await.is_err());
        assert!(
            rename_panel_inner(&pool, "missing", "Nombre")
                .await
                .is_err()
        );
        for icon in [
            "folder",
            "code",
            "flask",
            "book",
            "briefcase",
            "leaf",
            "star",
            "target",
            "rocket",
            "heart",
        ] {
            let state = set_project_icon_inner(&pool, "p", Some(icon))
                .await
                .unwrap();
            assert_eq!(state.active_panel_id, "a");
            assert_eq!(
                state
                    .projects
                    .iter()
                    .find(|p| p.id == "p")
                    .unwrap()
                    .icon
                    .as_deref(),
                Some(icon)
            );
        }
        for invalid in ["", "Folder", " rocket ", "custom", "<svg>"] {
            assert!(
                set_project_icon_inner(&pool, "p", Some(invalid))
                    .await
                    .is_err()
            );
        }
        assert_eq!(
            fetch_projects(&pool, "a").await.unwrap()[0].icon.as_deref(),
            Some("heart")
        );
        assert!(
            set_project_icon_inner(&pool, "missing", None)
                .await
                .is_err()
        );
        set_project_icon_inner(&pool, "p", None).await.unwrap();
        crate::db::apply_schema(&pool).await.unwrap();
        assert!(fetch_projects(&pool, "a").await.unwrap()[0].icon.is_none());
    }

    #[tokio::test]
    async fn markdown_import_remains_compatible_with_nullable_icon() {
        let pool = setup().await;
        let markdown = "# Notas\n## Importado\n- [ ] 2026-01-01 | **CODE** | Padre #tag\n\t- [ ] 2026-01-01 | **CODE** | Hijo\n";
        let stats = import::import_markdown(&pool, "a", markdown).await.unwrap();
        assert_eq!(stats.tasks_imported, 2);
        let projects = fetch_projects(&pool, "a").await.unwrap();
        let project = projects.iter().find(|p| p.label == "Importado").unwrap();
        assert!(project.icon.is_none());
        let tasks = fetch_tasks(&pool, "a").await.unwrap();
        assert_eq!(tasks.len(), 2);
        assert!(
            tasks
                .iter()
                .all(|t| t.project_id.as_deref() == Some(project.id.as_str()))
        );
        let child = tasks.iter().find(|t| t.content == "Hijo").unwrap();
        assert_eq!(
            child.parent_task_id.as_deref(),
            Some(
                tasks
                    .iter()
                    .find(|t| t.content.starts_with("Padre"))
                    .unwrap()
                    .id
                    .as_str()
            )
        );
    }
}
