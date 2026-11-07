// Outside guests: people who aren't Penn State students, brought by a student or a brother who vouches for them.
// Shared by the student routes (server.js) and the chapter routes (chapters.js).
const partyList = require('./party-list.js');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SITE_URL = process.env.SITE_URL || 'https://phat-frats.vercel.app';

// Checks a guest form. Returns { name, email, phone }, or a message saying what to fix.
function readGuest(body) {
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  if (name.length < 2 || !name.includes(' ')) return "Add your guest's first and last name.";
  const contact = typeof body?.contact === 'string' ? body.contact.trim().slice(0, 120) : '';
  if (!contact) return "Add your guest's email or phone number.";
  if (contact.includes('@')) {
    const email = contact.toLowerCase();
    if (!EMAIL.test(email)) return "That email doesn't look right.";
    if (/@psu\.edu$/.test(email)) return 'Penn State students need their own invite. Ask them to sign up on PhatFrats.';
    return { name, email, phone: null };
  }
  const digits = contact.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 10 || digits.replace(/\D/g, '').length > 15) return "That phone number doesn't look right.";
  return { name, email: null, phone: digits };
}

// Tells an approved guest they're on the list. Only possible when they gave an email.
async function sendGuestEmail(mailer, { to, guest, sponsor, chapter, party, IS_PROD }) {
  const when = `${partyList.dayLabel(party.day).long} at ${party.time}`;
  const where = chapter.addr ? ` at ${chapter.addr}, State College` : '';
  const text = `Hi ${guest.split(' ')[0]},\n\n${sponsor} added you as their guest at "${party.title}", hosted by ${chapter.name}${where}, on ${when}.\n\n` +
    `You're on the list under the name ${guest}. Bring a photo ID that matches it.\n\n` +
    `This invite is just for you and can't be passed on. If you weren't expecting it, you can ignore this email.\n\nPhatFrats\n${SITE_URL}`;
  if (!mailer) {
    if (!IS_PROD) console.log(`[dev only] Outside guest email to ${to}:\n${text}`);
    return;
  }
  await mailer.sendMail({
    from: `"PhatFrats" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to,
    subject: `You're on the list for ${party.title}`,
    text,
  });
}

// Shows a phone number as (814) 555-1234 when it's a US number.
function prettyPhone(p) {
  const d = (p || '').replace(/\D/g, '');
  const us = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return us.length === 10 ? `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}` : p;
}

module.exports = { readGuest, sendGuestEmail, prettyPhone };
