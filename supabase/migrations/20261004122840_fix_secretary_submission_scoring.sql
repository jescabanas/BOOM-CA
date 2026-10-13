-- Automatic scoring runs within the authorized submission write. The public
-- scoring RPC remains reviewer-only; the trigger uses the internal implementation.
create or replace function public.apply_submission_score()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_result record;
begin
  select * into v_result from app_private.calculate_submission_score(new.id);
  update public.submissions
    set points_awarded = v_result.points, score_band = v_result.band
    where id = new.id;
  insert into public.scores (submission_id, points, band, calculation_notes)
    values (new.id, v_result.points, v_result.band, 'auto-calculated on submission change');
  return new;
end;
$$;
revoke all on function public.apply_submission_score() from public, anon, authenticated;
grant execute on function public.apply_submission_score() to service_role;
-- Attribute a status transition to the signed-in actor; reviewer_id is null
-- for Secretary submissions. Preserve service-side reviewer attribution.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.handle_submission_review()'::regprocedure);
  if position('log_audit_event(new.evaluator_id,' in definition) = 0 then
    raise exception 'Unexpected submission review trigger definition';
  end if;
  definition := replace(definition, 'log_audit_event(new.evaluator_id,',
    'log_audit_event(coalesce(auth.uid(), new.evaluator_id),');
  execute definition;
end;
$$;

