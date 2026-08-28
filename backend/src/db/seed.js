/**
 * ResolveAI deterministic seed.
 *
 *   cd backend && npm run seed
 *
 * Idempotent: clears every table in foreign-key order, then rebuilds.
 *
 * "Deterministic" here means the numbers the demo narrative depends on are
 * hand-authored, not generated: the primary incident hits exactly 17 orders,
 * exactly 5 of those customers land in HIGH risk, and Priya Sharma scores
 * exactly 91. Filler records use a seeded PRNG so repeat runs are identical.
 *
 * Delays are anchored to run time (expected = now - delayHours, eta = now), so
 * the data always looks current while the computed delay stays exact.
 *
 * The script asserts its own invariants at the end and exits non-zero if the
 * demo shape ever drifts.
 */
import bcrypt from 'bcrypt';
import { supabase } from '../config/supabase.js';
import { calculateCXRisk } from '../services/risk.js';

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Seeded PRNG (mulberry32). Fixed seed => identical filler on every run. */
function rng(seed = 20260828) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const intBetween = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const iso = (ms) => new Date(ms).toISOString();

const DEMO_PASSWORD = 'ResolveAI#2026';

// -----------------------------------------------------------------------------
// The 17 customers hit by the primary delivery-delay incident.
//
// Grouped by the risk band each one must land in. The values are chosen so the
// deterministic engine produces 5 HIGH / 6 MEDIUM / 6 LOW — asserted below.
// -----------------------------------------------------------------------------
const AFFECTED = [
  // --- 5 HIGH -----------------------------------------------------------------
  // The demo hero. 20+30+15+15+10+1 = 91.
  { name: 'Priya Sharma',     segment: 'PREMIUM',  ltv:  50_000, amount:  8_999, delayHours: 72, complaints: 1, sentiment: 'NEGATIVE', incidents90d: 1, product: 'Noise Cancelling Headphones' },
  { name: 'Rajesh Iyer',      segment: 'PREMIUM',  ltv: 210_000, amount: 15_499, delayHours: 60, complaints: 1, sentiment: 'NEGATIVE', incidents90d: 1, product: 'Smart Home Hub' },
  { name: 'Vikram Nair',      segment: 'STANDARD', ltv: 160_000, amount: 22_000, delayHours: 72, complaints: 1, sentiment: 'NEGATIVE', incidents90d: 2, product: 'Espresso Machine' },
  { name: 'Meera Krishnan',   segment: 'PREMIUM',  ltv:  55_000, amount:  9_500, delayHours: 50, complaints: 1, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Air Purifier' },
  { name: 'Ananya Desai',     segment: 'PREMIUM',  ltv:  95_000, amount:  6_200, delayHours: 54, complaints: 0, sentiment: 'NEGATIVE', incidents90d: 1, product: 'Fitness Tracker' },

  // --- 6 MEDIUM ---------------------------------------------------------------
  { name: 'Nisha Verma',      segment: 'NEW',      ltv:   5_000, amount:  8_900, delayHours: 52, complaints: 1, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Tablet Stand Pro' },
  { name: 'Divya Pillai',     segment: 'PREMIUM',  ltv:  40_000, amount:  2_400, delayHours: 28, complaints: 1, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Wireless Mouse' },
  { name: 'Arjun Reddy',      segment: 'PREMIUM',  ltv:  30_000, amount:  3_200, delayHours: 50, complaints: 0, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Bluetooth Speaker' },
  { name: 'Karthik Rao',      segment: 'STANDARD', ltv: 110_000, amount:  5_600, delayHours: 55, complaints: 0, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Mechanical Keyboard' },
  { name: 'Sanjay Gupta',     segment: 'STANDARD', ltv:  20_000, amount: 11_000, delayHours: 60, complaints: 0, sentiment: 'NEUTRAL',  incidents90d: 1, product: '4K Monitor' },
  { name: 'Kavya Menon',      segment: 'STANDARD', ltv:  80_000, amount:  7_800, delayHours: 40, complaints: 0, sentiment: 'NEGATIVE', incidents90d: 1, product: 'Robot Vacuum' },

  // --- 6 LOW ------------------------------------------------------------------
  { name: 'Rohit Sharma',     segment: 'STANDARD', ltv:  12_000, amount:  1_200, delayHours: 26, complaints: 0, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Phone Case' },
  { name: 'Sneha Joshi',      segment: 'NEW',      ltv:   3_000, amount:    900, delayHours: 30, complaints: 0, sentiment: 'POSITIVE', incidents90d: 1, product: 'USB-C Cable Set' },
  { name: 'Pooja Shah',       segment: 'STANDARD', ltv:  25_000, amount:  1_800, delayHours: 27, complaints: 0, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Desk Lamp' },
  { name: 'Lakshmi Iyer',     segment: 'STANDARD', ltv:  45_000, amount:  4_200, delayHours: 25, complaints: 0, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Backpack' },
  { name: 'Aditya Bose',      segment: 'STANDARD', ltv:  18_000, amount:  2_100, delayHours: 20, complaints: 0, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Webcam HD' },
  { name: 'Manish Agarwal',   segment: 'NEW',      ltv:   2_000, amount:  3_400, delayHours: 22, complaints: 0, sentiment: 'NEUTRAL',  incidents90d: 1, product: 'Portable SSD' },
];

/** 33 further customers, so the directory holds 50. */
const FILLER_NAMES = [
  'Aarav Malhotra', 'Ishita Bhatt', 'Rahul Chatterjee', 'Sana Qureshi', 'Devansh Kapoor',
  'Tanvi Deshmukh', 'Nikhil Saxena', 'Ritu Bansal', 'Aryan Sinha', 'Neha Kulkarni',
  'Siddharth Ghosh', 'Preeti Rawat', 'Varun Chopra', 'Anjali Mishra', 'Harsh Vardhan',
  'Swati Trivedi', 'Gaurav Bhatia', 'Ritika Sen', 'Abhishek Dubey', 'Mitali Roy',
  'Yash Thakur', 'Aditi Chauhan', 'Rohan Bajaj', 'Shreya Naidu', 'Kunal Mehta',
  'Payal Jain', 'Imran Sheikh', 'Deepa Subramanian', 'Akash Tiwari', 'Bhavna Patel',
  'Suresh Babu', 'Lavanya Reddy', 'Tarun Khanna',
];

const PRODUCTS = [
  'Noise Cancelling Headphones', 'Smart Watch Series 5', 'Laptop Sleeve', 'Standing Desk Converter',
  'Ergonomic Chair', 'Instant Camera', 'Yoga Mat Premium', 'Coffee Grinder', 'Electric Kettle',
  'Gaming Mouse Pad', 'Power Bank 20000mAh', 'Wireless Earbuds', 'Action Camera', 'Water Bottle Steel',
  'Bookshelf Speaker', 'Induction Cooktop',
];
const CARRIERS = ['BlueDart', 'Delhivery', 'Ekart', 'DTDC', 'India Post'];

// -----------------------------------------------------------------------------
// Policy knowledge base. Retrieval is PostgreSQL full-text search over these,
// so no embeddings and therefore no Gemini quota.
// -----------------------------------------------------------------------------
const POLICIES = [
  {
    slug: 'delivery-compensation-v2',
    title: 'Delivery Delay Compensation Policy',
    category: 'COMPENSATION',
    version: 'v2',
    content:
      'Premium customers experiencing delivery delays greater than 48 hours may receive priority shipping ' +
      'at no cost, or a wallet credit of up to Rs 500, or both. Standard customers with delays greater than ' +
      '72 hours may receive a wallet credit of up to Rs 300. Any compensation above Rs 500 requires ' +
      'supervisor approval before it is issued. Compensation for a single customer may not exceed Rs 1000 ' +
      'within a rolling 24 hour window. Delays under 24 hours do not qualify for monetary compensation, ' +
      'but the customer should still receive a proactive delay notification.',
    metadata: { maxAutoCredit: 500, dailyCap: 1000, appliesTo: ['DELIVERY_DELAY'] },
  },
  {
    slug: 'shipping-policy',
    title: 'Shipping and Delivery Policy',
    category: 'SHIPPING',
    version: 'v3',
    content:
      'Standard shipping is delivered within 5 to 7 business days. Express shipping is delivered within 2 to ' +
      '3 business days. Priority delivery is delivered on the next business day and may be granted to resolve ' +
      'a qualifying delay at no charge to the customer. Carrier hub disruptions, weather events and strikes ' +
      'are logged as operational incidents. Customers must be notified proactively when the estimated ' +
      'delivery date moves by more than 24 hours.',
    metadata: { appliesTo: ['DELIVERY_DELAY', 'INVENTORY_SHORTAGE'] },
  },
  {
    slug: 'premium-customer-policy',
    title: 'Premium Customer Service Standards',
    category: 'PREMIUM_CUSTOMER',
    version: 'v2',
    content:
      'Premium customers receive priority handling on every support interaction and a guaranteed first ' +
      'response within 2 hours. Premium customers are eligible for enhanced compensation limits and for ' +
      'free priority delivery when an order is delayed. A premium customer with a previous unresolved ' +
      'complaint must be routed for proactive outreach before any automated resolution is closed. Premium ' +
      'status is determined by segment, not by order value.',
    metadata: { responseHours: 2, appliesTo: ['DELIVERY_DELAY', 'PAYMENT_FAILURE'] },
  },
  {
    slug: 'payment-failure-policy',
    title: 'Payment Failure Handling Policy',
    category: 'PAYMENT_FAILURE',
    version: 'v1',
    content:
      'When a payment fails, the order is held for 48 hours before cancellation. The customer must be ' +
      'notified through their preferred channel with a secure link to retry payment. Support agents and ' +
      'automated systems must never request, collect, store or modify card details, UPI credentials or bank ' +
      'information. Any change to a stored payment method requires the customer to act themselves and ' +
      'requires human approval before any account change is recorded. Repeated failures on a high value ' +
      'order should be escalated to a human agent.',
    metadata: { holdHours: 48, requiresHumanApproval: true, appliesTo: ['PAYMENT_FAILURE'] },
  },
  {
    slug: 'refund-policy',
    title: 'Refund Policy',
    category: 'REFUND',
    version: 'v2',
    content:
      'Refunds are issued to the original payment method within 5 to 7 business days of approval. Orders ' +
      'may be refunded in full when they are cancelled before dispatch, when they arrive damaged, or when ' +
      'delivery fails entirely. Partial refunds and goodwill credits are treated as compensation and follow ' +
      'the compensation policy limits. Refunds above Rs 5000 require supervisor approval.',
    metadata: { supervisorThreshold: 5000, appliesTo: ['ORDER_CANCELLED', 'DELIVERY_DELAY'] },
  },
  {
    slug: 'cancellation-policy',
    title: 'Order Cancellation Policy',
    category: 'CANCELLATION',
    version: 'v1',
    content:
      'Customers may cancel an order at any time before dispatch for a full refund. After dispatch, the ' +
      'order must be returned before a refund is processed. When stock is unavailable and the order cannot ' +
      'be fulfilled, the business cancels the order, refunds it in full, and offers a goodwill credit within ' +
      'compensation policy limits. An inventory driven cancellation always requires a proactive notification.',
    metadata: { appliesTo: ['ORDER_CANCELLED', 'INVENTORY_SHORTAGE'] },
  },
  {
    slug: 'escalation-policy',
    title: 'Escalation Policy',
    category: 'ESCALATION',
    version: 'v2',
    content:
      'A case must be escalated to a human agent when no governing policy can be found, when the automated ' +
      'system reports low confidence in its recommendation, when the proposed compensation exceeds the ' +
      'automatic limit, when the action would change a payment method or account setting, or when the ' +
      'customer has an unresolved complaint on record. Escalated cases retain the full decision trail and ' +
      'must never be closed automatically.',
    metadata: { confidenceFloor: 0.7, appliesTo: ['ALL'] },
  },
  {
    slug: 'privacy-policy',
    title: 'Customer Data and Privacy Policy',
    category: 'PRIVACY',
    version: 'v1',
    content:
      'Customer personal data is used only to resolve the customer own orders and support cases. Payment ' +
      'credentials are never stored in the support system. Automated systems may read order history, ' +
      'conversation summaries and segment data to determine an appropriate resolution, and must not include ' +
      'personal identifiers beyond the customer name in any generated message. Data access is logged in the ' +
      'audit trail.',
    metadata: { appliesTo: ['ALL'] },
  },
];

// -----------------------------------------------------------------------------

async function clearAll() {
  // Child rows first: several FKs are RESTRICT, so order matters.
  const order = [
    'audit_logs',
    'actions',
    'messages',
    'conversations',
    'customer_incidents',
    'orders',
    'incidents',
    'knowledge_documents',
    'profiles',
    'app_users',
  ];
  for (const table of order) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`clear ${table}: ${error.message}`);
  }
  console.log('  cleared 10 tables');
}

async function insert(table, rows, select = 'id') {
  if (!rows.length) return [];
  const out = [];
  // Chunked: a 150-row insert in one request is fine, but chunking keeps the
  // payload predictable and the error message small when a constraint trips.
  for (let i = 0; i < rows.length; i += 50) {
    const { data, error } = await supabase
      .from(table)
      .insert(rows.slice(i, i + 50))
      .select(select);
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    out.push(...data);
  }
  return out;
}

async function main() {
  console.log('Seeding ResolveAI...');
  await clearAll();

  // --- users ----------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = await insert(
    'app_users',
    [
      { email: 'admin@resolveai.demo', password_hash: passwordHash, full_name: 'Aisha Rahman', role: 'ADMIN' },
      { email: 'supervisor@resolveai.demo', password_hash: passwordHash, full_name: 'Daniel Okafor', role: 'SUPERVISOR' },
      { email: 'agent@resolveai.demo', password_hash: passwordHash, full_name: 'Leena Fernandes', role: 'AGENT' },
    ],
    'id, email, role'
  );
  const admin = users.find((u) => u.role === 'ADMIN');
  const supervisor = users.find((u) => u.role === 'SUPERVISOR');
  const agent = users.find((u) => u.role === 'AGENT');
  console.log(`  ${users.length} users`);

  // --- policies -------------------------------------------------------------
  await insert(
    'knowledge_documents',
    POLICIES.map((p) => ({ ...p, created_by: admin.id }))
  );
  console.log(`  ${POLICIES.length} policy documents`);

  // --- customers ------------------------------------------------------------
  const slug = (n) => n.toLowerCase().replace(/[^a-z]+/g, '.');
  const channels = ['EMAIL', 'SMS', 'WHATSAPP', 'PHONE'];

  const affectedRows = AFFECTED.map((c) => ({
    name: c.name,
    email: `${slug(c.name)}@example.com`,
    phone: `+91 98${intBetween(10000000, 99999999)}`,
    segment: c.segment,
    lifetime_value: c.ltv,
    preferred_channel: c.segment === 'PREMIUM' ? 'WHATSAPP' : pick(channels),
  }));

  const fillerRows = FILLER_NAMES.map((name) => {
    const segment = pick(['PREMIUM', 'STANDARD', 'STANDARD', 'NEW']);
    return {
      name,
      email: `${slug(name)}@example.com`,
      phone: `+91 97${intBetween(10000000, 99999999)}`,
      segment,
      lifetime_value:
        segment === 'PREMIUM' ? intBetween(60, 300) * 1000 : segment === 'NEW' ? intBetween(1, 9) * 1000 : intBetween(10, 90) * 1000,
      preferred_channel: pick(channels),
    };
  });

  const customers = await insert('profiles', [...affectedRows, ...fillerRows], 'id, name, segment, lifetime_value');
  const byName = new Map(customers.map((c) => [c.name, c]));
  console.log(`  ${customers.length} customers`);

  // --- incidents ------------------------------------------------------------
  const primaryIncident = {
    type: 'DELIVERY_DELAY',
    severity: 'HIGH',
    title: 'Carrier hub delay — BlueDart North Zone',
    description:
      'BlueDart North Zone sorting hub reported a 72-hour processing backlog following a facility closure. ' +
      'Outbound shipments routed through this hub are delayed. Downstream ETAs have been revised.',
    status: 'OPEN',
    started_at: iso(NOW - 6 * HOUR),
    created_by: admin.id,
  };

  const otherIncidents = [
    { type: 'PAYMENT_FAILURE', severity: 'HIGH', title: 'Payment gateway timeouts — UPI', description: 'Elevated UPI authorization timeouts at the payment provider.', status: 'INVESTIGATING', offsetDays: 1 },
    { type: 'INVENTORY_SHORTAGE', severity: 'MEDIUM', title: 'Stockout — Wireless Earbuds', description: 'Supplier shipment delayed; SKU oversold across two warehouses.', status: 'MITIGATING', offsetDays: 2 },
    { type: 'DELIVERY_DELAY', severity: 'MEDIUM', title: 'Weather disruption — Chennai region', description: 'Heavy rainfall halted last-mile delivery for 36 hours.', status: 'RESOLVED', offsetDays: 5 },
    { type: 'ORDER_CANCELLED', severity: 'LOW', title: 'Bulk cancellation — pricing error', description: 'A pricing configuration error caused incorrect listings; affected orders cancelled and refunded.', status: 'RESOLVED', offsetDays: 7 },
    { type: 'SUBSCRIPTION_ISSUE', severity: 'MEDIUM', title: 'Renewal billing failures', description: 'Subscription renewals failing for cards issued by one bank.', status: 'RESOLVED', offsetDays: 9 },
    { type: 'PAYMENT_FAILURE', severity: 'LOW', title: 'Card decline spike — international', description: 'Higher than usual decline rate on international cards.', status: 'RESOLVED', offsetDays: 11 },
    { type: 'DELIVERY_DELAY', severity: 'LOW', title: 'Courier strike — Pune', description: 'Local courier partner strike delayed deliveries by 24 hours.', status: 'RESOLVED', offsetDays: 13 },
    { type: 'INVENTORY_SHORTAGE', severity: 'HIGH', title: 'Stockout — Air Purifier', description: 'Festive demand exhausted stock ahead of replenishment.', status: 'RESOLVED', offsetDays: 15 },
    { type: 'DELIVERY_DELAY', severity: 'MEDIUM', title: 'Address verification backlog', description: 'Manual address verification queue grew beyond SLA.', status: 'RESOLVED', offsetDays: 17 },
    { type: 'ORDER_CANCELLED', severity: 'LOW', title: 'Fraud screening false positives', description: 'Fraud rules incorrectly cancelled legitimate orders.', status: 'RESOLVED', offsetDays: 19 },
    { type: 'PAYMENT_FAILURE', severity: 'MEDIUM', title: 'Wallet top-up failures', description: 'Wallet top-ups failing intermittently.', status: 'RESOLVED', offsetDays: 21 },
    { type: 'SUBSCRIPTION_ISSUE', severity: 'LOW', title: 'Plan downgrade not applied', description: 'Downgrades not reflected until the next cycle.', status: 'RESOLVED', offsetDays: 23 },
    { type: 'INVENTORY_SHORTAGE', severity: 'MEDIUM', title: 'Warehouse mis-pick rate', description: 'Elevated mis-picks at the Bengaluru warehouse.', status: 'RESOLVED', offsetDays: 25 },
    { type: 'DELIVERY_DELAY', severity: 'LOW', title: 'Festival volume surge', description: 'Seasonal volume pushed delivery times beyond SLA.', status: 'RESOLVED', offsetDays: 27 },
    { type: 'ORDER_CANCELLED', severity: 'MEDIUM', title: 'Supplier recall', description: 'Supplier recalled a batch; affected orders cancelled.', status: 'RESOLVED', offsetDays: 29 },
    { type: 'PAYMENT_FAILURE', severity: 'LOW', title: 'Netbanking maintenance', description: 'Scheduled bank maintenance blocked netbanking payments.', status: 'RESOLVED', offsetDays: 31 },
    { type: 'SUBSCRIPTION_ISSUE', severity: 'MEDIUM', title: 'Duplicate charge on renewal', description: 'A retry bug double-charged a subset of renewals.', status: 'RESOLVED', offsetDays: 33 },
    { type: 'DELIVERY_DELAY', severity: 'MEDIUM', title: 'Hub relocation downtime', description: 'Planned hub relocation extended transit times.', status: 'RESOLVED', offsetDays: 35 },
    { type: 'INVENTORY_SHORTAGE', severity: 'LOW', title: 'Accessory bundle shortfall', description: 'Bundle components out of sync across warehouses.', status: 'RESOLVED', offsetDays: 37 },
  ].map((i) => {
    const startedAt = NOW - i.offsetDays * DAY;
    return {
      type: i.type,
      severity: i.severity,
      title: i.title,
      description: i.description,
      status: i.status,
      started_at: iso(startedAt),
      // The CHECK constraint requires resolved_at exactly when status is RESOLVED.
      resolved_at: i.status === 'RESOLVED' ? iso(startedAt + intBetween(6, 40) * HOUR) : null,
      created_by: admin.id,
    };
  });

  const incidents = await insert('incidents', [primaryIncident, ...otherIncidents], 'id, type, title, status');
  const primary = incidents[0];
  console.log(`  ${incidents.length} incidents`);

  // --- orders ---------------------------------------------------------------
  let orderSeq = 1000;
  const nextOrderNumber = () => `RA-${++orderSeq}`;

  // The 17 delayed orders. expected = now - delayHours, eta = now, so the
  // computed delay is exactly the authored value however long ago this ran.
  const affectedOrders = AFFECTED.map((c) => ({
    customer_id: byName.get(c.name).id,
    order_number: nextOrderNumber(),
    product_name: c.product,
    amount: c.amount,
    status: 'DELAYED',
    expected_delivery: iso(NOW - c.delayHours * HOUR),
    current_eta: iso(NOW),
    carrier: 'BlueDart',
    priority: c.segment === 'PREMIUM' ? 'EXPRESS' : 'STANDARD',
    // Every row in a batch must carry the same keys. PostgREST builds one
    // INSERT from the union of keys across the batch, so a row missing a key
    // gets an explicit NULL rather than the column default.
    created_at: iso(NOW - (c.delayHours + 120) * HOUR),
  }));

  const otherOrders = [];
  for (let i = 0; i < 150 - AFFECTED.length; i++) {
    const customer = customers[intBetween(0, customers.length - 1)];
    const placedAt = NOW - intBetween(1, 90) * DAY;
    const status = pick([
      'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED',
      'IN_TRANSIT', 'SHIPPED', 'PROCESSING', 'PLACED',
      'CANCELLED', 'PAYMENT_FAILED',
    ]);
    otherOrders.push({
      customer_id: customer.id,
      order_number: nextOrderNumber(),
      product_name: pick(PRODUCTS),
      amount: intBetween(4, 240) * 100 + 99,
      status,
      expected_delivery: iso(placedAt + 5 * DAY),
      current_eta: iso(placedAt + 5 * DAY),
      carrier: pick(CARRIERS),
      priority: pick(['STANDARD', 'STANDARD', 'EXPRESS', 'PRIORITY']),
      created_at: iso(placedAt),
    });
  }

  const orders = await insert('orders', [...affectedOrders, ...otherOrders], 'id, customer_id, order_number');
  const affectedOrderByCustomer = new Map();
  for (let i = 0; i < AFFECTED.length; i++) {
    affectedOrderByCustomer.set(AFFECTED[i].name, orders[i].id);
  }
  console.log(`  ${orders.length} orders`);

  // --- conversations and messages -------------------------------------------
  const conversationRows = [];
  const complaintOwners = AFFECTED.filter((c) => c.complaints > 0);

  for (const c of complaintOwners) {
    conversationRows.push({
      customer_id: byName.get(c.name).id,
      channel: 'EMAIL',
      sentiment: c.sentiment,
      summary: `Customer reported a previous delivery issue and asked for a firm delivery commitment. Unresolved at close.`,
      is_complaint: true,
      status: 'RESOLVED',
      created_at: iso(NOW - intBetween(20, 60) * DAY),
    });
  }
  // Current-sentiment threads for everyone affected who is not neutral.
  for (const c of AFFECTED) {
    if (c.sentiment === 'NEUTRAL') continue;
    conversationRows.push({
      customer_id: byName.get(c.name).id,
      channel: pick(channels),
      sentiment: c.sentiment,
      summary:
        c.sentiment === 'NEGATIVE'
          ? 'Customer expressed frustration about the delayed shipment and the lack of proactive updates.'
          : 'Customer acknowledged the delay notification and thanked the team for the early heads-up.',
      is_complaint: false,
      status: 'OPEN',
      created_at: iso(NOW - intBetween(1, 4) * DAY),
    });
  }
  // Filler threads to reach 30.
  while (conversationRows.length < 30) {
    const customer = customers[intBetween(0, customers.length - 1)];
    conversationRows.push({
      customer_id: customer.id,
      channel: pick(channels),
      sentiment: pick(['POSITIVE', 'NEUTRAL', 'NEUTRAL', 'NEGATIVE']),
      summary: pick([
        'Customer asked about the delivery window for an upcoming order.',
        'Customer requested an invoice copy for a completed order.',
        'Customer asked how to change the delivery address before dispatch.',
        'Customer queried the refund timeline for a cancelled order.',
        'Customer reported a packaging issue and accepted a replacement.',
      ]),
      is_complaint: rand() < 0.25,
      status: pick(['OPEN', 'RESOLVED', 'CLOSED']),
      created_at: iso(NOW - intBetween(2, 80) * DAY),
    });
  }

  const conversations = await insert('conversations', conversationRows, 'id, customer_id, sentiment');
  console.log(`  ${conversations.length} conversations`);

  const messageRows = [];
  for (const conv of conversations.slice(0, 20)) {
    messageRows.push(
      {
        conversation_id: conv.id,
        sender: 'CUSTOMER',
        content:
          conv.sentiment === 'NEGATIVE'
            ? 'My order still has not arrived and the tracking has not moved in two days. This is the second time.'
            : 'Hi, could you confirm when my order is expected to arrive?',
      },
      {
        conversation_id: conv.id,
        sender: 'AGENT',
        content:
          'Thanks for reaching out. I can see the shipment is affected by a carrier delay and I am checking the revised estimate now.',
      }
    );
  }
  await insert('messages', messageRows);
  console.log(`  ${messageRows.length} messages`);

  // --- customer_incidents with computed risk --------------------------------
  const ciRows = AFFECTED.map((c) => {
    const { score, level, factors } = calculateCXRisk({
      segment: c.segment,
      lifetimeValue: c.ltv,
      delayHours: c.delayHours,
      orderAmount: c.amount,
      priorComplaintCount: c.complaints,
      latestSentiment: c.sentiment,
      incidentCountLast90Days: c.incidents90d,
    });
    return {
      customer_id: byName.get(c.name).id,
      incident_id: primary.id,
      order_id: affectedOrderByCustomer.get(c.name),
      risk_score: score,
      risk_level: level,
      risk_factors: factors,
      status: 'IDENTIFIED',
    };
  });

  await insert('customer_incidents', ciRows);
  const bands = ciRows.reduce((acc, r) => ({ ...acc, [r.risk_level]: (acc[r.risk_level] ?? 0) + 1 }), {});
  console.log(`  ${ciRows.length} customer_incidents (HIGH ${bands.HIGH ?? 0} / MEDIUM ${bands.MEDIUM ?? 0} / LOW ${bands.LOW ?? 0})`);

  // --- historical actions ---------------------------------------------------
  const resolvedIncidents = incidents.filter((i) => i.status === 'RESOLVED');
  const actionRows = [];

  // A queue of pending approvals so /actions is not empty on first load.
  actionRows.push(
    {
      customer_id: byName.get('Vikram Nair').id,
      incident_id: primary.id,
      action_type: 'ISSUE_CREDIT',
      reason: 'Repeat delivery incident on a high-value order; compensation exceeds the automatic limit.',
      amount: 750,
      requires_approval: true,
      status: 'PROPOSED',
      policy_reference: 'delivery-compensation-v2',
      confidence: 0.88,
      ai_generated: true,
      customer_message:
        'Hello Vikram, your Espresso Machine order has been delayed by a carrier hub issue. We have applied a credit to your wallet and upgraded your delivery.',
      guardrail_result: { allowed: false, requiresApproval: true, reasons: ['credit_above_auto_limit'] },
      created_by: agent.id,
      approved_by: null,
      executed_at: null,
      created_at: iso(NOW - 3 * HOUR),
    },
    {
      customer_id: byName.get('Rajesh Iyer').id,
      incident_id: primary.id,
      action_type: 'PRIORITY_DELIVERY_AND_CREDIT',
      reason: 'Premium customer, 60-hour delay, previous complaint on record.',
      amount: 500,
      requires_approval: true,
      status: 'ESCALATED',
      policy_reference: 'escalation-policy',
      confidence: 0.64,
      ai_generated: true,
      customer_message: null,
      guardrail_result: { allowed: false, requiresApproval: true, reasons: ['low_confidence'] },
      created_by: agent.id,
      approved_by: null,
      executed_at: null,
      created_at: iso(NOW - 2 * HOUR),
    }
  );

  const historicalTypes = ['PRIORITY_DELIVERY', 'ISSUE_CREDIT', 'PRIORITY_DELIVERY_AND_CREDIT', 'NOTIFICATION_ONLY', 'REFUND'];
  while (actionRows.length < 30) {
    const customer = customers[intBetween(0, customers.length - 1)];
    const incident = resolvedIncidents[intBetween(0, resolvedIncidents.length - 1)];
    const type = pick(historicalTypes);
    const amount = type === 'NOTIFICATION_ONLY' || type === 'PRIORITY_DELIVERY' ? 0 : intBetween(1, 5) * 100;
    const status = pick(['EXECUTED', 'EXECUTED', 'EXECUTED', 'REJECTED', 'ESCALATED']);
    const createdAt = NOW - intBetween(1, 40) * DAY;
    const needsApproval = amount > 500;
    actionRows.push({
      customer_id: customer.id,
      incident_id: incident.id,
      action_type: type,
      reason: 'Automated resolution applied under the delivery compensation policy.',
      amount,
      requires_approval: needsApproval,
      status,
      policy_reference: amount > 0 ? 'delivery-compensation-v2' : 'shipping-policy',
      confidence: Number((0.72 + rand() * 0.26).toFixed(3)),
      ai_generated: true,
      customer_message: 'We noticed a delay on your order and have already taken steps to resolve it.',
      guardrail_result: { allowed: !needsApproval, requiresApproval: needsApproval, reasons: [] },
      created_by: agent.id,
      // Only an EXECUTED row may carry executed_at, and the approver may never
      // be the proposer — both are CHECK constraints in the schema.
      approved_by: needsApproval ? supervisor.id : null,
      executed_at: status === 'EXECUTED' ? iso(createdAt + HOUR) : null,
      created_at: iso(createdAt),
    });
  }

  await insert('actions', actionRows);
  console.log(`  ${actionRows.length} actions`);

  // --- invariants -----------------------------------------------------------
  // The demo narrative depends on these exact numbers. Fail loudly, not quietly.
  const priya = ciRows.find((r) => r.customer_id === byName.get('Priya Sharma').id);
  const checks = [
    ['customers = 50', customers.length === 50],
    ['orders = 150', orders.length === 150],
    ['incidents = 20', incidents.length === 20],
    ['conversations = 30', conversations.length === 30],
    ['actions = 30', actionRows.length === 30],
    ['policies = 8', POLICIES.length === 8],
    ['affected orders = 17', ciRows.length === 17],
    ['HIGH-risk customers = 5', (bands.HIGH ?? 0) === 5],
    ['Priya Sharma = 91 HIGH', priya.risk_score === 91 && priya.risk_level === 'HIGH'],
  ];

  console.log('\nInvariants:');
  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failed++;
  }

  if (failed) {
    console.error(`\n${failed} invariant(s) failed — the demo shape has drifted.`);
    process.exit(1);
  }

  console.log('\nSeed complete.');
  console.log(`Demo logins (password: ${DEMO_PASSWORD})`);
  console.log('  admin@resolveai.demo       ADMIN');
  console.log('  supervisor@resolveai.demo  SUPERVISOR');
  console.log('  agent@resolveai.demo       AGENT');
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
