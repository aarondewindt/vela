-- The PostgreSQL image must provide pgvector before this migration runs.
CREATE EXTENSION IF NOT EXISTS vector;
