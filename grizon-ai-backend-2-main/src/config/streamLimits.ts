/**
 * Universal stream timeout constants.
 *
 * These apply identically to every plan — timeout behaviour is not a plan
 * differentiator.  Two timers are active per streaming job:
 *
 *  1. INACTIVITY  — reset on every chunk, tool_call, and tool_result.
 *                   Fires only when the stream has been genuinely silent.
 *  2. ABSOLUTE    — never reset.  A hard safety cap that kills truly runaway
 *                   jobs regardless of activity.
 */

/** Kill the stream if no activity for this long (ms). */
export const STREAM_INACTIVITY_TIMEOUT_MS = 60_000;   // 60 s

/** Hard upper bound for any single stream, no matter how active (ms). */
export const STREAM_ABSOLUTE_TIMEOUT_MS = 600_000;    // 10 min
