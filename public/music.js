// The PhatFrats theme song, "On The List", playing on repeat on the Door Rush page.
// Browsers don't allow sound until someone interacts with the page, so it starts on the first tap, click or key.
// A floating button mutes or unmutes it, and the choice is remembered in this browser. The song only
// downloads once it's about to play, so muted visitors never load it.
(function () {
  const SRC = '/audio/on-the-list.mp3';
  const VOLUME = 0.35;
  const store = {
    get() { try { return localStorage.getItem('pf_music'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem('pf_music', v); } catch (e) {} },
  };
  // On by default; off for people who asked their device for less motion and sound, until they turn it on.
  let on = store.get() ? store.get() === 'on' : !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let audio = null, started = false;

  const css = document.createElement('style');
  css.textContent = `
  .pf-music{position:fixed;left:14px;bottom:14px;z-index:40;display:flex;align-items:center;gap:8px;font:700 14px "Bricolage Grotesque",system-ui,sans-serif;
    background:rgba(19,27,64,.92);color:#f5f2ff;border:1.5px solid rgba(190,200,255,.28);border-radius:999px;padding:8px 14px 8px 10px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.4)}
  .pf-music:hover{border-color:#35e0ff}
  .pf-music .eq{display:inline-flex;align-items:flex-end;gap:2px;height:14px}
  .pf-music .eq i{width:3px;background:#ffd23f;border-radius:2px;height:4px}
  .pf-music.playing .eq i{animation:pfEq .9s ease-in-out infinite alternate}
  .pf-music.playing .eq i:nth-child(2){animation-delay:.2s}.pf-music.playing .eq i:nth-child(3){animation-delay:.45s}
  @keyframes pfEq{from{height:3px}to{height:14px}}
  @media (prefers-reduced-motion:reduce){.pf-music.playing .eq i{animation:none;height:10px}}
  @media (max-width:520px){.pf-music .label{display:none}.pf-music{padding:9px}}`;
  document.head.appendChild(css);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pf-music';
  document.body.appendChild(btn);

  function paint() {
    const playing = !!audio && !audio.paused;
    btn.classList.toggle('playing', playing);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Mute the PhatFrats theme song' : 'Play the PhatFrats theme song');
    btn.title = on ? 'Mute music' : 'Play music';
    btn.innerHTML = `<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span aria-hidden="true">${on ? '🔊' : '🔇'}</span><span class="label">${on ? (playing ? 'On The List' : 'Tap anywhere for music') : 'Music off'}</span>`;
  }
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio(SRC);
    audio.loop = true;
    audio.volume = VOLUME;
    audio.preload = 'auto';
    audio.addEventListener('play', paint);
    audio.addEventListener('pause', paint);
    audio.addEventListener('error', () => { btn.hidden = true; });
    return audio;
  }
  function play() {
    if (!on) return;
    ensureAudio().play().then(() => { started = true; paint(); }).catch(() => paint());
  }
  function setOn(value) {
    on = value;
    store.set(on ? 'on' : 'off');
    if (on) play(); else if (audio) audio.pause();
    paint();
    document.dispatchEvent(new CustomEvent('pf-music', { detail: { on } }));
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOn(!on); });

  // The first real interaction anywhere starts the music (if it's on).
  const kick = () => { if (!started) play(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, kick, { passive: true }));
  // Pauses while the tab is in the background, and picks up again when you come back.
  document.addEventListener('visibilitychange', () => {
    if (!audio || !on) return;
    if (document.hidden) audio.pause(); else if (started) audio.play().catch(() => {});
  });

  window.PFMusic = { isOn: () => on, set: setOn };
  paint();
})();
