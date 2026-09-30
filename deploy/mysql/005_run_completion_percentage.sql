ALTER TABLE benchmark_runs
  ADD COLUMN completion_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0
    AFTER skipped_questions;
