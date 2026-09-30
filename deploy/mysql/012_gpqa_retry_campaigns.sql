ALTER TABLE benchmark_runs
  ADD COLUMN run_kind VARCHAR(32) NOT NULL DEFAULT 'benchmark'
    AFTER benchmark,
  ADD COLUMN source_run_id CHAR(36) NULL
    AFTER run_kind,
  ADD COLUMN campaign_id CHAR(36) NULL
    AFTER source_run_id,
  ADD COLUMN campaign_arm VARCHAR(32) NULL
    AFTER campaign_id,
  ADD COLUMN sample_ids_json JSON NULL
    AFTER campaign_arm,
  ADD INDEX idx_benchmark_runs_run_kind (run_kind),
  ADD INDEX idx_benchmark_runs_campaign_id (campaign_id);
