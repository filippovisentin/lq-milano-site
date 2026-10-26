import type { AdminUser, Role } from './users';

// misura: Misura upload and publishing; catalogo: product and event editing.
export type Perm = 'misura' | 'catalogo';

const PERMS: Record<Role, Set<Perm>> = {
  proprietario: new Set<Perm>(['misura', 'catalogo']),
  sviluppatore: new Set<Perm>(['misura', 'catalogo']),
};

// Unknown roles and anonymous users get nothing.
export function can(user: Pick<AdminUser, 'role'> | null, perm: Perm): boolean {
  if (!user) return false;
  return PERMS[user.role]?.has(perm) ?? false;
}
