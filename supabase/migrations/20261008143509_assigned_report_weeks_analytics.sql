-- Analytics follows the existing report calendar: days 1–7, 8–14, 15–21,
-- and 22–month end. Normalize old calendar-week links within their month.
-- Report membership still uses occurrence_key, never the upload timestamp.
create function app_private.report_week_bounds(p_value text)
returns table(start_date date, end_date date)
language sql immutable set search_path='' as $$
  with assigned as (
    select date_trunc('month',p_value::date)::date
      + least((extract(day from p_value::date)::integer-1)/7,3)*7 start_date
  )
  select start_date,case when extract(day from start_date)=22
    then (date_trunc('month',start_date)+interval '1 month')::date
    else start_date+7 end
  from assigned;
$$;
revoke all on function app_private.report_week_bounds(text) from public,anon,authenticated;

-- Preserve the existing MFA gates, scoring, file checks and return shapes.
do $$
declare signature text; definition text;
  old_clause text:='when ''weekly'' then start_date:=p_period_value::date;end_date:=start_date+7;y:=extract(year from start_date);';
  new_clause text:='when ''weekly'' then
      select w.start_date,w.end_date into start_date,end_date
        from app_private.report_week_bounds(p_period_value) w;
      y:=extract(year from start_date);';
begin
  foreach signature in array array[
    'app_private.analytics_period_rankings(text,text)',
    'app_private.my_barangay_analytics(text,text)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position(old_clause in definition)=0 then
      raise exception 'Unexpected analytics week definition: %',signature;
    end if;
    execute replace(definition,old_clause,new_clause);
  end loop;
end $$;

notify pgrst,'reload schema';
