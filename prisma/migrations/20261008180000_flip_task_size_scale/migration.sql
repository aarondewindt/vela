-- Size scale flipped: 1 is now the smallest and 5 the longest (0 stays unknown).
UPDATE "tasks" SET "size" = 6 - "size" WHERE "size" BETWEEN 1 AND 5;
