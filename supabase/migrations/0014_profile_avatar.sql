-- Optional profile picture URL used by the account menu.
alter table profiles add column if not exists avatar_url text;
