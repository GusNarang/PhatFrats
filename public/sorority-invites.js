// Sorority group invites on the chapter page (/frats), in the Invite people tab. Chapter leaders invite one
// or more whole sororities (or all of them) to a party, and every sister goes on the list. Brothers see what
// was sent. The page shares its state and helpers as window.PFChapter. See sororities.js on the server.
(function () {
  const C = () => window.PFChapter;
  const esc = (s) => C().esc(s);
  const $ = (s) => document.querySelector(s);
  const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  let info = null;

  const css = document.createElement('style');
  css.textContent = `
  .so-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;max-height:340px;overflow:auto;padding:2px}
  .so-pick{display:flex;gap:10px;align-items:center;background:var(--night);border:2px solid var(--line);border-radius:12px;padding:9px 12px;font-weight:600;cursor:pointer;margin:0}
  .so-pick input{width:20px;height:20px;min-height:0;margin:0;flex:none;accent-color:var(--pink)}
  .so-pick small{display:block;font-weight:400;color:var(--muted);font-size:13px}
  .so-pick.all{border-color:rgba(255,63,164,.55);margin-bottom:10px}
  .badge.declined{background:rgba(255,93,108,.15);color:#ffc0c6;border-color:rgba(255,93,108,.4)}`;
  document.head.appendChild(css);

  function card() {
    let el = $('#sororityCard');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'card';
    el.id = 'sororityCard';
    // Right after the "Invite someone" card.
    const first = $('#panel-invite .card');
    first.parentNode.insertBefore(el, first.nextSibling);
    el.addEventListener('submit', send);
    el.addEventListener('change', (e) => {
      if (e.target.id === 'soAll') el.querySelectorAll('[data-so]').forEach((b) => { b.checked = e.target.checked; });
      else if (e.target.matches('[data-so]')) $('#soAll').checked = [...el.querySelectorAll('[data-so]')].every((b) => b.checked);
    });
    el.addEventListener('click', cancel);
    return el;
  }

  async function render() {
    const s = C().state.data;
    if (!s || !s.membership) return;
    try { info = await C().api('/api/chapter/sorority-invites'); } catch { return; }
    const el = card();
    const leader = C().leader();
    const open = s.parties.filter((p) => p.status === 'live' && !p.past).sort((a, b) => a.day.localeCompare(b.day));
    const form = !leader ? '<p class="muted" style="margin-top:0">Your chapter leaders can invite a whole sorority to a party. Every sister goes straight on the list. Here\'s what your chapter has sent.</p>'
      : '<p class="muted" style="margin-top:0">Invite a whole sorority to a party. Every sister on PhatFrats goes straight on the list, sees the party on her map, and gets a note. Sisters who join later are added too. Their chairs can turn an invite down for the house.</p>' +
        '<form id="soForm" novalidate><div id="soMsg" role="alert"></div>' +
        '<div class="field"><label for="soParty">Party</label><select id="soParty" required>' +
        (open.length ? open.map((p) => '<option value="' + p.id + '">' + esc(p.title + ' · ' + p.dayText) + '</option>').join('') : '<option value="">No upcoming parties yet</option>') +
        '</select></div>' +
        '<div class="field"><span style="display:block;font-weight:700;margin-bottom:6px">Sororities</span>' +
        '<label class="so-pick all"><input type="checkbox" id="soAll"> <span>All sororities<small>All ' + info.sororities.length + ' Penn State sororities</small></span></label>' +
        '<div class="so-grid">' + info.sororities.map((o) => '<label class="so-pick"><input type="checkbox" data-so="' + o.id + '"> <span>' + esc(o.gl + ' ' + o.name) +
          '<small>' + (o.sisters ? o.sisters + ' sister' + (o.sisters === 1 ? '' : 's') + ' on PhatFrats' : 'No sisters on PhatFrats yet') + '</small></span></label>').join('') + '</div></div>' +
        '<div class="field"><label for="soNote">Note to the sisters <span class="hint">Optional. Up to 300 characters.</span></label><input id="soNote" maxlength="300" placeholder="For example: Mixer with the sisters of ΑΧΩ, dress code all white"></div>' +
        '<button class="btn primary" type="submit" id="soSend"' + (open.length ? '' : ' disabled') + '>Send sorority invite</button></form>';
    const sent = info.sent.length ? info.sent.map((i) => {
      const p = C().partyById(i.partyId);
      return '<div class="row"><div class="who"><b>' + esc(i.gl + ' ' + i.sorority) + ' ' + (i.status === 'declined' ? '<span class="badge declined">Turned down</span>' : '<span class="badge live">On the list</span>') + '</b>' +
        '<span>' + esc(p ? p.title + ' · ' + p.dayText : 'Party') + ' · sent by ' + esc(i.by) + ' on ' + shortDate(i.sent) + ' · ' +
        (i.status === 'declined' ? 'their chair turned it down' : i.onList + ' sister' + (i.onList === 1 ? '' : 's') + ' on the list so far') + '</span></div>' +
        (leader ? '<button class="btn slim danger" type="button" data-so-cancel="' + i.id + '">Take back</button>' : '') + '</div>';
    }).join('') : '<p class="empty">No sorority invites yet.</p>';
    el.innerHTML = '<h2>Invite a sorority</h2>' + form + '<h3 style="margin-top:18px">Sorority invites sent</h3>' + sent;
  }

  async function send(e) {
    if (e.target.id !== 'soForm') return;
    e.preventDefault();
    const btn = $('#soSend'); btn.disabled = true;
    const msg = $('#soMsg'); msg.innerHTML = '';
    const ids = [...document.querySelectorAll('[data-so]:checked')].map((b) => Number(b.dataset.so));
    const all = $('#soAll').checked;
    try {
      if (!$('#soParty').value) throw new Error('Pick a party.');
      if (!all && !ids.length) throw new Error('Pick at least one sorority.');
      const p = C().partyById($('#soParty').value);
      const n = all ? info.sororities.length : ids.length;
      if (!confirm('Invite ' + (all ? 'all ' + n + ' sororities' : n === 1 ? 'this sorority' : 'these ' + n + ' sororities') + ' to ' + p.title + '? Every sister goes on the list.')) return;
      const r = await C().api('/api/chapter/sorority-invites', { partyId: $('#soParty').value, sororityIds: ids, all, note: $('#soNote').value });
      if (r.invited && C().burst) C().burst(70);
      C().toast(r.invited ? 'Invited ' + r.invited + ' sororit' + (r.invited === 1 ? 'y' : 'ies') + '.' + (r.already ? ' ' + r.already + ' already had an invite.' : '') : 'Those sororities already have an invite to this party.');
      await C().load();
    } catch (err) {
      msg.innerHTML = '<div class="notice err">' + esc(err.message) + '</div>';
    } finally {
      if ($('#soSend')) $('#soSend').disabled = false;
    }
  }

  async function cancel(e) {
    const b = e.target.closest('[data-so-cancel]');
    if (!b) return;
    if (!confirm('Take back this sorority invite? Every sister it put on the list comes off it.')) return;
    b.disabled = true;
    try { await C().api('/api/chapter/sorority-invites/' + b.dataset.soCancel + '/delete', {}); C().toast('Sorority invite taken back.'); await C().load(); }
    catch (err) { C().toast(err.message); b.disabled = false; }
  }

  window.PFSororityInvites = { render };
})();
