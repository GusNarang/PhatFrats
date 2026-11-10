// SQL pieces for "does this account have Full Access right now", shared by the server's modules.
// Pass the users table alias with its dot ('u.') or '' for no alias.
// A paid (or given) pass that hasn't ended.
const PAID_SQL = (u = '') => `(${u}plan = 'full' AND (${u}plan_paid_until IS NULL OR ${u}plan_paid_until >= now()))`;
// Full Access from a pass or the first-weekend trial.
const FULL_SQL = (u = '') => `(${PAID_SQL(u)} OR coalesce(${u}trial_until > now(), FALSE))`;
module.exports = { PAID_SQL, FULL_SQL };
