// Empty view defaults only: never seed, migrate, or infer financial values for a partial account.
export function preparePremeetingState(source = {}) {
  const result = {
    v: 4, ui: { me: '' }, settings: {}, auth: { enabled: true, accounts: [] },
    templates: { tm: {}, pre: {}, post: {} }, ai: {}, perf: {}, perfGoals: {}, perfMeta: {},
    adSpend: {}, adDaily: {}, adSpendMeta: {}, integrations: {},
  };
  for (const key of ['leads','users','contractStatusLogs','contractEvents','projects','bizSubs','bizRecs','products','channels','creatives','geoTasks','contents','prompts','procTpls','org','kpis','revisionNotes','marketingLogs']) result[key] = [];
  for (const key of ['leads','users','contractStatusLogs','contractEvents']) result[key] = Array.isArray(source[key]) ? source[key] : [];
  return result;
}
