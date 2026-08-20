import { DEFAULT_MODEL } from "./prompt";

/**
 * Model fallback.
 *
 * The newest Flash models return 503 "high demand" in bursts — during testing
 * the primary was unavailable for minutes at a time. Retrying the same model
 * harder does not help when the whole model is saturated, and dropping straight
 * to the keyword engine means a visitor sees regex output and concludes the
 * project does not work.
 *
 * So a transient failure walks down a chain of progressively lighter models
 * instead. Quality degrades a little; the pipeline keeps running. Which model
 * actually served the call is returned and shown in the UI, so a degraded
 * answer never silently passes as the primary one.
 */

/** Transient: worth another model. A bad key or bad request is not. */
const TRANSIENT = /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|deadline|timeout/i;

/** Permanently wrong model for this key — skip it and move on immediately. */
const UNAVAILABLE = /\b404\b|NOT_FOUND|no longer available|is not found|unsupported/i;

export function modelChain(): string[] {
  const primary = process.env.TARANG_MODEL || DEFAULT_MODEL;
  // Best quality first, then FASTEST, then slowest.
  //
  // Not an obvious order until you measure it: on this workload 3.7 answered in
  // ~2s, Flash-Lite in ~1s, and 3.6 in ~7s and up. When the primary is
  // saturated the user is already waiting, so the second choice should be the
  // quick one — falling through to the slowest model turned a 2s extraction
  // into a 45s one.
  const rest = ["gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash"];
  return [primary, ...rest.filter((m) => m !== primary)];
}

export interface ChainResult<T> {
  value: T;
  model: string;
  /** Models tried and rejected before this one succeeded. */
  skipped: { model: string; reason: string }[];
}

/**
 * Runs `attempt` against each model in turn.
 *
 * One try per model by default: when a model answers 503 it is saturated, and
 * retrying the same one costs seconds to usually fail again. The chain itself
 * is the resilience, not the retry count.
 */
export async function runWithFallback<T>(
  models: string[],
  attempt: (model: string) => Promise<T>,
  perModelRetries = 1,
): Promise<ChainResult<T>> {
  const skipped: { model: string; reason: string }[] = [];
  let last: unknown;

  for (const model of models) {
    for (let i = 0; i < perModelRetries; i++) {
      try {
        return { value: await attempt(model), model, skipped };
      } catch (err) {
        last = err;
        const message = err instanceof Error ? err.message : String(err);

        if (UNAVAILABLE.test(message)) {
          skipped.push({ model, reason: "not available on this key" });
          break;
        }
        if (!TRANSIENT.test(message)) throw err; // bad key, bad schema — stop.

        const lastTry = i === perModelRetries - 1;
        if (lastTry) {
          skipped.push({ model, reason: "busy" });
          break;
        }
        await new Promise((r) => setTimeout(r, 350 * 2 ** i + Math.random() * 200));
      }
    }
  }

  throw last instanceof Error ? last : new Error("Every model in the chain failed.");
}
