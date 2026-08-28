/**
 * Policy retrieval (the RAG layer).
 *
 * Retrieval is PostgreSQL full-text search over a GENERATED tsvector, not
 * embeddings. That is a deliberate choice: the corpus is eight short governance
 * documents, so lexical search resolves them reliably, and it costs zero Gemini
 * quota. A vector index would add a migration, a backfill, an embedding call
 * per query, and a second failure mode, in exchange for recall this corpus does
 * not need. If the knowledge base ever grows past a few dozen documents, add a
 * pgvector column behind searchPolicy() — the interface will not change.
 *
 * Ranking is done here rather than in SQL because PostgREST does not expose
 * ts_rank through the query builder, and adding an RPC would mean another
 * migration the operator has to run by hand.
 */
import { supabase, unwrap } from '../config/supabase.js';

/**
 * Which policy categories govern which incident type.
 *
 * This mapping is the primary retrieval signal — it is deterministic and
 * cannot be steered by text in a customer message. Full-text relevance only
 * orders the candidates within it.
 */
export const INCIDENT_POLICY_CATEGORIES = {
  DELIVERY_DELAY: ['COMPENSATION', 'SHIPPING', 'PREMIUM_CUSTOMER'],
  PAYMENT_FAILURE: ['PAYMENT_FAILURE', 'ESCALATION'],
  INVENTORY_SHORTAGE: ['CANCELLATION', 'COMPENSATION', 'SHIPPING'],
  ORDER_CANCELLED: ['CANCELLATION', 'REFUND'],
  SUBSCRIPTION_ISSUE: ['PAYMENT_FAILURE', 'REFUND', 'ESCALATION'],
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'is', 'was', 'with',
  'customer', 'order', 'policy', 'this', 'that', 'has', 'have', 'been', 'are',
]);

/** @param {string} text */
function terms(text) {
  return (text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Turn a free-text query into something websearch_to_tsquery accepts.
 *
 * Quotes, parens and the boolean operators websearch understands are stripped:
 * the query is built partly from customer-supplied text, and that text is data,
 * not query syntax it gets to control.
 *
 * @param {string} query
 */
function sanitizeQuery(query) {
  const cleaned = terms(query).slice(0, 12);
  return cleaned.join(' OR ');
}

/**
 * Score a candidate against the query. Category match dominates so a lexical
 * coincidence in an unrelated document can never outrank the governing policy.
 *
 * @param {{ title: string, category: string, content: string }} doc
 * @param {string[]} queryTerms
 * @param {string[]} preferredCategories
 */
function score(doc, queryTerms, preferredCategories) {
  let total = 0;

  const categoryIndex = preferredCategories.indexOf(doc.category);
  if (categoryIndex === 0) total += 100;
  else if (categoryIndex > 0) total += 60 - categoryIndex * 10;

  const titleTerms = new Set(terms(doc.title));
  const contentTerms = new Set(terms(doc.content));
  for (const t of queryTerms) {
    if (titleTerms.has(t)) total += 10;
    if (contentTerms.has(t)) total += 1;
  }
  return total;
}

/**
 * Find the policy that governs a situation.
 *
 * @param {object} input
 * @param {string} input.query                Natural-language description of the situation.
 * @param {string} [input.incidentType]       Narrows to the governing categories.
 * @param {number} [input.limit=3]
 * @returns {Promise<Array<{id: string, slug: string, title: string, category: string, version: string, content: string, metadata: object, relevance: number}>>}
 *          Ordered best-first. EMPTY when nothing matches — callers must
 *          escalate rather than proceed, and must never invent a policy.
 */
export async function searchPolicy({ query, incidentType, limit = 3 }) {
  const preferred = INCIDENT_POLICY_CATEGORIES[incidentType] ?? [];
  const queryTerms = terms(query);

  let request = supabase
    .from('knowledge_documents')
    .select('id, slug, title, category, version, content, metadata')
    .eq('is_active', true);

  const tsQuery = sanitizeQuery(query);
  if (tsQuery) {
    request = request.textSearch('search_vector', tsQuery, { type: 'websearch' });
  }

  let rows = unwrap(await request, 'policy search');

  // Full-text found nothing (an unusual phrasing, or a query of only stop
  // words). Fall back to the deterministic category mapping rather than
  // returning empty and escalating a case we can actually govern.
  if (rows.length === 0 && preferred.length > 0) {
    rows = unwrap(
      await supabase
        .from('knowledge_documents')
        .select('id, slug, title, category, version, content, metadata')
        .eq('is_active', true)
        .in('category', preferred),
      'policy category fallback'
    );
  }

  return rows
    .map((doc) => ({ ...doc, relevance: score(doc, queryTerms, preferred) }))
    .sort((a, b) => b.relevance - a.relevance || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

/**
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getPolicyBySlug(slug) {
  return unwrap(
    await supabase
      .from('knowledge_documents')
      .select('id, slug, title, category, version, content, metadata, is_active')
      .eq('slug', slug)
      .maybeSingle(),
    'policy by slug'
  );
}

/**
 * Build the retrieval query for an incident and customer.
 * Kept here so the agent, the API and the tests all phrase it identically.
 *
 * @param {{ incidentType: string, segment: string, delayHours?: number, orderAmount?: number }} ctx
 */
export function buildPolicyQuery({ incidentType, segment, delayHours = 0, orderAmount = 0 }) {
  const parts = [incidentType.replace(/_/g, ' ').toLowerCase()];
  if (segment === 'PREMIUM') parts.push('premium customer');
  if (delayHours > 48) parts.push('delay greater than 48 hours compensation credit');
  else if (delayHours > 24) parts.push('delivery delay notification');
  if (orderAmount >= 5000) parts.push('high value order');
  return parts.join(' ');
}
