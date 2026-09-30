ALTER TABLE benchmark_runs
  ADD COLUMN triggered_by_email VARCHAR(320) NULL
    AFTER args_json,
  ADD INDEX idx_benchmark_runs_triggered_by_email (triggered_by_email);
