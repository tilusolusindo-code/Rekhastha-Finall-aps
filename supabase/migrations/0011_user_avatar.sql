-- Migration 0011: foto profil pengguna
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
