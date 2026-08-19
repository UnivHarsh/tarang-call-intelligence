/**
 * Tarang — domain model.
 *
 * The whole product is one bet: a support call is unstructured only because
 * nobody has agreed on what structure to pull out of it. This file is that
 * agreement. Everything downstream — dashboard, alerting, Q&A — reads from
 * `CallInsight` and nothing else.
 */

export const INTENTS = [
  "order_tracking",
  "delivery_delay",
  "damaged_or_spoiled",
  "wrong_or_missing_item",
  "return_pickup",
  "refund_status",
  "cancellation",
  "offer_not_applied",
  "payment_failed",
  "quality_complaint",
  "address_change",
  "subscription_manage",
  "feedback_positive",
] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABELS: Record<Intent, string> = {
  order_tracking: "Order tracking",
  delivery_delay: "Delivery delay",
  damaged_or_spoiled: "Damaged / spoiled",
  wrong_or_missing_item: "Wrong / missing item",
  return_pickup: "Return pickup",
  refund_status: "Refund status",
  cancellation: "Cancellation",
  offer_not_applied: "Offer not applied",
  payment_failed: "Payment failed",
  quality_complaint: "Quality complaint",
  address_change: "Address change",
  subscription_manage: "Subscription",
  feedback_positive: "Positive feedback",
};

/**
 * Root cause is deliberately NOT the same field as intent.
 * Intent = what the customer asked for. Root cause = which team owns the fix.
 * Conflating them is the single most common mistake in support taxonomies and
 * it is why most "top issues" dashboards are useless to anyone but the CS lead.
 */
export const ROOT_CAUSES = [
  "logistics_3pl",
  "cold_chain",
  "warehouse_pick_error",
  "app_bug",
  "payment_gateway",
  "policy_friction",
  "inventory_stockout",
  "customer_expectation",
  "agent_error",
  "supplier_quality",
] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];

export const ROOT_CAUSE_LABELS: Record<RootCause, string> = {
  logistics_3pl: "Logistics / 3PL",
  cold_chain: "Cold chain",
  warehouse_pick_error: "Warehouse pick error",
  app_bug: "App bug",
  payment_gateway: "Payment gateway",
  policy_friction: "Policy friction",
  inventory_stockout: "Stockout",
  customer_expectation: "Expectation gap",
  agent_error: "Agent error",
  supplier_quality: "Supplier quality",
};

/** Which team gets paged. Root cause maps to exactly one owner. */
export const ROOT_CAUSE_OWNER: Record<RootCause, string> = {
  logistics_3pl: "Ops — Last mile",
  cold_chain: "Ops — Cold chain",
  warehouse_pick_error: "Ops — Fulfilment",
  app_bug: "Engineering",
  payment_gateway: "Engineering — Payments",
  policy_friction: "Product / Policy",
  inventory_stockout: "Category / Supply",
  customer_expectation: "Marketing / PDP",
  agent_error: "CS Quality",
  supplier_quality: "Category / QC",
};

export const RESOLUTIONS = [
  "resolved_self_serve",
  "refund_initiated",
  "replacement_scheduled",
  "pickup_scheduled",
  "info_provided",
  "escalated_human",
  "callback_promised",
  "unresolved",
] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  resolved_self_serve: "Resolved on call",
  refund_initiated: "Refund initiated",
  replacement_scheduled: "Replacement scheduled",
  pickup_scheduled: "Pickup scheduled",
  info_provided: "Info provided",
  escalated_human: "Escalated to human",
  callback_promised: "Callback promised",
  unresolved: "Unresolved",
};

export type Speaker = "agent" | "customer";

export interface Turn {
  /** Speaker of this turn. */
  role: Speaker;
  /** Verbatim text as transcribed (code-mixed Hinglish is kept as-is). */
  text: string;
  /** Offset from call start, milliseconds. */
  tMs: number;
  /** ASR confidence 0-1. Low values are the ones worth eyeballing. */
  conf: number;
}

export interface Quote {
  text: string;
  tMs: number;
  /** Why this line was pulled out: the thing a human would highlight. */
  tag: string;
}

export interface ProductSignal {
  title: string;
  evidence: string;
  severity: "low" | "medium" | "high";
  /** Team that can act on it. */
  owner: string;
}

export interface AgentCompliance {
  greeting: boolean;
  identityVerified: boolean;
  empathyShown: boolean;
  correctPolicyQuoted: boolean;
  closedTheLoop: boolean;
}

export interface Customer {
  id: string;
  name: string;
  city: string;
  /** Cohort by lifetime order count. */
  segment: "new" | "growing" | "loyal" | "vip";
  lifetimeOrders: number;
}

export interface OrderRef {
  id: string;
  valueInr: number;
  category: string;
  items: string[];
  placedAt: string;
  promisedAt: string;
  status: string;
}

/** The single record everything downstream reads. */
export interface CallInsight {
  // ---- call metadata (known before any AI runs) ----
  id: string;
  startedAt: string;
  durationSec: number;
  direction: "inbound" | "outbound";
  /** Whether the voice agent handled it or it went to a human. */
  handledBy: "voice_agent" | "human_agent";
  language: "hinglish" | "english" | "hindi";
  customer: Customer;
  order: OrderRef | null;
  transcript: Turn[];
  /** ASR word error rate estimate for this call, 0-1. */
  asrWer: number;

  // ---- extracted by the LLM pass ----
  summary: string;
  primaryIntent: Intent;
  secondaryIntents: Intent[];
  rootCause: RootCause;
  rootCauseNote: string;
  sentimentStart: number; // -1..1
  sentimentEnd: number; // -1..1
  csatPredicted: number; // 1..5
  resolved: boolean;
  resolution: Resolution;
  /** Handled fully by the agent with no human handoff. */
  contained: boolean;
  handoffReason: string | null;
  escalationRisk: number; // 0..1
  churnRisk: number; // 0..1
  repeatCaller: boolean;
  refundRequested: boolean;
  refundAmountInr: number;
  productMentions: string[];
  competitorMentions: string[];
  policyFriction: string[];
  agentCompliance: AgentCompliance;
  quotes: Quote[];
  productSignal: ProductSignal | null;
  tags: string[];
  nextBestAction: string;

  // ---- provenance ----
  /** How this record's insight fields were produced. */
  extractedBy: "seed" | "llm" | "local-fallback";
  extractionMs?: number;
  extractionCostUsd?: number;
}

/** Fields the eval harness scores the LLM on, against the seeded ground truth. */
export const EVAL_FIELDS = [
  "primaryIntent",
  "rootCause",
  "resolution",
  "resolved",
  "contained",
  "refundRequested",
  "csatPredicted",
  "escalationRisk",
  "churnRisk",
] as const;
export type EvalField = (typeof EVAL_FIELDS)[number];
