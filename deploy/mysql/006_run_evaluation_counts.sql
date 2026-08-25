ALTER TABLE benchmark_runs
  ADD COLUMN total_evaluations INT UNSIGNED NOT NULL DEFAULT 0
    AFTER completion_percentage,
  ADD COLUMN completed_evaluations INT UNSIGNED NOT NULL DEFAULT 0
    AFTER total_evaluations,
  ADD COLUMN skipped_evaluations INT UNSIGNED NOT NULL DEFAULT 0
    AFTER completed_evaluations;
