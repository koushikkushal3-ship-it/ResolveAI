import bcrypt from 'bcrypt';
import { supabase, unwrap } from '../config/supabase.js';
import { signToken } from '../middleware/auth.js';
import { badRequest, conflict, unauthorized } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';

const BCRYPT_ROUNDS = 10;

/**
 * A bcrypt hash of a throwaway value.
 *
 * Compared against when no account matches the submitted email, so a login for
 * an unknown address costs the same time as one for a known address. Without
 * it, response timing enumerates valid accounts regardless of how carefully the
 * error message is worded.
 */
const DUMMY_HASH = bcrypt.hashSync('resolveai-timing-equalizer', BCRYPT_ROUNDS);

/** Strip everything the client must not see. Never return password_hash. */
const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  role: row.role,
  createdAt: row.created_at,
});

/**
 * @param {{ email: string, password: string, fullName: string, role: string }} input
 */
export async function registerUser({ email, password, fullName, role }) {
  const existing = unwrap(
    await supabase.from('app_users').select('id').eq('email', email).maybeSingle(),
    'register lookup'
  );
  if (existing) throw conflict('An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = unwrap(
    await supabase
      .from('app_users')
      .insert({ email, password_hash: passwordHash, full_name: fullName, role })
      .select('id, email, full_name, role, created_at')
      .single(),
    'register insert'
  );

  await audit({
    actorType: 'USER',
    actorId: user.id,
    action: 'auth.register',
    entityType: 'app_user',
    entityId: user.id,
    metadata: { role },
  });

  return { user: toPublicUser(user), token: signToken({ ...user, role: user.role }) };
}

/**
 * @param {{ email: string, password: string }} input
 */
export async function loginUser({ email, password }) {
  const row = unwrap(
    await supabase
      .from('app_users')
      .select('id, email, password_hash, full_name, role, is_active, created_at')
      .eq('email', email)
      .maybeSingle(),
    'login lookup'
  );

  // One message and one timing profile for every failure mode. An attacker
  // learns nothing about whether the address exists.
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || !row.is_active) {
    await audit({
      action: 'auth.login_failed',
      entityType: 'app_user',
      metadata: { email }, // the attempted address, never the password
    });
    throw unauthorized('Invalid email or password');
  }

  await audit({
    actorType: 'USER',
    actorId: row.id,
    action: 'auth.login',
    entityType: 'app_user',
    entityId: row.id,
  });

  return { user: toPublicUser(row), token: signToken(row) };
}

/**
 * @param {string} userId
 * @param {{ fullName?: string, email?: string }} patch
 */
export async function updateProfile(userId, patch) {
  if (patch.email) {
    const taken = unwrap(
      await supabase
        .from('app_users')
        .select('id')
        .eq('email', patch.email)
        .neq('id', userId)
        .maybeSingle(),
      'profile email check'
    );
    if (taken) throw conflict('That email is already in use');
  }

  const updates = {};
  if (patch.fullName !== undefined) updates.full_name = patch.fullName;
  if (patch.email !== undefined) updates.email = patch.email;

  const user = unwrap(
    await supabase
      .from('app_users')
      .update(updates)
      .eq('id', userId)
      .select('id, email, full_name, role, created_at')
      .single(),
    'profile update'
  );

  await audit({
    actorType: 'USER',
    actorId: userId,
    action: 'auth.profile_updated',
    entityType: 'app_user',
    entityId: userId,
    metadata: { fields: Object.keys(updates) },
  });

  return toPublicUser(user);
}

/**
 * @param {string} userId
 * @param {{ currentPassword: string, newPassword: string }} input
 */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const row = unwrap(
    await supabase.from('app_users').select('id, password_hash').eq('id', userId).single(),
    'password lookup'
  );

  if (!(await bcrypt.compare(currentPassword, row.password_hash))) {
    throw unauthorized('Current password is incorrect');
  }
  if (await bcrypt.compare(newPassword, row.password_hash)) {
    throw badRequest('New password must be different from the current one');
  }

  unwrap(
    await supabase
      .from('app_users')
      .update({ password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) })
      .eq('id', userId)
      .select('id')
      .single(),
    'password update'
  );

  await audit({
    actorType: 'USER',
    actorId: userId,
    action: 'auth.password_changed',
    entityType: 'app_user',
    entityId: userId,
  });

  return { changed: true };
}

/** True when no account exists yet — the first registration bootstraps an ADMIN. */
export async function isFirstUser() {
  const { count, error } = await supabase
    .from('app_users')
    .select('id', { count: 'exact', head: true });
  if (error) {
    const e = new Error(`user count: ${error.message}`);
    e.isDatabaseError = true;
    throw e;
  }
  return (count ?? 0) === 0;
}
