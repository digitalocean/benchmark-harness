ALTER TABLE benchmark_runs
  ADD COLUMN completion_timeout_ms INT UNSIGNED NULL
    AFTER timeout_ms;
