ALTER TABLE benchmark_runs
  DROP CONSTRAINT benchmark_runs_suite_id_fkey,
  ADD CONSTRAINT benchmark_runs_suite_id_fkey
    FOREIGN KEY (suite_id) REFERENCES benchmark_suites(id) ON DELETE CASCADE;
