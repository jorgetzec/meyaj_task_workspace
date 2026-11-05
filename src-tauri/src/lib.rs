mod commands;
mod db;
mod import;
mod models;
mod util;

use db::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("meyaj.db");

            let pool = tauri::async_runtime::block_on(db::init_pool(db_path))?;

            // Ensure at least one panel exists before the UI queries state.
            tauri::async_runtime::block_on(async {
                let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM panel")
                    .fetch_one(&pool)
                    .await?;
                if count == 0 {
                    let id = uuid::Uuid::new_v4().to_string();
                    sqlx::query(
                        "INSERT INTO panel (id, title, sort_order, created_at, archived) VALUES (?, 'Inicio', 0, ?, 0)",
                    )
                    .bind(&id)
                    .bind(crate::util::now_local_iso())
                    .execute(&pool)
                    .await?;
                }
                Ok::<(), sqlx::Error>(())
            })?;

            app.manage(AppState { pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::load_state,
            commands::list_history,
            commands::create_panel,
            commands::rename_panel,
            commands::delete_panel,
            commands::create_project,
            commands::move_project,
            commands::set_project_icon,
            commands::create_task,
            commands::update_task,
            commands::set_task_classifier,
            commands::delete_task,
            commands::complete_task,
            commands::set_task_parent,
            commands::move_task,
            commands::reorder_project_tasks,
            commands::reorder_projects,
            commands::set_panel_archived,
            commands::restore_task,
            commands::export_markdown,
            commands::read_text_file,
            commands::write_text_file,
            commands::list_dir,
            commands::user_places,
            commands::import_default_dir,
            commands::import_markdown,
            commands::hashtags_from,
            commands::list_classifiers,
            commands::create_classifier,
            commands::delete_classifier,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
