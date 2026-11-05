use sqlx::Row;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::PathBuf;

/// Shared application state managed by Tauri and injected into commands.
pub struct AppState {
    pub pool: SqlitePool,
}

/// Creates (or opens) the SQLite pool at the given path and applies the schema.
pub async fn init_pool(db_path: PathBuf) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    apply_schema(&pool).await?;
    Ok(pool)
}

pub(crate) async fn apply_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS panel (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL,
            archived    INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS classifier (
            id   TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project (
            id            TEXT PRIMARY KEY,
            label         TEXT NOT NULL,
            color_accent  TEXT,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            panel_id      TEXT NOT NULL REFERENCES panel(id) ON DELETE CASCADE
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task (
            id              TEXT PRIMARY KEY,
            content         TEXT NOT NULL,
            completed       INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL,
            completed_at    TEXT,
            project_id      TEXT REFERENCES project(id) ON DELETE SET NULL,
            classifier      TEXT,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            parent_task_id  TEXT REFERENCES task(id) ON DELETE CASCADE
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS hashtag (
            id   TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task_hashtag (
            task_id     TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
            hashtag_id  TEXT NOT NULL REFERENCES hashtag(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, hashtag_id)
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS history_entry (
            id              TEXT PRIMARY KEY,
            panel_id        TEXT NOT NULL REFERENCES panel(id) ON DELETE CASCADE,
            task_id         TEXT,
            classifier      TEXT,
            project_label   TEXT,
            snapshot_content TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            completed_at    TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    let mut tx = pool.begin().await?;
    let columns = sqlx::query("PRAGMA table_info(project)")
        .fetch_all(&mut *tx)
        .await?;
    if !columns
        .iter()
        .any(|column| column.get::<String, _>("name") == "icon")
    {
        sqlx::query("ALTER TABLE project ADD COLUMN icon TEXT")
            .execute(&mut *tx)
            .await?;
    }

    // Only rooted trees with a known project have an unambiguous owner. UNION
    // bounds traversal even if legacy data contains cycles; unrooted rows stay intact.
    sqlx::query(
        "WITH RECURSIVE ownership(id, project_id) AS ( \
             SELECT t.id, t.project_id FROM task t JOIN project p ON p.id = t.project_id \
             WHERE t.parent_task_id IS NULL \
             UNION \
             SELECT child.id, owner.project_id FROM task child \
             JOIN ownership owner ON child.parent_task_id = owner.id \
         ) UPDATE task SET project_id = (SELECT project_id FROM ownership WHERE ownership.id = task.id) \
         WHERE id IN (SELECT id FROM ownership) \
         AND project_id IS NOT (SELECT project_id FROM ownership WHERE ownership.id = task.id)",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    // Seed a small set of default classifiers for a good first-run experience.
    for code in ["TASK", "WORK", "CODE", "RESEARCH", "ADMIN", "IDEA"] {
        sqlx::query("INSERT OR IGNORE INTO classifier (id, name) VALUES (?, ?)")
            .bind(format!("cls-{}", code))
            .bind(code)
            .execute(pool)
            .await?;
    }

    // Indices for the hot paths.
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_task_project ON task(project_id);")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_task_parent ON task(parent_task_id);")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_history_panel ON history_entry(panel_id);")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_project_panel ON project(panel_id);")
        .execute(pool)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn legacy_schema_migrates_and_repairs_only_unambiguous_trees_without_data_loss() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .in_memory(true)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE panel (id TEXT PRIMARY KEY, title TEXT NOT NULL, \
            sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0)")
            .execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE project (id TEXT PRIMARY KEY, label TEXT NOT NULL, color_accent TEXT, \
            sort_order INTEGER NOT NULL DEFAULT 0, panel_id TEXT NOT NULL REFERENCES panel(id))",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO panel (id, title, created_at) VALUES ('a', 'Original', '2026-01-01')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO project (id, label, color_accent, sort_order, panel_id) \
            VALUES ('p', 'Principal', 'blue', 4, 'a'), ('inbox', 'Inbox', NULL, 7, 'a')",
        )
        .execute(&pool)
        .await
        .unwrap();
        apply_schema(&pool).await.unwrap();
        let icon: Option<String> = sqlx::query_scalar("SELECT icon FROM project WHERE id = 'p'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(icon.is_none());
        sqlx::query(
            "INSERT INTO task (id, content, created_at, project_id, parent_task_id) VALUES \
            ('root', 'Original root', '2026-01-01', 'p', NULL), \
            ('child', 'Original child', '2026-01-02', 'inbox', 'root'), \
            ('grandchild', 'Original grandchild', '2026-01-03', NULL, 'child'), \
            ('unknown', 'No project', '2026-01-04', NULL, NULL), \
            ('unknown-child', 'Keep owner', '2026-01-05', 'inbox', 'unknown')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO hashtag (id, name) VALUES ('tag', 'original')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task_hashtag (task_id, hashtag_id) VALUES ('child', 'tag')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE project SET icon = 'leaf' WHERE id = 'p'")
            .execute(&pool)
            .await
            .unwrap();
        for _ in 0..2 {
            apply_schema(&pool).await.unwrap();
        }
        let repaired: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE id IN ('root', 'child', 'grandchild') AND project_id = 'p'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(repaired, 3);
        let rows = sqlx::query("SELECT id, content, parent_task_id FROM task ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0].get::<String, _>("content"), "Original child");
        assert_eq!(rows[0].get::<String, _>("parent_task_id"), "root");
        let unknown: String =
            sqlx::query_scalar("SELECT project_id FROM task WHERE id = 'unknown-child'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(unknown, "inbox");
        let tags: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM task_hashtag WHERE task_id = 'child'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(tags, 1);
        let project =
            sqlx::query("SELECT label, color_accent, sort_order, icon FROM project WHERE id = 'p'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(project.get::<String, _>("label"), "Principal");
        assert_eq!(project.get::<String, _>("color_accent"), "blue");
        assert_eq!(project.get::<i64, _>("sort_order"), 4);
        assert_eq!(project.get::<String, _>("icon"), "leaf");
    }
}
