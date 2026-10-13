-- Pure timestamp tests; no submission records are created or edited.
do $$
declare failures integer;
begin
  select count(*) into failures
  from (values
    ('earlier Philippine date', '2026-10-02 23:59:59+08'::timestamptz,'on_time'),
    ('before cutoff', '2026-10-03 16:59:59.999+08'::timestamptz,'grace_period'),
    ('exact cutoff', '2026-10-03 17:00:00+08'::timestamptz,'grace_period'),
    ('one microsecond late', '2026-10-03 17:00:00.000001+08'::timestamptz,'late'),
    ('reported 6:27 PM submission', '2026-10-03 18:27:38+08'::timestamptz,'late'),
    ('same instant in UTC', '2026-10-03 10:27:38+00'::timestamptz,'late'),
    ('within old 48 hour grace', '2026-10-04 12:00:00+08'::timestamptz,'late'),
    ('not submitted', null::timestamptz,'missing')
  ) cases(label,submitted_at,expected)
  where public.submission_timing_band(submitted_at,'2026-10-03 17:00:00+08'::timestamptz)::text
    is distinct from expected;
  if failures <> 0 then raise exception 'Deadline boundary tests failed: %',failures; end if;

  if public.submission_timing_band('2026-10-02 16:30:00+00','2026-10-03 09:00:00+00')::text <> 'grace_period'
    then raise exception 'Philippine date classification failed'; end if;
end;
$$;
