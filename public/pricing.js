// The Full Access price, shared by the page, the server and PhatBot. Change it here and everything follows.
(function () {
  const PRICING = {
    price: 4.99,
    term: 'semester',
    // Launch deal. To switch it on, set `ends` to its last day as 'YYYY-MM-DD' (Eastern time), such as '2027-01-25'.
    // While it runs, the page shows the regular price crossed out next to the deal price. null keeps it off.
    launch: { price: 2.99, ends: null },
  };

  PRICING.money = (n) => '$' + n.toFixed(2);
  PRICING.dealActive = (now = new Date()) =>
    !!PRICING.launch.ends && now <= new Date(PRICING.launch.ends + 'T23:59:59-05:00');
  PRICING.current = (now) => (PRICING.dealActive(now) ? PRICING.launch.price : PRICING.price);
  // For example "Jan 25".
  PRICING.dealEndLabel = () =>
    PRICING.launch.ends
      ? new Date(PRICING.launch.ends + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      : '';
  // One sentence, for messages and PhatBot.
  PRICING.summary = (now) => {
    const base = `${PRICING.money(PRICING.price)} per ${PRICING.term}, paid once with no auto-renew`;
    return PRICING.dealActive(now)
      ? `${PRICING.money(PRICING.launch.price)} per ${PRICING.term} as a launch deal through ${PRICING.dealEndLabel()} (normally ${base})`
      : base;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PRICING;
  else globalThis.PF_PRICING = PRICING;
})();
