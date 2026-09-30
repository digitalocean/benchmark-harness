CREATE TABLE IF NOT EXISTS benchmark_run_performance_reports (
  run_id CHAR(36) NOT NULL,
  schema_version SMALLINT UNSIGNED NOT NULL,
  computed_at DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL,
  error TEXT NULL,
  report_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (run_id),
  CONSTRAINT fk_run_performance_reports_run
    FOREIGN KEY (run_id) REFERENCES benchmark_runs(id)
    ON DELETE CASCADE,
  INDEX idx_run_performance_reports_status (status),
  INDEX idx_run_performance_reports_computed_at (computed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
