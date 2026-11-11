CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  tool TEXT NOT NULL,
  job TEXT,
  model TEXT,
  date TEXT,
  app TEXT
);
CREATE INDEX tool_calls_ts ON tool_calls (ts);
