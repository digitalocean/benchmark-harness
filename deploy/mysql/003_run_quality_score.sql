ALTER TABLE benchmark_runs
  ADD COLUMN quality_score DECIMAL(10, 8) NULL
    AFTER skipped_questions;
