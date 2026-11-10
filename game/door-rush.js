// Door Rush. Sort the line of guests into the right party before they reach the doors.
// Served only to Full Access accounts by game-routes.js.
(function () {
  const W = 480, H = 640, DOOR_Y = 118, LINE_Y = 214, SPAWN_Y = H + 34;
  const HOUSES = [
    { label: 'NEON', c: '#ff3fa4', shape: 'star' },
    { label: 'CHILL', c: '#35e0ff', shape: 'circle' },
    { label: 'COSTUME', c: '#ffd23f', shape: 'diamond' },
  ];
  const SLOTS = [88, 240, 392];
  const SKINS = ['#f4cda8', '#d9a06f', '#a96f43', '#6d4428', '#f0bd96'];
  const HAIR = ['#20130d', '#5d3518', '#d7a83c', '#a43f2f', '#111827', '#8b5cf6'];
  const HYPE_FULL = 12, HYPE_SECONDS = 6, GUESTS_PER_LEVEL = 12;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Door Rush skins, a Full Access perk. Looks only: the doors, guests and scoring are the same for everyone.
  const THEMES = {
    classic: { sky: ['#111a48', '#0b1026'], hype: '#32105c', street: '#1b2556', door: '#20295f', stars: '#ffffff' },
    gold: { sky: ['#3d2c06', '#120c02'], hype: '#5c3d05', street: '#2f2410', door: '#3b2c0a', stars: '#ffd23f' },
    neon: { sky: ['#2c0b4d', '#0a0420'], hype: '#5a0f6e', street: '#1e0f40', door: '#2b1250', stars: '#35e0ff' },
    midnight: { sky: ['#060a16', '#000000'], hype: '#131b3d', street: '#0c1224', door: '#121a33', stars: '#9fb3ff' },
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const num = (n) => Number(n).toLocaleString('en-US');

  function mount(root, api) {
    const theme = () => THEMES[(api.theme && api.theme()) || 'classic'] || THEMES.classic;
    root.innerHTML = `
      <div class="dr-stage">
        <canvas width="${W}" height="${H}" aria-label="Door Rush game" role="img"></canvas>
        <button class="dr-mute" type="button" aria-pressed="false" aria-label="Sound effects">Effects on</button>
        <div class="dr-overlay"></div>
      </div>
      <div class="dr-controls" role="group" aria-label="Game controls">
        <button type="button" data-slot="0"></button><button type="button" data-slot="1"></button><button type="button" data-slot="2"></button>
        <button type="button" class="dr-bounce" data-bounce>Bounce <kbd>↓</kbd></button>
      </div>`;
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const overlay = root.querySelector('.dr-overlay');
    const slotButtons = [...root.querySelectorAll('[data-slot]')];
    const muteButton = root.querySelector('.dr-mute');

    let g = null, phase = 'menu', last = 0, ticket = null, audio = null, starting = false;
    let muted = false;
    try { muted = localStorage.getItem('pf_dr_muted') === '1'; } catch (e) {}
    const stars = Array.from({ length: 46 }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(.5, 1.7), p: rand(0, 6.28) }));

    function setupCanvas() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * ratio; canvas.height = H * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    setupCanvas();

    function tone(freq, length = .08, type = 'square', volume = .035, slide = 0) {
      if (muted) return;
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
        const o = audio.createOscillator(), v = audio.createGain(), t = audio.currentTime;
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + length);
        v.gain.setValueAtTime(volume, t); v.gain.exponentialRampToValueAtTime(.0001, t + length);
        o.connect(v).connect(audio.destination); o.start(t); o.stop(t + length);
      } catch (e) {}
    }
    function setMute(value) {
      muted = value;
      muteButton.textContent = muted ? 'Effects off' : 'Effects on';
      muteButton.setAttribute('aria-pressed', String(muted));
      try { localStorage.setItem('pf_dr_muted', muted ? '1' : '0'); } catch (e) {}
    }
    setMute(muted);
    muteButton.addEventListener('click', () => setMute(!muted));

    function newGame() {
      return {
        guests: [], bits: [], words: [], order: [0, 1, 2], doorX: HOUSES.map((_, i) => SLOTS[i]),
        score: 0, handled: 0, right: 0, streak: 0, lives: 3, level: 1, spawn: .4, hype: 0, hypeLeft: 0,
        shake: 0, hold: 0, banner: '', bannerLeft: 0, time: 0, pulse: 0,
      };
    }
    const mult = () => Math.min(5, 1 + Math.floor(g.streak / 5));
    const speed = () => (108 + g.level * 18) * (g.hypeLeft > 0 ? .72 : 1);
    const spawnGap = () => Math.max(.44, 1.28 - g.level * .085);
    const front = () => g.guests.filter((x) => !x.leaving).sort((a, b) => a.y - b.y)[0];

    function say(text, x, y, c) { g.words.push({ text, x, y, c, life: .85 }); }
    function burst(x, y, c, n = 16) {
      if (calm) n = Math.min(n, 5);
      for (let i = 0; i < n; i++) g.bits.push({ x, y, vx: rand(-190, 190), vy: rand(-250, 80), c, life: rand(.35, .8), s: rand(2, 5) });
    }
    function showBanner(text, time = 1.05) { g.banner = text; g.bannerLeft = time; }
    function labelButtons() {
      slotButtons.forEach((b, slot) => {
        const house = HOUSES[g ? g.order[slot] : slot];
        b.style.setProperty('--c', house.c);
        b.innerHTML = `${house.label} <kbd>${['←', '↑', '→'][slot]}</kbd>`;
      });
    }

    function addGuest() {
      const canCrash = g.level >= 2 && Math.random() < Math.min(.3, .1 + g.level * .022);
      g.guests.push({
        type: canCrash ? -1 : Math.floor(Math.random() * 3),
        vip: !canCrash && Math.random() < .08,
        y: SPAWN_Y, x: 240 + rand(-8, 8), step: rand(0, 6.28),
        skin: pick(SKINS), hair: pick(HAIR), leaving: null,
      });
    }
    function strike(text, x, y) {
      g.lives--; g.streak = 0; g.hype = 0;
      g.shake = calm ? 0 : .28;
      say(text, x, y, '#ff7482');
      tone(120, .22, 'sawtooth', .05, -60);
      if (g.lives <= 0) endGame();
    }
    function award(guest, base, text, slotX) {
      const hypeBonus = g.hypeLeft > 0 ? 2 : 1;
      const points = base * (guest.vip ? 3 : 1) * mult() * hypeBonus * (api.event ? 2 : 1);
      g.score += points; g.right++; g.streak++;
      say(`${text} +${num(points)}`, slotX, guest.y - 34, guest.vip ? '#ffd23f' : '#ffffff');
      tone(guest.vip ? 880 : 420 + Math.min(g.streak, 30) * 18, .07);
      if (g.right % 40 === 0 && g.lives < 3) { g.lives++; showBanner('EXTRA WRISTBAND!'); tone(1040, .18, 'triangle', .05); }
      if (g.hypeLeft <= 0 && ++g.hype >= HYPE_FULL) {
        g.hype = 0; g.hypeLeft = HYPE_SECONDS; showBanner('HYPE MODE · DOUBLE POINTS');
        burst(240, 280, '#ff3fa4', 45); burst(240, 280, '#35e0ff', 45);
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .12, 'triangle', .045), i * 70));
      }
    }
    function handled() {
      g.handled++;
      const next = 1 + Math.floor(g.handled / GUESTS_PER_LEVEL);
      if (next === g.level) return;
      g.level = next; g.hold = .75;
      if (g.level >= 3) {
        const old = g.order.join();
        do { g.order.sort(() => Math.random() - .5); } while (g.order.join() === old);
        labelButtons();
        showBanner(`LEVEL ${g.level} · DOORS SWITCHED!`, 1.2);
        tone(220, .25, 'triangle', .05, 500);
      } else showBanner(`LEVEL ${g.level} · WATCH FOR CRASHERS`, 1.2);
    }
    function sendToSlot(slot) {
      if (phase !== 'play') return;
      const guest = front();
      if (!guest) return;
      const house = g.order[slot], x = SLOTS[slot];
      guest.leaving = { x, y: DOOR_Y + 12, t: 0, sx: guest.x, sy: guest.y, ok: guest.type === house };
      if (guest.type === -1) strike('CRASHER GOT IN!', x, 190);
      else if (guest.type === house) { award(guest, 100, guest.vip ? 'VIP' : 'NICE', x); burst(x, DOOR_Y + 40, HOUSES[house].c); }
      else strike('WRONG PARTY!', x, 190);
      if (phase === 'play') handled();
    }
    function bounce() {
      if (phase !== 'play') return;
      const guest = front();
      if (!guest) return;
      guest.leaving = { x: guest.x + (Math.random() < .5 ? -340 : 340), y: guest.y + 60, t: 0, sx: guest.x, sy: guest.y, ok: guest.type === -1 };
      if (guest.type === -1) { award(guest, 50, 'BOUNCED', 240); burst(guest.x, guest.y, '#ff5d6c', 12); }
      else strike('THEY WERE INVITED!', 240, guest.y - 40);
      if (phase === 'play') handled();
    }

    function update(dt) {
      g.time += dt; g.pulse += dt;
      g.shake = Math.max(0, g.shake - dt);
      g.bannerLeft = Math.max(0, g.bannerLeft - dt);
      g.hypeLeft = Math.max(0, g.hypeLeft - dt);
      g.order.forEach((house, slot) => { g.doorX[house] += (SLOTS[slot] - g.doorX[house]) * Math.min(1, dt * 11); });
      if (g.hold > 0) g.hold -= dt;
      else {
        g.spawn -= dt;
        if (g.spawn <= 0) { addGuest(); g.spawn = spawnGap() * rand(.82, 1.18); }
      }
      const pace = speed();
      for (const guest of g.guests) {
        guest.step += dt * 10;
        if (guest.leaving) {
          guest.leaving.t += dt / .22;
          const t = Math.min(1, guest.leaving.t);
          guest.x = guest.leaving.sx + (guest.leaving.x - guest.leaving.sx) * t;
          guest.y = guest.leaving.sy + (guest.leaving.y - guest.leaving.sy) * t;
        } else if (g.hold <= 0) guest.y -= pace * dt;
      }
      const missed = g.guests.find((x) => !x.leaving && x.y <= LINE_Y);
      if (missed) {
        g.guests.splice(g.guests.indexOf(missed), 1);
        if (missed.type === -1) { g.right++; say('CRASHER LEFT', 240, 250, '#a7add8'); g.handled++; }
        else strike('TOO SLOW!', 240, 250);
      }
      g.guests = g.guests.filter((x) => !x.leaving || x.leaving.t < 1);
      g.bits = g.bits.filter((b) => (b.life -= dt) > 0);
      g.bits.forEach((b) => { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 620 * dt; });
      g.words = g.words.filter((w) => (w.life -= dt) > 0);
      g.words.forEach((w) => { w.y -= 44 * dt; });
    }

    function shape(kind, x, y, size, c) {
      ctx.fillStyle = c; ctx.beginPath();
      if (kind === 'circle') ctx.arc(x, y, size, 0, 7);
      else if (kind === 'diamond') { ctx.moveTo(x, y - size * 1.2); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size * 1.2); ctx.lineTo(x - size, y); }
      else for (let i = 0; i < 10; i++) {
        const r = i % 2 ? size * .46 : size * 1.15, a = -Math.PI / 2 + i * Math.PI / 5;
        ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
    function text(value, x, y, size, c, align = 'center', font = 'Bungee, Impact, sans-serif') {
      ctx.font = `${size}px ${font}`; ctx.fillStyle = c; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(value, x, y);
    }
    function drawBackground(t) {
      const hype = g && g.hypeLeft > 0;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      const th = theme();
      sky.addColorStop(0, hype ? th.hype : th.sky[0]); sky.addColorStop(1, th.sky[1]);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      for (const s of stars) { ctx.globalAlpha = .28 + Math.abs(Math.sin(t + s.p)) * .55; ctx.fillStyle = th.stars; ctx.fillRect(s.x, s.y, s.r, s.r); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = th.street; ctx.beginPath(); ctx.moveTo(196, 196); ctx.lineTo(284, 196); ctx.lineTo(362, H); ctx.lineTo(118, H); ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,63,.42)'; ctx.setLineDash([18, 16]); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(240, 214); ctx.lineTo(240, H); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,93,108,.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(150, LINE_Y); ctx.lineTo(330, LINE_Y); ctx.stroke();
    }
    function drawDoors(t) {
      HOUSES.forEach((house, i) => {
        const x = g ? g.doorX[i] : SLOTS[i], y = DOOR_Y;
        ctx.save();
        ctx.shadowColor = house.c; ctx.shadowBlur = g && g.hypeLeft > 0 ? 24 + Math.sin(t * 9) * 10 : 12;
        ctx.fillStyle = theme().door; ctx.strokeStyle = house.c; ctx.lineWidth = 3;
        roundRect(x - 58, y - 56, 116, 104, 10); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = house.c; ctx.beginPath(); ctx.moveTo(x - 68, y - 52); ctx.lineTo(x, y - 94); ctx.lineTo(x + 68, y - 52); ctx.fill();
        shape(house.shape, x, y - 66, 10, '#0b1026');
        ctx.fillStyle = '#0b1026'; roundRect(x - 23, y - 8, 46, 56, 5); ctx.fill();
        text(house.label, x, y - 33, house.label.length > 5 ? 14 : 17, '#fff');
      });
    }
    function drawGuest(guest, isFront, t) {
      const bob = calm ? 0 : Math.sin(guest.step) * 3, x = guest.x, y = guest.y + bob;
      const crash = guest.type === -1, house = HOUSES[guest.type];
      ctx.fillStyle = 'rgba(0,0,0,.34)'; ctx.beginPath(); ctx.ellipse(x, guest.y + 34, 25, 8, 0, 0, 7); ctx.fill();
      if (isFront) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, guest.y + 34, 35 + Math.sin(t * 8) * 3, 12, 0, 0, 7); ctx.stroke(); }
      ctx.fillStyle = crash ? '#59607f' : house.c; roundRect(x - 21, y - 6, 42, 42, 14); ctx.fill();
      if (crash) { ctx.fillStyle = '#343a58'; ctx.beginPath(); ctx.arc(x, y - 21, 25, Math.PI, 0); ctx.fill(); }
      ctx.fillStyle = guest.skin; ctx.beginPath(); ctx.arc(x, y - 20, 18, 0, 7); ctx.fill();
      if (crash) { ctx.fillStyle = '#343a58'; ctx.fillRect(x - 21, y - 31, 42, 9); }
      else { ctx.fillStyle = guest.hair; ctx.beginPath(); ctx.arc(x, y - 25, 18, Math.PI, 0); ctx.fill(); }
      ctx.fillStyle = '#10152e'; ctx.beginPath(); ctx.arc(x - 6, y - 19, 2.5, 0, 7); ctx.arc(x + 6, y - 19, 2.5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#10152e'; ctx.lineWidth = 2; ctx.beginPath();
      if (crash) { ctx.moveTo(x - 6, y - 9); ctx.lineTo(x + 6, y - 11); } else ctx.arc(x, y - 14, 7, .25, 2.9);
      ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + 33, y - 42, 19, 0, 7); ctx.fill();
      if (crash) text('✕', x + 33, y - 41, 25, '#e11d48', 'center', 'Arial, sans-serif');
      else shape(house.shape, x + 33, y - 42, 11, house.c);
      if (guest.vip) {
        ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(x - 17, y - 39); ctx.lineTo(x - 19, y - 60); ctx.lineTo(x - 8, y - 49); ctx.lineTo(x, y - 64); ctx.lineTo(x + 8, y - 49); ctx.lineTo(x + 19, y - 60); ctx.lineTo(x + 17, y - 39); ctx.fill();
        text('VIP', x, y + 16, 11, '#0b1026');
      }
    }
    function drawHud() {
      text(num(g.score), 16, 184, 25, '#fff', 'left');
      text(`x${mult()}`, 16, 214, 20, g.streak >= 5 ? '#ffd23f' : '#a7add8', 'left');
      text(`LEVEL ${g.level}`, W - 16, 184, 14, '#a7add8', 'right');
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < g.lives ? '#9dff4a' : 'rgba(255,255,255,.17)';
        roundRect(W - 88 + i * 25, 204, 20, 10, 5); ctx.fill();
      }
      const fill = g.hypeLeft > 0 ? g.hypeLeft / HYPE_SECONDS : g.hype / HYPE_FULL;
      ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(16, H - 22, W - 32, 10, 5); ctx.fill();
      ctx.fillStyle = g.hypeLeft > 0 ? '#ffd23f' : '#ff3fa4'; roundRect(16, H - 22, Math.max(5, (W - 32) * fill), 10, 5); ctx.fill();
      text('HYPE', 18, H - 37, 11, '#fff', 'left');
    }
    function draw(t) {
      ctx.save();
      if (g && g.shake > 0) ctx.translate(rand(-7, 7), rand(-7, 7));
      drawBackground(t); drawDoors(t);
      if (g) {
        const lead = front();
        [...g.guests].sort((a, b) => b.y - a.y).forEach((x) => drawGuest(x, x === lead, t));
        g.bits.forEach((b) => { ctx.globalAlpha = Math.min(1, b.life * 2); ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, b.s, b.s); });
        ctx.globalAlpha = 1;
        g.words.forEach((w) => { ctx.globalAlpha = Math.min(1, w.life * 2); text(w.text, w.x, w.y, 18, w.c); });
        ctx.globalAlpha = 1;
        drawHud();
        if (g.bannerLeft > 0) {
          ctx.fillStyle = 'rgba(11,16,38,.86)'; ctx.fillRect(0, H / 2 - 37, W, 74);
          text(g.banner, W / 2, H / 2, g.banner.length > 25 ? 19 : 24, '#ffd23f');
        }
      }
      ctx.restore();
    }
    function frame(now) {
      const dt = Math.min(.05, (now - last) / 1000 || 0);
      last = now;
      if (phase === 'play') update(dt);
      draw(now / 1000);
      requestAnimationFrame(frame);
    }

    function menu() {
      phase = 'menu';
      overlay.hidden = false;
      overlay.innerHTML = `<h2>Door Rush</h2>
        <p>Match each guest to their party before they reach the red line.</p>
        <ul><li><b>Star</b> goes to Neon, <b>circle</b> to Chill, <b>diamond</b> to Costume.</li><li>Press <b>Bounce</b> for hooded crashers with a red ✕.</li><li>Doors switch places from level 3. Three mistakes ends the game.</li></ul>
        <button type="button" class="dr-play">Open the doors</button><p class="dr-small">Keyboard: ← ↑ → to send, ↓ or Space to bounce.</p>`;
      labelButtons();
    }
    async function begin() {
      if (starting) return;
      starting = true;
      try {
        ticket = await api.start();
        tone(523, .1, 'triangle', .04);
        g = newGame(); labelButtons();
        overlay.hidden = true; overlay.innerHTML = ''; phase = 'play';
        root.scrollIntoView({ block: 'start', behavior: 'instant' });
        showBanner(api.event ? 'EVENT WEEK · DOUBLE POINTS!' : 'DOORS OPEN!', api.event ? 1.4 : .8);
      } catch (err) {
        overlay.hidden = false;
        overlay.innerHTML = `<h2>Couldn't start</h2><p>${String(err.message).replace(/[<>&]/g, '')}</p><button type="button" class="dr-play">Try again</button>`;
      } finally { starting = false; }
    }
    function pause() {
      if (phase !== 'play') return;
      phase = 'paused'; overlay.hidden = false;
      overlay.innerHTML = '<h2>Paused</h2><button type="button" class="dr-resume">Keep going</button>';
    }
    function endGame() {
      phase = 'over';
      const final = { score: g.score, guests: g.right, level: g.level };
      overlay.hidden = false;
      overlay.innerHTML = `<h2>Doors closed</h2><div class="dr-score">${num(final.score)}</div><p>${num(final.guests)} guests handled · level ${final.level}</p><p class="dr-result">Saving your score…</p><button type="button" class="dr-play">Run it back</button>`;
      [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, .18, 'triangle', .05), i * 120));
      api.finish(ticket, final).then((r) => {
        const el = overlay.querySelector('.dr-result');
        if (!el) return;
        el.textContent = r.newBest ? 'New personal best!' : `Your best: ${num(r.best)}`;
        if (r.rank) el.textContent += ` · #${r.rank} this week`;
      }).catch((err) => {
        const el = overlay.querySelector('.dr-result');
        if (el) el.textContent = err.message;
      });
    }

    overlay.addEventListener('click', (e) => {
      if (e.target.closest('.dr-play')) begin();
      if (e.target.closest('.dr-resume')) { overlay.hidden = true; overlay.innerHTML = ''; phase = 'play'; }
    });
    root.querySelector('.dr-controls').addEventListener('pointerdown', (e) => {
      const slot = e.target.closest('[data-slot]');
      if (slot) { e.preventDefault(); sendToSlot(Number(slot.dataset.slot)); }
      if (e.target.closest('[data-bounce]')) { e.preventDefault(); bounce(); }
    });
    // Keyboard users pressing Enter on a focused button.
    root.querySelector('.dr-controls').addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      const slot = e.target.closest('[data-slot]');
      if (slot) sendToSlot(Number(slot.dataset.slot));
      if (e.target.closest('[data-bounce]')) bounce();
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (phase !== 'play') return;
      const box = canvas.getBoundingClientRect();
      const x = (e.clientX - box.left) * W / box.width, y = (e.clientY - box.top) * H / box.height;
      if (y < LINE_Y) { e.preventDefault(); sendToSlot(x < 164 ? 0 : x < 316 ? 1 : 2); }
    });
    window.addEventListener('keydown', (e) => {
      if (phase !== 'play') return;
      const key = e.key.toLowerCase();
      const slot = { arrowleft: 0, a: 0, arrowup: 1, w: 1, arrowright: 2, d: 2 }[key];
      if (slot !== undefined) { e.preventDefault(); if (!e.repeat) sendToSlot(slot); }
      else if (key === 'arrowdown' || key === 's' || key === ' ') { e.preventDefault(); if (!e.repeat) bounce(); }
      else if (key === 'p' || key === 'escape') pause();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

    menu();
    requestAnimationFrame(frame);
  }

  window.PFDoorRush = { mount, THEMES: Object.keys(THEMES) };
})();
