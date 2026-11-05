import { extractFirstName } from '@/lib/sms';

export const DEFAULT_EMAIL_SUBJECT =
  'Important Update & Registration: Next Level Prayers UK ({{first_name}})';

export const DEFAULT_EMAIL_TEMPLATE = `Hi {{first_name}},

Warm greetings from Next Level Prayers UK (Harvesters International Christian Centre)!

We are reaching out with your personal registration link and event details:
https://tinyurl.com/NightofWorshipinSheffield

Event Details:
• Date: Saturday, 21 November 2026
• Doors Open: 2:00 PM
• Venue: Hope Centre, S2 5BQ, Sheffield

If you have not yet registered, please click the link above to secure your free seat today. We cannot wait to host you!

God bless you,
Next Level Prayers UK Team`;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Extracts a clean, valid email address from a lead record or its metadata object.
 */
export function extractLeadEmail(leadOrMetadata) {
  if (!leadOrMetadata) return '';

  // Direct field check
  if (typeof leadOrMetadata.email === 'string' && EMAIL_REGEX.test(leadOrMetadata.email.trim())) {
    return leadOrMetadata.email.trim().toLowerCase();
  }

  const meta =
    leadOrMetadata.metadata && typeof leadOrMetadata.metadata === 'object'
      ? leadOrMetadata.metadata
      : typeof leadOrMetadata === 'object'
      ? leadOrMetadata
      : {};

  const candidateKeys = [
    'email',
    'email_address',
    'e_mail',
    'e-mail',
    'mail',
    'contact_email',
    'attendee_email',
    'user_email',
  ];

  for (const key of candidateKeys) {
    const val = meta[key];
    if (typeof val === 'string') {
      const clean = val.trim().toLowerCase();
      if (EMAIL_REGEX.test(clean)) return clean;
    }
  }

  // Case-insensitive key lookup or any value that matches an email pattern
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v !== 'string') continue;
    const clean = v.trim().toLowerCase();
    if (k.toLowerCase().includes('mail') && EMAIL_REGEX.test(clean)) {
      return clean;
    }
  }

  return '';
}

/**
 * Renders placeholders like {{first_name}}, {{full_name}}, {{attendee_name}}, {{agent_name}}, {{campaign_name}}
 */
export function renderEmailTemplate(template, lead = {}, extra = {}) {
  if (!template) return '';
  const firstName = extractFirstName(lead.full_name, lead.metadata);
  const fullName = (lead.full_name || '').trim() || firstName || 'Friend';
  const email = extractLeadEmail(lead);
  const agentName = extra.agentName || 'Next Level Prayers UK Team';
  const campaignName = extra.campaignName || 'Next Level Prayers UK';

  return String(template)
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*attendee_first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*full_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*attendee_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*agent_name\s*\}\}/gi, agentName)
    .replace(/\{\{\s*campaign_name\s*\}\}/gi, campaignName)
    .replace(/\{\{\s*email\s*\}\}/gi, email)
    .trim();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkifyHtml(escapedText) {
  return escapedText.replace(
    /(https?:\/\/[^\s<]+)/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#d97706;font-weight:600;text-decoration:underline;">$1</a>'
  );
}

/**
 * Converts plain-text campaign email body into a responsive, branded HTML email.
 */
export function buildBrandedHtmlEmail({
  subject = '',
  bodyText = '',
  senderName = 'Next Level Prayers UK',
  ctaLabel = 'Register / Confirm Attendance →',
}) {
  const urlMatch = String(bodyText || '').match(/https?:\/\/[^\s]+/i);
  const primaryUrl = urlMatch ? urlMatch[0].replace(/[.,;!?)]+$/, '') : '';

  const paragraphs = String(bodyText || '')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block
        .split('\n')
        .map(line => linkifyHtml(escapeHtml(line)))
        .join('<br />');
      return `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;color:#1f2937;">${lines}</p>`;
    })
    .join('');

  const ctaBlock = primaryUrl
    ? `<div style="margin:24px 0 24px 0;text-align:center;">
         <a href="${escapeHtml(primaryUrl)}" target="_blank" rel="noopener noreferrer"
            style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#111827;font-weight:700;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:10px;box-shadow:0 4px 12px rgba(217,119,6,0.25);">
           ${escapeHtml(ctaLabel)}
         </a>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e5e7eb;">
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:22px 28px;border-bottom:3px solid #f59e0b;">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#fbbf24;margin-bottom:4px;">
                Harvesters International Christian Centre
              </div>
              <div style="font-size:20px;font-weight:800;color:#ffffff;line-height:1.3;">
                ${escapeHtml(senderName)}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${paragraphs}
              ${ctaBlock}
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;padding:16px 28px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5;text-align:center;">
              Sent by ${escapeHtml(senderName)} • Harvesters UK Outreach Team
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Resolves the active email provider configuration (Resend or Brevo) from env vars or runtime overrides.
 */
export function getEmailProviderConfig(overrides = {}) {
  const clean = v => String(v || '').replace(/^['"\s]+|['"\s]+$/g, '').trim();

  const resendKey = clean(overrides.resendApiKey || (overrides.provider === 'resend' ? overrides.apiKey : '') || process.env.RESEND_API_KEY);
  const brevoKey = clean(overrides.brevoApiKey || (overrides.provider === 'brevo' ? overrides.apiKey : '') || process.env.BREVO_API_KEY);

  let provider = clean(overrides.provider).toLowerCase();
  if (!provider) {
    if (resendKey) provider = 'resend';
    else if (brevoKey) provider = 'brevo';
  }

  const apiKey = provider === 'brevo' ? brevoKey : resendKey;

  const fromEmail =
    clean(
      overrides.fromEmail ||
        process.env.EMAIL_FROM ||
        process.env.RESEND_FROM_EMAIL ||
        process.env.BREVO_FROM_EMAIL
    ) || (provider === 'resend' ? 'onboarding@resend.dev' : '');

  const fromName =
    clean(overrides.fromName || process.env.EMAIL_FROM_NAME) ||
    'Next Level Prayers UK';

  const replyTo = clean(overrides.replyTo || process.env.EMAIL_REPLY_TO || '');

  return {
    configured: Boolean(provider && apiKey),
    provider: provider || null,
    apiKey,
    fromEmail,
    fromName,
    replyTo,
  };
}

/**
 * Sends a single email via Resend or Brevo REST API.
 */
export async function sendCampaignEmail({
  to,
  toName = '',
  subject,
  bodyText,
  html,
  overrides = {},
}) {
  const recipient = String(to || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(recipient)) {
    throw new Error(`Invalid email address: "${to}"`);
  }

  const cfg = getEmailProviderConfig(overrides);
  if (!cfg.configured) {
    throw new Error(
      'No email provider API key configured. Please enter your Resend (RESEND_API_KEY) or Brevo (BREVO_API_KEY) key in the Email Blast settings or Vercel environment variables.'
    );
  }

  const finalSubject = String(subject || '').trim() || 'Update from Next Level Prayers UK';
  const finalHtml =
    html ||
    buildBrandedHtmlEmail({
      subject: finalSubject,
      bodyText,
      senderName: cfg.fromName,
    });

  if (cfg.provider === 'brevo') {
    if (!cfg.fromEmail || !EMAIL_REGEX.test(cfg.fromEmail)) {
      throw new Error(
        'Brevo requires a verified Sender Email (e.g. info@yourdomain.com). Please set the From Email in the Email settings.'
      );
    }

    const payload = {
      sender: {
        name: cfg.fromName,
        email: cfg.fromEmail,
      },
      to: [
        {
          email: recipient,
          ...(toName ? { name: toName } : {}),
        },
      ],
      subject: finalSubject,
      htmlContent: finalHtml,
      textContent: String(bodyText || '').trim(),
      ...(cfg.replyTo && EMAIL_REGEX.test(cfg.replyTo)
        ? { replyTo: { email: cfg.replyTo, name: cfg.fromName } }
        : {}),
    };

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': cfg.apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        data.message || data.error || `Brevo API error (HTTP ${res.status})`
      );
    }

    return {
      id: data.messageId || `brevo-${Date.now()}`,
      provider: 'brevo',
      fromUsed: `${cfg.fromName} <${cfg.fromEmail}>`,
      to: recipient,
    };
  }

  // Default: Resend REST API
  const fromAddr = cfg.fromEmail || 'onboarding@resend.dev';
  const formattedFrom = fromAddr.includes('<')
    ? fromAddr
    : `${cfg.fromName} <${fromAddr}>`;

  const payload = {
    from: formattedFrom,
    to: [recipient],
    subject: finalSubject,
    html: finalHtml,
    text: String(bodyText || '').trim(),
    ...(cfg.replyTo && EMAIL_REGEX.test(cfg.replyTo)
      ? { reply_to: cfg.replyTo }
      : {}),
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.message || data.error?.message || `Resend API error (HTTP ${res.status})`
    );
  }

  return {
    id: data.id || `resend-${Date.now()}`,
    provider: 'resend',
    fromUsed: formattedFrom,
    to: recipient,
  };
}
