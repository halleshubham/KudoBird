-- Runs once on first Postgres start. The app connects as kudobird_app, which is
-- subject to Row Level Security; migrations run as the table owner (POSTGRES_USER).
-- Change these passwords in production (and match them in DATABASE_URL).
CREATE ROLE kudobird_app LOGIN PASSWORD 'kudobird_app' NOSUPERUSER NOBYPASSRLS;
