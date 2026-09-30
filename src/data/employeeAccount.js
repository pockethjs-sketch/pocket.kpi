const MASTER_SERVER_ROLES = new Set(['OWNER', 'ADMIN']);

export function accountFromEmployeeAccess(employee, pageIds = []) {
  if (!employee?.userId) return null;

  const serverRole = String(employee.role || '').toUpperCase();
  const role = MASTER_SERVER_ROLES.has(serverRole) ? 'MASTER' : 'USER';

  return {
    id: String(employee.userId),
    username: role,
    displayName: role,
    role,
    serverRole,
    scope: employee.scope || 'all',
    allowedPages: employee.scope === 'premeeting' ? ['deals'] : role === 'MASTER' ? [] : [...new Set(pageIds)].filter(id => !['org','templates'].includes(id)),
  };
}
