-- Upgrade only databases created by the earlier HUC Administrator migration.
-- Fresh installations already use huc_director and safely skip this block.
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'huc_administrator'
  ) then
    alter type user_role rename value 'huc_administrator' to 'huc_director';
  end if;
end;
$$;
