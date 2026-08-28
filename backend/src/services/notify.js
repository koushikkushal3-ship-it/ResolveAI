/**
 * Customer notification — simulated.
 *
 * No live SMS, email or WhatsApp provider. The hackathon brief requires the
 * demo to work without third-party integrations, and a real provider would add
 * an outbound dependency that can fail in front of a judge.
 *
 * The simulation is not a stub, though: it writes a real conversation and
 * message row, so the notification appears in the customer's timeline, feeds
 * the analytics count, and is visible in Customer 360 exactly as a real one
 * would be. Only the transport is absent.
 */
import { supabase, unwrap } from '../config/supabase.js';
import { audit } from '../utils/audit.js';

/**
 * @param {object} input
 * @param {string} input.customerId
 * @param {string|null} [input.incidentId]
 * @param {string} input.message
 * @param {string} [input.channel]  Falls back to the customer's preference.
 * @param {string|null} [input.actorId]
 * @returns {Promise<{ conversationId: string, channel: string, deliveredAt: string }>}
 */
export async function sendCustomerNotification({
  customerId,
  incidentId = null,
  message,
  channel,
  actorId = null,
}) {
  const customer = unwrap(
    await supabase
      .from('profiles')
      .select('id, name, preferred_channel')
      .eq('id', customerId)
      .maybeSingle(),
    'notify: load customer'
  );
  if (!customer) throw new Error('Cannot notify an unknown customer');

  const resolvedChannel = channel ?? customer.preferred_channel;

  const conversation = unwrap(
    await supabase
      .from('conversations')
      .insert({
        customer_id: customerId,
        incident_id: incidentId,
        channel: resolvedChannel,
        sentiment: 'NEUTRAL',
        summary: 'Proactive outreach: customer notified of an incident and its resolution.',
        is_complaint: false,
        // Excluded from the risk engine's sentiment signal. A message the
        // business sends is not evidence of how the customer feels — without
        // this, resolving a HIGH-risk customer lowered their own risk score.
        is_outbound: true,
        status: 'OPEN',
      })
      .select('id')
      .single(),
    'notify: create conversation'
  );

  unwrap(
    await supabase
      .from('messages')
      .insert({ conversation_id: conversation.id, sender: 'AI', content: message })
      .select('id')
      .single(),
    'notify: create message'
  );

  const deliveredAt = new Date().toISOString();

  await audit({
    actorType: 'AI',
    actorId,
    action: 'notification.sent',
    entityType: 'conversation',
    entityId: conversation.id,
    // The message body is stored in messages; logging it again would duplicate
    // customer content into the audit trail for no benefit.
    metadata: { customerId, channel: resolvedChannel, simulated: true },
  });

  return { conversationId: conversation.id, channel: resolvedChannel, deliveredAt };
}
