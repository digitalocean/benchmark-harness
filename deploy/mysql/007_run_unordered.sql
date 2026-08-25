ALTER TABLE benchmark_runs
  ADD COLUMN unordered BOOLEAN NOT NULL DEFAULT FALSE
    AFTER concurrency;
