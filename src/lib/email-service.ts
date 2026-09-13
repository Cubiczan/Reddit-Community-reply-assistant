import nodemailer from 'nodemailer';
import { escapeHtml, safeHttpUrl } from './html-escape';

interface DigestThread {
  title: string;
  subreddit: string;
  url: string;
  score: number;
  buyingIntent: number;
  draftReply: string | null;
  matchedKeywords: string[];
  matchedCompetitors: string[];
  intentSignals: string[];
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

function getSmtpForEmail(email: string): SmtpConfig | null {
  if (email.includes('impactquadrant')) {
    const host = process.env.SMTP_IQ_HOST;
    const port = parseInt(process.env.SMTP_IQ_PORT || '587');
    const user = process.env.SMTP_IQ_USER;
    const pass = process.env.SMTP_IQ_PASS;
    if (host && user && pass) return { host, port, user, pass };
  }
  if (email.includes('cubiczan')) {
    const host = process.env.SMTP_CZ_HOST;
    const port = parseInt(process.env.SMTP_CZ_PORT || '587');
    const user = process.env.SMTP_CZ_USER;
    const pass = process.env.SMTP_CZ_PASS;
    if (host && user && pass) return { host, port, user, pass };
  }
  // Fallback: try generic SMTP_ vars
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (host && user && pass) return { host, port, user, pass };
  return null;
}

export function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_IQ_USER && process.env.SMTP_IQ_PASS) ||
         !!(process.env.SMTP_CZ_USER && process.env.SMTP_CZ_PASS) ||
         !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function getEmailStatus(): { email: string; configured: boolean }[] {
  return [
    { email: 'sam@impactquadrant.info', configured: !!(process.env.SMTP_IQ_USER && process.env.SMTP_IQ_PASS) },
    { email: 'sam@cubiczan.com', configured: !!(process.env.SMTP_CZ_USER && process.env.SMTP_CZ_PASS) },
  ];
}

export async function sendDigestEmail(
  businessEmail: string,
  businessName: string,
  threads: DigestThread[],
  reply: (msg: string) => void
): Promise<boolean> {
  const config = getSmtpForEmail(businessEmail);
  if (!config) {
    reply(`Error: SMTP not configured for ${businessEmail}. Add credentials to .env.`);
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  const topThreads = threads.slice(0, 10);

  const threadHtml = topThreads.map((thread, i) => `
    <div style="margin-bottom: 24px; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: ${thread.matchedCompetitors.length > 0 ? '#fef3c7' : '#f9fafb'};">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 12px; color: #6b7280;">#${i + 1} &bull; r/${escapeHtml(thread.subreddit)}</span>
        <div style="display: flex; gap: 8px;">
          <span style="font-size: 12px; padding: 2px 8px; border-radius: 12px; background: #dbeafe; color: #1d4ed8;">Score: ${escapeHtml(thread.score)}</span>
          <span style="font-size: 12px; padding: 2px 8px; border-radius: 12px; background: ${thread.buyingIntent >= 60 ? '#dcfce7' : '#f3f4f6'}; color: ${thread.buyingIntent >= 60 ? '#166534' : '#374151'};">Intent: ${escapeHtml(thread.buyingIntent)}%</span>
        </div>
      </div>
      <h3 style="font-size: 16px; margin: 0 0 8px 0;">
        <a href="${escapeHtml(safeHttpUrl(thread.url))}" style="color: #1f2937; text-decoration: none;">${escapeHtml(thread.title)}</a>
      </h3>
      ${thread.matchedKeywords.length > 0 ? `<p style="font-size: 12px; color: #6b7280; margin: 0 0 4px 0;">Keywords: ${escapeHtml(thread.matchedKeywords.join(', '))}</p>` : ''}
      ${thread.matchedCompetitors.length > 0 ? `<p style="font-size: 12px; color: #92400e; margin: 0 0 4px 0; font-weight: 600;">&#9888;&#65039; Competitor mentioned: ${escapeHtml(thread.matchedCompetitors.join(', '))}</p>` : ''}
      ${thread.intentSignals.length > 0 ? `<p style="font-size: 12px; color: #059669; margin: 0 0 8px 0;">Signals: ${escapeHtml(thread.intentSignals.join(' | '))}</p>` : ''}
      ${thread.draftReply ? `
        <div style="margin-top: 12px; padding: 12px; background: white; border-radius: 6px; border-left: 3px solid #f59e0b;">
          <p style="font-size: 11px; color: #6b7280; margin: 0 0 4px 0; font-weight: 600;">SUGGESTED REPLY:</p>
          <p style="font-size: 13px; color: #374151; margin: 0; white-space: pre-wrap;">${escapeHtml(thread.draftReply)}</p>
        </div>
      ` : ''}
    </div>
  `).join('');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
      <div style="text-align: center; padding: 24px 0; border-bottom: 1px solid #e5e7eb;">
        <h1 style="font-size: 24px; margin: 0; color: #111827;">Reddit Opportunities</h1>
        <p style="font-size: 14px; color: #6b7280; margin: 4px 0 0 0;">${escapeHtml(businessName)} &bull; ${escapeHtml(new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}</p>
      </div>
      <div style="padding: 24px 0;">
        <p style="font-size: 14px; color: #4b5563; margin: 0 0 20px 0;">
          Found <strong>${threads.length}</strong> relevant threads. Here are your top opportunities ranked by engagement score.
        </p>
        ${threadHtml}
      </div>
      <div style="text-align: center; padding: 16px 0; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        <p>Generated by Community Reply Assistant</p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: config.user,
      to: businessEmail,
      subject: `[Reddit Opportunities] ${threads.length} leads for ${businessName} - ${new Date().toLocaleDateString()}`,
      html,
    });
    reply(`Digest email sent to ${businessEmail} with ${threads.length} threads.`);
    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    reply(`Error sending email: ${msg}`);
    return false;
  }
}

export async function testEmailConnection(email: string): Promise<boolean> {
  const config = getSmtpForEmail(email);
  if (!config) return false;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  try {
    await transporter.sendMail({
      from: config.user,
      to: email,
      subject: 'Reddit Marketing System - Test Email',
      html: '<p>Your email settings are configured correctly! This is a test email from your Reddit Marketing System.</p>',
    });
    return true;
  } catch {
    return false;
  }
}
