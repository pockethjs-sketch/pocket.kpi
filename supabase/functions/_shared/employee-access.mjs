// Staged authorization helper. Not active until all public entry points are migrated.
// Never trust browser-selected profiles or user_metadata for authorization.
export async function authorizeEmployee({ request, organizationId, verifyUser, findMembership }) {
  const denied = (status, error) => ({ ok: false, status, error });
  if (!organizationId) return denied(503, 'organization_not_configured');
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match) return denied(401, 'login_required');
  let user;
  try {
    // Adapter must call Supabase auth.getUser(token), not decode unverified JWTs.
    const result = await verifyUser(match[1]);
    if (result.error) return denied(401, 'invalid_session');
    user = result.data?.user;
  } catch {
    return denied(503, 'auth_unavailable');
  }
  if (!user?.id || user.is_anonymous || user.role !== 'authenticated' || !user.email_confirmed_at) {
    return denied(401, 'verified_employee_login_required');
  }
  let membership;
  try {
    // Adapter must read the current membership on every request, no stale JWT role claims.
    const result = await findMembership(organizationId, user.id);
    if (result.error) return denied(503, 'membership_unavailable');
    membership = result.data;
  } catch {
    return denied(503, 'membership_unavailable');
  }
  if (!membership || membership.organization_id !== organizationId || membership.user_id !== user.id ||
      membership.state !== 'ACTIVE' || membership.archived_at ||
      !['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'].includes(membership.role)) {
    return denied(403, 'employee_approval_required');
  }
  return { ok: true, userId: user.id, organizationId, role: membership.role };
}

export function canEmployeeAct(access, permission) {
  if (!access?.ok) return false;
  if (permission === 'read') return ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'].includes(access.role);
  if (permission === 'write') return ['OWNER', 'ADMIN', 'EDITOR'].includes(access.role);
  if (permission === 'admin') return ['OWNER', 'ADMIN'].includes(access.role);
  return false;
}

export function mutationPermission(mutation) {
  if (!mutation || typeof mutation !== 'object') return 'invalid';
  // Browser profiles and stored legacy passwords are NOT identity or authorization.
  const protectedKeys = new Set(['auth', 'settings', 'users']);
  const keys = [...Object.keys(mutation.documents || {}), ...(mutation.deleteDocuments || []), ...Object.keys(mutation.collections || {})];
  return keys.some((key) => protectedKeys.has(key)) ? 'admin' : 'write';
}
