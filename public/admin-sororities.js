// The control room's Sororities page: every Penn State sorority, its passwords, chairs and sisters, and the
// frat invites it has received. Uses the control room's shared helpers (window.PFAdmin). See sororities.js.
(function () {
  const A = window.PFAdmin;
  if (!A) return;
  const $ = (s) => document.querySelector(s);
  const esc = A.esc;
  let list = [];
  let q = '';
  let loaded = 0;

  async function load() {
    try {
      list = (await A.api('/api/admin/sororities')).sororities;
      loaded = Date.now();
      render();
    } catch (err) {
      $('#sororities').innerHTML = '<tr><td colspan="7" class="skeleton">' + esc(err.message) + '</td></tr>';
    }
  }

  function render() {
    const shown = list.filter((s) => !q || (s.name + ' ' + s.gl + ' ' + s.chairs.map((c) => c.name + ' ' + c.email).join(' ')).toLowerCase().includes(q.toLowerCase()));
    const setUp = list.filter((s) => s.chairPw || s.sisterPw).length;
    const sisters = list.reduce((n, s) => n + s.members, 0);
    const upcoming = list.reduce((n, s) => n + s.invites.upcoming, 0);
    $('#sororityTiles').innerHTML = [
      ['Sororities', list.length], ['Set up', setUp], ['Sisters on PhatFrats', sisters], ['Upcoming frat invites', upcoming],
    ].map(([k, v]) => '<div class="card tile"><div class="label">' + k + '</div><div class="value">' + A.int(v) + '</div></div>').join('');
    $('#sororityCount').textContent = shown.length + ' of ' + list.length;
    $('#sororities').innerHTML = shown.length ? shown.map((s) => {
      const status = s.chairPw && s.sisterPw ? '<span class="tag full">Set up</span>'
        : s.chairPw || s.sisterPw ? '<span class="tag">' + (s.chairPw ? 'Chair password only' : 'Sister password only') + '</span>'
        : '<span class="tag unverified">Not set up</span>';
      return '<tr><td><b>' + esc(s.gl) + '</b> ' + esc(s.name) + '</td><td>' + status + '</td>'
        + '<td>' + (s.chairs.length ? s.chairs.map((c) => esc(c.name) + ' <span class="updated">' + esc(c.email) + '</span>').join('<br>') : '<span class="updated">None yet</span>') + '</td>'
        + '<td class="num">' + A.int(s.members) + '</td>'
        + '<td class="num">' + A.int(s.invites.upcoming) + '</td>'
        + '<td>' + (s.invites.total ? A.int(s.invites.total) + ' total' + (s.invites.declined ? ', ' + s.invites.declined + ' turned down' : '') + (s.invites.lastAt ? '<br><span class="updated">Last ' + esc(A.ago(s.invites.lastAt)) + '</span>' : '') : '<span class="updated">None</span>') + '</td>'
        + '<td><div class="actions"><a class="btn small gold" href="/sororities?sorority=' + s.id + '" target="_blank" rel="noopener">Open page</a>'
        + '<button class="btn small" data-sopw="' + s.id + '">Sister password</button><button class="btn small" data-socpw="' + s.id + '">Chair password</button>'
        + '<button class="btn small" data-sochair="' + s.id + '">Add chair</button></div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="skeleton">No sororities match.</td></tr>';
  }

  $('#sororitySearch').addEventListener('input', (e) => { q = e.target.value; render(); });
  $('#sororities').addEventListener('click', async (e) => {
    const pw = e.target.closest('[data-sopw]'), cpw = e.target.closest('[data-socpw]'), ch = e.target.closest('[data-sochair]');
    const btn = pw || cpw || ch;
    if (!btn) return;
    const s = list.find((x) => String(x.id) === (btn.dataset.sopw || btn.dataset.socpw || btn.dataset.sochair));
    try {
      if (pw || cpw) {
        const v = prompt(pw
          ? 'New sister password for ' + s.name + ' (at least 8 characters). Sisters type this to join.'
          : 'New chair password for ' + s.name + ' (at least 8 characters). Whoever signs in with it under Chair sign-in becomes a chair.');
        if (v === null) return;
        await A.api('/api/admin/sororities/' + s.id + '/password', { password: v, kind: cpw ? 'chair' : 'sister' });
        A.toast(cpw ? 'Chair password set for ' + s.name + '.' : 'Sister password set for ' + s.name + '.');
      } else {
        const v = prompt('Email of the PhatFrats account to make a chair of ' + s.name + '. They need an account with a confirmed email. Anyone in another sorority gets moved.');
        if (v === null) return;
        await A.api('/api/admin/sororities/' + s.id + '/chair', { email: v });
        A.toast('Chair added to ' + s.name + '.');
      }
      await load();
    } catch (err) { A.toast(err.message); }
  });

  // Loads when the page opens, and again with the control room's Refresh button.
  window.PFSororityAdmin = { onPage: (page, force) => { if (page === 'sororities' && (force || Date.now() - loaded > 60000)) load(); } };
  if (A.state.page === 'sororities') load();
})();
