import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { USERS_FILE, bumpSessionVersion, getUser, readUsers, writeUsers, type AdminUser, type Role } from './users';
import { can } from './permissions';

const mk = (user: string, role: Role = 'proprietario'): AdminUser => ({
  user, role, passwordHash: 'h', totpSecret: 's', lastTotpStep: 0, sessionVersion: 0, createdAt: '2026-01-01T00:00:00.000Z',
});

describe('users', () => {
  it('writeUsers then readUsers returns the same data', () => {
    const list = [mk('a'), mk('b', 'sviluppatore')];
    writeUsers(list);
    expect(readUsers()).toEqual(list);
    expect(getUser('b')?.role).toBe('sviluppatore');
    expect(getUser('zzz')).toBeUndefined();
  });

  it('sees external changes to the file', () => {
    writeUsers([mk('a')]);
    expect(readUsers()).toHaveLength(1);
    mkdirSync(dirname(USERS_FILE), { recursive: true });
    writeFileSync(USERS_FILE, JSON.stringify([mk('a'), mk('c'), mk('d')]));
    expect(readUsers().map((u) => u.user)).toEqual(['a', 'c', 'd']);
  });

  it('bumpSessionVersion increments by 1', () => {
    writeUsers([mk('a')]);
    bumpSessionVersion('a');
    expect(getUser('a')?.sessionVersion).toBe(1);
  });
});

describe('permissions', () => {
  it('can() by role', () => {
    expect(can({ role: 'proprietario' }, 'misura')).toBe(true);
    expect(can({ role: 'sviluppatore' }, 'misura')).toBe(true);
    expect(can({ role: 'x' as Role }, 'misura')).toBe(false);
    expect(can(null, 'misura')).toBe(false);
  });
});
