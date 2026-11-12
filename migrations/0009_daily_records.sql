CREATE TABLE IF NOT EXISTS atlas_agenda (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 draft_id TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL CHECK(ends_at > starts_at),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS atlas_agenda_start ON atlas_agenda(starts_at);
CREATE TABLE IF NOT EXISTS atlas_expenses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 draft_id TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 99999999999),
 currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR')),
 category TEXT NOT NULL CHECK(category IN ('market','ulaşım','yemek','fatura','diğer')),
 spent_day TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS atlas_expenses_day ON atlas_expenses(spent_day);
