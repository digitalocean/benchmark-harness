ALTER TABLE benchmark_runs
  ADD COLUMN judge_model VARCHAR(191) NULL
    AFTER model;
