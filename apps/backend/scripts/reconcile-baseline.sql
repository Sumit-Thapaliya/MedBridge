-- One-time fix for a database that predates the single squashed baseline
-- migration (prisma/migrations/20260831000000_baseline).
--
-- Older databases were built with `prisma db push` or an older, incomplete set
-- of migration files, so their `_prisma_migrations` history no longer matches
-- the migration files in this repo. This script clears that stale history only.
-- It does NOT touch any of your application tables or data.
--
-- Run it with:  npm run db:reconcile
-- (which drops this stale history and then re-baselines the current migration.)

DROP TABLE IF EXISTS "_prisma_migrations";
