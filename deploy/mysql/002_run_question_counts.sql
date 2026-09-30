ALTER TABLE benchmark_runs
  ADD COLUMN expected_questions SMALLINT UNSIGNED NOT NULL DEFAULT 0
    AFTER exit_code,
  ADD COLUMN completed_questions SMALLINT UNSIGNED NOT NULL DEFAULT 0
    AFTER expected_questions,
  ADD COLUMN skipped_questions SMALLINT UNSIGNED NOT NULL DEFAULT 0
    AFTER completed_questions;
