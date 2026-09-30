ALTER TABLE benchmark_runs
  ADD COLUMN provider_only TEXT NULL
    AFTER provider_sort,
  ADD COLUMN allow_fallbacks BOOLEAN NULL
    AFTER provider_only;
