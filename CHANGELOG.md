# Changelog

All notable changes to Meyaj are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.1] - 2026-11-05

Maintenance release focused on reliability and consistency.

### Added

- In-app file picker for importing Markdown and exporting a panel, built on plain
  directory reads instead of the Windows shell dialog.
- Drag and drop: dropping a `.md` file onto the window imports it into the current panel.
- Classifier editing on existing tasks. Clicking the classifier badge opens a
  searchable list, accepts a new classifier, or removes it.
- Shortcuts in the picker for Home, Documents, Desktop, Downloads, and the bundled
  examples, plus the last folder used is remembered.

### Fixed

- Import and export could freeze the window. The native file dialog blocked while
  browsing folders that depend on cloud providers, the search index, or broken shell
  extensions; Windows logged the hang as `AppHangXProcB1` waiting on `SearchIndexer.exe`.
- Month view rendered tasks as plain text. Rows now use the same component as the
  project views, with checkbox, date and classifier badges, hashtag highlighting, inline
  editing, subtasks, and deletion.
- A task is listed once per month even when its parent belongs to a different month.
- File contents are read and written by the backend, so importing works from any folder
  and failures report the offending path.
- Importing with no active panel now explains the problem instead of doing nothing.

### Changed

- The project version moved to `0.1.1` across `package.json`, `package-lock.json`,
  `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.

## [0.1.0] - 2026-11-04

First public build.

### Added

- Panels and projects with nested tasks.
- Permanent panel deletion with confirmation and transactional cleanup.
- Completion rules for parent tasks with pending subtasks.
- Custom classifiers and cross-project hashtag groups.
- Editable, closable, and reorderable views.
- Project icons, accent colors, and project movement between panels.
- Markdown checklist import and panel export.
- Search, history, themes, font controls, and keyboard navigation.
- English and Spanish interface.
- Per-user NSIS installer for Windows x64.

[Unreleased]: https://github.com/jorgetzec/meyaj_task_workspace/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/jorgetzec/meyaj_task_workspace/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jorgetzec/meyaj_task_workspace/releases/tag/v0.1.0
