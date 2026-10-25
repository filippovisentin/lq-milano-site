import type { AdminUser, Role } from './users';

export type Perm = 'misura';

const PERMS: Record<Role, Set<Perm>> = {
  proprietario: new Set<Perm>(['misura']),
  sviluppatore: new Set<Perm>(['misura']),
};

// Unknown roles and anonymous users get nothing.
export function can(user: Pick<AdminUser, 'role'> | null, perm: Perm): boolean {
  if (!user) return false;
  return PERMS[user.role]?.has(perm) ?? false;
}
