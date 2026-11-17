/**
 * Turning an admin's audience choice into a user query. Pure (no database), so it's easy to test.
 */

export interface AudienceInput {
  everyone?: boolean;
  roles?: string[];
  accessModes?: string[];
  sectors?: string[];
  tags?: string[];
  userIds?: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function cleanAudience(a: AudienceInput | undefined) {
  const list = (v: unknown, max = 200) =>
    Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))].slice(0, max) : [];
  return {
    everyone: a?.everyone === true,
    roles: list(a?.roles, 10),
    accessModes: list(a?.accessModes, 10),
    sectors: list(a?.sectors, 50),
    tags: list(a?.tags, 50).map((t) => t.toLowerCase()),
    userIds: list(a?.userIds, 5000).filter((id) => /^[a-f0-9]{24}$/i.test(id))
  };
}

/**
 * Users matching the audience. Within a filter any value matches (OR); different filters must all
 * match (AND) — except specific users, who are always included.
 */
export function audienceQuery(a: ReturnType<typeof cleanAudience>): Record<string, unknown> {
  const base = { isActive: { $ne: false } };
  if (a.everyone) return base;
  const and: Record<string, unknown>[] = [];
  if (a.roles.length) and.push({ role: { $in: a.roles } });
  if (a.accessModes.length) and.push({ accessMode: { $in: a.accessModes } });
  if (a.sectors.length) and.push({ 'companyInfo.sector': { $in: a.sectors.map((s) => new RegExp(`^\\s*${escape(s)}\\s*$`, 'i')) } });
  if (a.tags.length) and.push({ tags: { $in: a.tags } });
  const or: Record<string, unknown>[] = [];
  if (and.length) or.push(and.length === 1 ? and[0] : { $and: and });
  if (a.userIds.length) or.push({ _id: { $in: a.userIds } });
  if (!or.length) return { ...base, _id: { $in: [] } }; // nothing chosen → nobody
  return { ...base, ...(or.length === 1 ? or[0] : { $or: or }) };
}

export function describeAudience(a: ReturnType<typeof cleanAudience>): string {
  if (a.everyone) return 'Everyone';
  const parts: string[] = [];
  if (a.sectors.length) parts.push(`sector: ${a.sectors.join(', ')}`);
  if (a.tags.length) parts.push(`tags: ${a.tags.join(', ')}`);
  if (a.accessModes.length) parts.push(a.accessModes.map((m) => (m === 'part_one' ? 'Part one' : m === 'part_two' ? 'Part two' : m)).join(' or '));
  if (a.roles.length) parts.push(a.roles.map((r) => (r === 'system_admin' ? 'admins' : r === 'hybrid' ? 'users' : r)).join(' or '));
  const filters = parts.join(' · ');
  if (a.userIds.length) return filters ? `${filters} + ${a.userIds.length} chosen user${a.userIds.length === 1 ? '' : 's'}` : `${a.userIds.length} chosen user${a.userIds.length === 1 ? '' : 's'}`;
  return filters || 'Nobody yet';
}
