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
  // A pass lasts through the end of the current term: Spring through May 15, Summer through Aug 20,
  // Fall through Jan 10. Buying with less than 30 days left covers the next term too.
  PRICING.passEnds = (todayISO) => {
    const y = Number(todayISO.slice(0, 4));
    const ends = [`${y}-01-10`, `${y}-05-15`, `${y}-08-20`, `${y + 1}-01-10`, `${y + 1}-05-15`];
    const day = (iso) => Date.parse(iso + 'T12:00:00Z') / 86400000;
    return ends.find((e) => day(e) - day(todayISO) >= 30);
  };
  // The day the current term started (the end of the one before), as 'YYYY-MM-DD'.
  PRICING.termStart = (todayISO) => {
    const y = Number(todayISO.slice(0, 4));
    return [`${y - 1}-08-20`, `${y}-01-10`, `${y}-05-15`, `${y}-08-20`].filter((d) => d <= todayISO).pop();
  };
  // For example "May 15, 2027".
  PRICING.passEndLabel = (iso) =>
    new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
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
