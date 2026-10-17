-- Run with psql -v ON_ERROR_STOP=1 after applying the pgvector migration.
-- All test rows are temporary and disappear when this transaction ends.
BEGIN;

SELECT extversion AS pgvector_version FROM pg_extension WHERE extname = 'vector';

CREATE TEMP TABLE pgvector_verification (
    id integer PRIMARY KEY,
    embedding vector NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
    dimensions integer;
    query_vector vector;
    nearest_id integer;
BEGIN
    FOREACH dimensions IN ARRAY ARRAY[1024, 2560, 4096] LOOP
        TRUNCATE pgvector_verification;
        query_vector := (ARRAY[1::real] || array_fill(0::real, ARRAY[dimensions - 1]))::vector;

        INSERT INTO pgvector_verification (id, embedding) VALUES
            (1, query_vector),
            (2, (ARRAY[-1::real] || array_fill(0::real, ARRAY[dimensions - 1]))::vector),
            (3, (ARRAY[0::real, 1::real] || array_fill(0::real, ARRAY[dimensions - 2]))::vector);

        IF (SELECT count(*) FROM pgvector_verification WHERE vector_dims(embedding) = dimensions) <> 3 THEN
            RAISE EXCEPTION 'Vector storage failed at % dimensions', dimensions;
        END IF;

        IF EXISTS (
            SELECT 1 FROM pgvector_verification
            WHERE abs((1 - (embedding <=> query_vector)) - CASE id WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END) > 0.000001
        ) THEN
            RAISE EXCEPTION 'Cosine similarity failed at % dimensions', dimensions;
        END IF;

        SELECT id INTO nearest_id FROM pgvector_verification
        ORDER BY embedding <=> query_vector LIMIT 1;
        IF nearest_id IS DISTINCT FROM 1 THEN
            RAISE EXCEPTION 'Nearest-neighbor search failed at % dimensions', dimensions;
        END IF;

        RAISE NOTICE 'Passed storage, cosine similarity and exact search at % dimensions', dimensions;
    END LOOP;
END;
$$;

ROLLBACK;
