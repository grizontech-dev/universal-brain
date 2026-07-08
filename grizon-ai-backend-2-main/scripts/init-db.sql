-- Init script: creates both app + grizon_user/grizon_db
-- Runs automatically on first PostgreSQL container start

-- 1. Create grizon_user (for Node.js backend + healthcheck)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'grizon_user') THEN
        CREATE ROLE grizon_user WITH LOGIN SUPERUSER PASSWORD 'grizon_password_123';
    END IF;
END
$$;

-- 2. Create grizon_db (Node.js backend database)
SELECT 'CREATE DATABASE grizon_db OWNER grizon_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'grizon_db')\gexec;

GRANT ALL PRIVILEGES ON DATABASE grizon_db TO grizon_user;

-- 3. Create app user (Python Brain database)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app') THEN
        CREATE ROLE app WITH LOGIN SUPERUSER PASSWORD 'app';
    END IF;
END
$$;

-- 4. Create app database (Brain memory system)
SELECT 'CREATE DATABASE app OWNER app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'app')\gexec;

GRANT ALL PRIVILEGES ON DATABASE app TO app;
