ALTER TABLE benchmark_runs
  ADD COLUMN failure_reason TEXT NULL
    AFTER exit_code;
