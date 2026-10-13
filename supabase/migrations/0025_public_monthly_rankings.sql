-- Public rankings use the same all-deadlines, month-and-year calculation as
-- the authenticated Rankings page. The function only exposes active barangay
-- names and aggregate ranking data, and is security definer.
grant execute on function public.leaderboard_for_compliance_period(uuid, integer, integer) to anon;
