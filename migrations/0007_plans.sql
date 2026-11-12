CREATE TABLE atlas_plans (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 draft_id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('day','content','review')),
 title TEXT NOT NULL,
 plan_day TEXT NOT NULL,
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 6000),
 created_at TEXT NOT NULL
);
