-- Archived account/lead rows are retained for audit and rollback. A source change
-- can therefore leave more than one historical row with the same source_row_key.
-- Deal projection must join only the single active account and lead, otherwise
-- one deal is proposed twice to the same ON CONFLICT target (SQLSTATE 21000).
do $migration$
declare
  v_definition text;
  v_changed text;
begin
  v_definition := pg_get_functiondef('private.project_v3_state(uuid,text,jsonb)'::regprocedure);
  v_changed := replace(
    v_definition,
    $old$join public.accounts a on a.organization_id = p_organization_id and a.source_row_key = 'account:' || d.lead_key$old$,
    $new$join public.accounts a on a.organization_id = p_organization_id and a.source_row_key = 'account:' || d.lead_key and a.archived_at is null$new$
  );
  if v_changed = v_definition and position(
    $new$join public.accounts a on a.organization_id = p_organization_id and a.source_row_key = 'account:' || d.lead_key and a.archived_at is null$new$
    in v_definition
  ) = 0 then
    raise exception 'project_v3_state account join patch target not found';
  end if;

  v_definition := v_changed;
  v_changed := replace(
    v_definition,
    $old$join public.leads l on l.organization_id = p_organization_id and l.source_row_key = 'lead:' || d.lead_key$old$,
    $new$join public.leads l on l.organization_id = p_organization_id and l.source_row_key = 'lead:' || d.lead_key and l.archived_at is null$new$
  );
  if v_changed = v_definition and position(
    $new$join public.leads l on l.organization_id = p_organization_id and l.source_row_key = 'lead:' || d.lead_key and l.archived_at is null$new$
    in v_definition
  ) = 0 then
    raise exception 'project_v3_state lead join patch target not found';
  end if;

  execute v_changed;
end
$migration$;

comment on function private.project_v3_state(uuid,text,jsonb) is
  'Projects V3 compatibility state to relational tables; deal joins use active account and lead rows only.';
