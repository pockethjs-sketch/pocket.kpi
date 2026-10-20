-- Server-only: remove default table privileges from browser roles on the new premeeting tables (same as buildup_projects).
revoke all on public.buildup_premeetings, public.buildup_premeeting_runs from anon, authenticated;
revoke all on sequence public.buildup_premeeting_runs_id_seq from anon, authenticated;
