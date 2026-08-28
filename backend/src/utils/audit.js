import { supabase } from '../config/supabase.js';

/**
 * Append an audit record.
 *
 * Deliberately fire-and-forget: an audit write must never fail the operation it
 * is recording. A failed insert is logged to the server console so it is not
 * silent, but the caller continues.
 *
 * Never pass a password, token, or API key in `metadata`.
 *
 * @param {object} entry
 * @param {'USER'|'AI'|'SYSTEM'} [entry.actorType]
 * @param {string|null} [entry.actorId]
 * @param {string} entry.action        e.g. 'auth.login', 'action.approved'
 * @param {string} entry.entityType    e.g. 'app_user', 'action'
 * @param {string|null} [entry.entityId]
 * @param {object} [entry.metadata]
 */
export async function audit({
  actorType = 'SYSTEM',
  actorId = null,
  action,
  entityType,
  entityId = null,
  metadata = {},
}) {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      actor_type: actorType,
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
    if (error) console.error('[audit] write failed:', error.message);
  } catch (err) {
    console.error('[audit] write threw:', err.message);
  }
}
