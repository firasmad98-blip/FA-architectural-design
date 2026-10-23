'use strict';
// Sends emails through an email service's web API (Railway blocks normal SMTP mail on the Hobby plan).
// Works with Brevo (BREVO_API_KEY) or Resend (RESEND_API_KEY). With neither set, email is simply off
// and the portal falls back to notifying the studio.
const BRAND = 'FA Architectural Design';

function config() {
  const from = String(process.env.EMAIL_FROM || process.env.ADMIN_EMAIL || '').trim();
  const fromName = String(process.env.EMAIL_FROM_NAME || BRAND).trim();
  if (process.env.BREVO_API_KEY && from) return { provider: 'brevo', key: process.env.BREVO_API_KEY.trim(), from, fromName };
  if (process.env.RESEND_API_KEY && from) return { provider: 'resend', key: process.env.RESEND_API_KEY.trim(), from, fromName };
  return null;
}
const enabled = () => !!config();

async function send({ to, toName, subject, html, text, replyTo }) {
  const c = config();
  if (!c) return { sent: false, reason: 'not_configured' };
  if (process.env.EMAIL_DRY_RUN === '1') { // used by the automatic tests
    console.log(`[email] (dry run) to ${to}: ${subject}\n${text}\n[/email]`);
    return { sent: true };
  }
  let url, headers, body;
  if (c.provider === 'brevo') {
    url = 'https://api.brevo.com/v3/smtp/email';
    headers = { 'api-key': c.key, 'content-type': 'application/json', accept: 'application/json' };
    body = { sender: { name: c.fromName, email: c.from }, to: [{ email: to, name: toName || undefined }], subject, htmlContent: html, textContent: text };
    if (replyTo) body.replyTo = { email: replyTo };
  } else {
    url = 'https://api.resend.com/emails';
    headers = { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' };
    body = { from: `${c.fromName} <${c.from}>`, to: [to], subject, html, text };
    if (replyTo) body.reply_to = replyTo;
  }
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      console.error(`[email] ${c.provider} refused the email (${r.status}): ${(await r.text()).slice(0, 300)}`);
      return { sent: false, reason: 'provider_error' };
    }
    return { sent: true };
  } catch (e) {
    console.error(`[email] could not reach ${c.provider}: ${e.message}`);
    return { sent: false, reason: 'network' };
  }
}

// ---------- Messages, in the client's language ----------
const SIGN = 'Firas Moufid Abou Dargham';
const T = {
  en: {
    invite: {
      subject: 'Your FA client portal is ready',
      hello: (n) => `Hello ${n},`,
      body: 'Your private client portal is ready. There you can follow your project, see photos and documents, approve decisions and message the studio.',
      button: 'Open my portal',
      note: 'Tap the button to choose your password. The link works once and expires in 7 days.',
    },
    reset: {
      subject: 'Your new FA portal link',
      hello: (n) => `Hello ${n},`,
      body: 'You asked for a new link to sign in to your client portal. Tap the button and choose a new password.',
      button: 'Choose a new password',
      note: 'The link works once and expires in 48 hours. If you didn’t ask for it, you can ignore this email — your password stays the same.',
    },
    fallback: 'If the button doesn’t work, copy this address into your browser:',
    thanks: 'Best regards,',
  },
  fr: {
    invite: {
      subject: 'Votre espace client FA est prêt',
      hello: (n) => `Bonjour ${n},`,
      body: 'Votre espace client privé est prêt. Vous pourrez y suivre votre projet, voir les photos et documents, valider les décisions et écrire au bureau.',
      button: 'Ouvrir mon espace',
      note: 'Appuyez sur le bouton pour choisir votre mot de passe. Le lien ne fonctionne qu’une fois et expire dans 7 jours.',
    },
    reset: {
      subject: 'Votre nouveau lien vers l’espace FA',
      hello: (n) => `Bonjour ${n},`,
      body: 'Vous avez demandé un nouveau lien pour vous connecter à votre espace client. Appuyez sur le bouton et choisissez un nouveau mot de passe.',
      button: 'Choisir un nouveau mot de passe',
      note: 'Le lien ne fonctionne qu’une fois et expire dans 48 heures. Si vous n’avez rien demandé, ignorez cet e-mail : votre mot de passe ne change pas.',
    },
    fallback: 'Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    thanks: 'Bien cordialement,',
  },
  ar: {
    invite: {
      subject: 'بوابة العملاء الخاصة بك في FA جاهزة',
      hello: (n) => `مرحباً ${n}،`,
      body: 'بوابتك الخاصة جاهزة. يمكنك من خلالها متابعة مشروعك، ومشاهدة الصور والمستندات، والموافقة على القرارات، ومراسلة المكتب.',
      button: 'افتح بوابتي',
      note: 'اضغط على الزر لاختيار كلمة المرور. الرابط يعمل مرة واحدة وتنتهي صلاحيته خلال 7 أيام.',
    },
    reset: {
      subject: 'رابطك الجديد لبوابة FA',
      hello: (n) => `مرحباً ${n}،`,
      body: 'طلبت رابطاً جديداً للدخول إلى بوابة العملاء. اضغط على الزر واختر كلمة مرور جديدة.',
      button: 'اختر كلمة مرور جديدة',
      note: 'الرابط يعمل مرة واحدة وتنتهي صلاحيته خلال 48 ساعة. إذا لم تطلبه، تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.',
    },
    fallback: 'إذا لم يعمل الزر، انسخ هذا العنوان في المتصفح:',
    thanks: 'مع أطيب التحيات،',
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function accessEmail(purpose, { name, lang, url }) {
  const L = T[lang] || T.en; const m = L[purpose] || L.reset;
  const rtl = lang === 'ar'; const dir = rtl ? 'rtl' : 'ltr'; const align = rtl ? 'right' : 'left';
  const first = String(name || '').split(/\s+/)[0] || '';
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#f2f2f0;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0d0d0d;padding:22px 28px;color:#d9d9d9;letter-spacing:4px;font-size:13px;text-align:${align}">FA &nbsp;·&nbsp; ARCHITECTURAL DESIGN</td></tr>
<tr><td dir="${dir}" style="padding:28px;text-align:${align};font-size:15px;line-height:1.6">
<p style="margin:0 0 14px">${esc(m.hello(first))}</p>
<p style="margin:0 0 22px">${esc(m.body)}</p>
<p style="margin:0 0 22px;text-align:center"><a href="${esc(url)}" style="display:inline-block;background:#0d0d0d;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:bold">${esc(m.button)}</a></p>
<p style="margin:0 0 18px;color:#555;font-size:13px">${esc(m.note)}</p>
<p style="margin:0 0 4px;color:#777;font-size:12px">${esc(L.fallback)}</p>
<p style="margin:0 0 22px;font-size:12px;word-break:break-all" dir="ltr"><a href="${esc(url)}" style="color:#555">${esc(url)}</a></p>
<p style="margin:0">${esc(L.thanks)}<br>${esc(SIGN)}<br><span style="color:#777">${BRAND} · Kfarhim, Lebanon</span></p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${m.hello(first)}\n\n${m.body}\n\n${m.button}: ${url}\n\n${m.note}\n\n${L.thanks}\n${SIGN}\n${BRAND}`;
  return { subject: m.subject, html, text };
}

async function sendAccessLink(user, purpose, url) {
  const msg = accessEmail(purpose, { name: user.name, lang: user.lang, url });
  return send({ to: user.email, toName: user.name, ...msg, replyTo: process.env.ADMIN_EMAIL || undefined });
}

module.exports = { enabled, send, sendAccessLink, accessEmail };
