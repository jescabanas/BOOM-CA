-- Repair MOV access after the compliance-submission rollout (after 0010).
-- The documents table uses uploaded_at (not created_at); frontend queries must
-- use that column. These policies make the supported Add MOV / Resubmit flow
-- work for a secretary's own unlocked submission, including under review.

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    current_role_name() = 'barangay_secretary'
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.submissions s
      where s.id = documents.submission_id
        and s.barangay_id = current_barangay_id()
        and s.is_locked = false
        and s.status in ('pending', 'under_review', 'correction_requested')
    )
  );

drop policy if exists document_mandates_secretary_insert on public.document_mandates;
create policy document_mandates_secretary_insert on public.document_mandates
  for insert to authenticated
  with check (
    current_role_name() = 'barangay_secretary'
    and exists (
      select 1 from public.documents d
      join public.submissions s on s.id = d.submission_id
      where d.id = document_mandates.document_id
        and s.barangay_id = current_barangay_id()
        and s.is_locked = false
        and s.status in ('pending', 'under_review', 'correction_requested')
    )
  );

-- Existing MOV links are historical evidence. Archive a referenced mandate
-- instead of deleting it; unreferenced mandates are deleted permanently.
create or replace function public.remove_mandate_safely(p_mandate_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_role_name() <> 'super_admin' then
    raise exception 'Super administrator role required';
  end if;

  if exists (select 1 from document_mandates where mandate_id = p_mandate_id)
     or exists (select 1 from submission_remarks where mandate_id = p_mandate_id) then
    update mandates set status = 'archived', updated_at = now() where id = p_mandate_id;
  else
    delete from mandates where id = p_mandate_id;
  end if;
end;
$$;

grant execute on function public.remove_mandate_safely(uuid) to authenticated;
