import { supabase, unwrap } from '../config/supabase.js';
import { searchPolicy } from './policy.js';
import { audit } from '../utils/audit.js';
import { conflict, notFound } from '../utils/httpError.js';

/**
 * Policy knowledge base CRUD.
 *
 * Writes are SUPERVISOR+ (enforced by route middleware). Policy text drives
 * every AI recommendation, so letting any agent rewrite it would be a way to
 * change what the system is willing to authorize without touching any code.
 */

export async function listKnowledge({ search, category, includeInactive, page, limit }) {
  // A search query goes through the ranked full-text path so the knowledge page
  // and the agent resolve documents the same way.
  if (search) {
    const hits = await searchPolicy({ query: search, limit });
    return {
      data: hits.map(({ content, ...d }) => ({ ...d, excerpt: content.slice(0, 240) })),
      meta: { page: 1, limit, total: hits.length, totalPages: 1 },
    };
  }

  const from = (page - 1) * limit;
  let request = supabase
    .from('knowledge_documents')
    .select('id, slug, title, category, version, content, metadata, is_active, created_at, updated_at', {
      count: 'exact',
    });

  if (category) request = request.eq('category', category);
  if (!includeInactive) request = request.eq('is_active', true);

  const { data, error, count } = await request.order('category').order('slug').range(from, from + limit - 1);
  if (error) {
    const e = new Error(`list knowledge: ${error.message}`);
    e.isDatabaseError = true;
    throw e;
  }

  return {
    data: data.map(({ content, ...d }) => ({ ...d, excerpt: content.slice(0, 240), content })),
    meta: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
  };
}

export async function getKnowledge(id) {
  const doc = unwrap(
    await supabase.from('knowledge_documents').select('*').eq('id', id).maybeSingle(),
    'get knowledge'
  );
  if (!doc) throw notFound('Policy document');
  return doc;
}

export async function createKnowledge(body, actor) {
  const existing = unwrap(
    await supabase.from('knowledge_documents').select('id').eq('slug', body.slug).maybeSingle(),
    'knowledge slug check'
  );
  if (existing) throw conflict('A policy with this slug already exists');

  const doc = unwrap(
    await supabase
      .from('knowledge_documents')
      .insert({
        slug: body.slug,
        title: body.title,
        category: body.category,
        version: body.version ?? 'v1',
        content: body.content,
        metadata: body.metadata ?? {},
        created_by: actor.id,
      })
      .select('*')
      .single(),
    'create knowledge'
  );

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'knowledge.created',
    entityType: 'knowledge_document',
    entityId: doc.id,
    metadata: { slug: doc.slug, category: doc.category },
  });

  return doc;
}

/**
 * Update a policy.
 *
 * Editing the content auto-bumps the version unless one is supplied. Every
 * recommendation stores the policy slug it used, and a silently changed
 * document would make an old decision look as though it followed rules that
 * did not exist at the time.
 */
export async function updateKnowledge(id, patch, actor) {
  const existing = await getKnowledge(id);

  const updates = {};
  for (const field of ['title', 'category', 'content', 'metadata']) {
    if (patch[field] !== undefined) updates[field] = patch[field];
  }
  if (patch.isActive !== undefined) updates.is_active = patch.isActive;

  if (patch.version !== undefined) {
    updates.version = patch.version;
  } else if (patch.content !== undefined && patch.content !== existing.content) {
    const n = Number(String(existing.version).replace(/^v/, '')) || 1;
    updates.version = `v${n + 1}`;
  }

  const doc = unwrap(
    await supabase.from('knowledge_documents').update(updates).eq('id', id).select('*').single(),
    'update knowledge'
  );

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'knowledge.updated',
    entityType: 'knowledge_document',
    entityId: id,
    metadata: { slug: doc.slug, fields: Object.keys(updates), version: doc.version },
  });

  return doc;
}

/**
 * Deactivate a policy. Soft delete, always.
 *
 * Actions reference policies by slug. A hard delete would leave executed
 * decisions citing a document nobody can produce.
 */
export async function deactivateKnowledge(id, actor) {
  const existing = await getKnowledge(id);
  if (!existing.is_active) throw conflict('This policy is already inactive');

  const doc = unwrap(
    await supabase
      .from('knowledge_documents')
      .update({ is_active: false })
      .eq('id', id)
      .select('id, slug, is_active')
      .single(),
    'deactivate knowledge'
  );

  await audit({
    actorType: 'USER',
    actorId: actor.id,
    action: 'knowledge.deactivated',
    entityType: 'knowledge_document',
    entityId: id,
    metadata: { slug: doc.slug },
  });

  return doc;
}
