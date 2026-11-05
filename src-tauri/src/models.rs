use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    pub id: String,
    pub title: String,
    pub sort_order: i64,
    pub created_at: String,
    pub archived: bool,
}

/// A global classifier (short code) that can be attached to any task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Classifier {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub label: String,
    pub color_accent: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub sort_order: i64,
    pub panel_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub content: String,
    pub completed: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub project_id: Option<String>,
    pub classifier: Option<String>,
    pub sort_order: i64,
    pub parent_task_id: Option<String>,
    pub hashtags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub panel_id: String,
    pub task_id: Option<String>,
    pub classifier: Option<String>,
    pub project_label: Option<String>,
    pub snapshot_content: String,
    pub created_at: String,
    pub completed_at: String,
}

/// Payload used to create a task from the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub panel_id: String,
    pub project_id: Option<String>,
    pub classifier: Option<String>,
    pub content: String,
    pub parent_task_id: Option<String>,
}

/// Full snapshot of a panel's live state returned in one IPC round-trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelState {
    pub active_panel_id: String,
    pub created_task_id: Option<String>,
    pub panels: Vec<Panel>,
    pub projects: Vec<Project>,
    pub classifiers: Vec<Classifier>,
    pub tasks: Vec<Task>,
}
