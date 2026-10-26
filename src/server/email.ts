import nodemailer from 'nodemailer';
import { getAppName } from '../shared/config.ts';

export interface SendResetCodeResult {
  delivered: boolean;
  provider: 'gmail' | 'smtp' | 'resend' | 'brevo' | 'webhook' | 'none';
  error?: string;
}

function buildResetEmailContent(params: {
  appName: string;
  recipientName: string;
  code: string;
  expiresInMinutes: number;
}): { subject: string; text: string; html: string } {
  const { appName, recipientName, code, expiresInMinutes } = params;
  const subject = `${code} is your ${appName} password reset code`;

  const text = [
    `Hi ${recipientName},`,
    '',
    `Your single-use verification code to reset your ${appName} password is:`,
    '',
    `    ${code}`,
    '',
    `This code expires in ${expiresInMinutes} minutes. If you did not request a password reset, you can safely ignore this email.`,
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0B0D0B; color: #F5F7F2; padding: 32px 24px; border-radius: 12px; max-width: 480px; margin: 0 auto; border: 1px solid #232922;">
      <div style="font-size: 18px; font-weight: 700; color: #F5F7F2; margin-bottom: 16px;">
        ${appName}
      </div>
      <p style="font-size: 14px; color: #9BA397; line-height: 1.6; margin: 0 0 20px;">
        Hi ${recipientName}, use the 6-digit verification code below to reset your password:
      </p>
      <div style="background-color: #121512; border: 1px solid #323B30; border-radius: 10px; padding: 18px; text-align: center; margin-bottom: 20px;">
        <span style="font-family: 'Courier New', monospace; font-size: 30px; font-weight: 700; letter-spacing: 8px; color: #C6FF00;">
          ${code}
        </span>
      </div>
      <p style="font-size: 12px; color: #9BA397; line-height: 1.5; margin: 0;">
        This code is valid for <strong>${expiresInMinutes} minutes</strong> and can only be used once. If you didn't request this code, you can ignore this message.
      </p>
    </div>
  `.trim();

  return { subject, text, html };
}

function resolveSmtpCredentials(): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  isGmail: boolean;
} | null {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailAppPass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '').trim();

  if (gmailUser && gmailAppPass) {
    return {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: gmailUser,
      pass: gmailAppPass,
      isGmail: true,
    };
  }

  const smtpUser = process.env.SMTP_USER?.trim();
  const rawSmtpPass = process.env.SMTP_PASS?.trim();
  const smtpHostRaw = process.env.SMTP_HOST?.trim();

  if (smtpUser && rawSmtpPass) {
    const looksLikeGmail =
      smtpHostRaw === 'smtp.gmail.com' ||
      (!smtpHostRaw && /@(gmail|googlemail)\.com$/i.test(smtpUser));
    const host = smtpHostRaw || (looksLikeGmail ? 'smtp.gmail.com' : '');
    if (!host) return null;

    const port = Number(process.env.SMTP_PORT || 465);
    const secure = process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;
    const normalizedPass = looksLikeGmail ? rawSmtpPass.replace(/\s+/g, '') : rawSmtpPass;

    return {
      host,
      port,
      secure,
      user: smtpUser,
      pass: normalizedPass,
      isGmail: looksLikeGmail,
    };
  }

  return null;
}

export function isTransactionalEmailConfigured(): boolean {
  if (resolveSmtpCredentials() !== null) return true;
  if (process.env.RESEND_API_KEY?.trim()) return true;
  if (process.env.BREVO_API_KEY?.trim() && process.env.SMTP_FROM?.trim()) return true;
  if (process.env.PASSWORD_RESET_WEBHOOK_URL?.trim()) return true;
  return false;
}

export async function sendPasswordResetCodeEmail(params: {
  to: string;
  recipientName: string;
  code: string;
  expiresInMinutes?: number;
}): Promise<SendResetCodeResult> {
  const appName = getAppName();
  const expiresInMinutes = params.expiresInMinutes ?? 15;
  const content = buildResetEmailContent({
    appName,
    recipientName: params.recipientName,
    code: params.code,
    expiresInMinutes,
  });

  // 1. Gmail App Password or Custom SMTP Delivery
  const smtp = resolveSmtpCredentials();
  if (smtp) {
    const fromAddress =
      process.env.SMTP_FROM?.trim() || `${appName} <${smtp.user}>`;

    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
      });

      await transporter.sendMail({
        from: fromAddress,
        to: params.to,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });

      return { delivered: true, provider: smtp.isGmail ? 'gmail' : 'smtp' };
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      console.error('SMTP password reset delivery failed:', errMsg);
      const isAuthErr = /535|Username and Password not accepted|Invalid login|EAUTH/i.test(errMsg);
      return {
        delivered: false,
        provider: smtp.isGmail ? 'gmail' : 'smtp',
        error: isAuthErr
          ? 'Email authentication failed. If using Gmail, set GMAIL_APP_PASSWORD to a 16-character Google App Password (from Google Account -> Security -> App Passwords).'
          : 'Unable to send verification email via configured SMTP server.',
      };
    }
  }

  // 2. Resend HTTP API Delivery
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const fromAddress =
      process.env.SMTP_FROM?.trim() || `${appName} <onboarding@resend.dev>`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [params.to],
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        console.error('Resend API error:', res.status, bodyText);
        return {
          delivered: false,
          provider: 'resend',
          error: 'Resend could not deliver to this recipient. Verify your sender domain in Resend or use GMAIL_USER + GMAIL_APP_PASSWORD.',
        };
      }

      return { delivered: true, provider: 'resend' };
    } catch (err: any) {
      console.error('Resend fetch error:', err?.message || err);
      return {
        delivered: false,
        provider: 'resend',
        error: 'Unable to reach Resend email service.',
      };
    }
  }

  // 3. Brevo HTTP API Delivery
  const brevoKey = process.env.BREVO_API_KEY?.trim();
  const brevoSender = process.env.SMTP_FROM?.trim();
  if (brevoKey && brevoSender) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: appName, email: brevoSender },
          to: [{ email: params.to, name: params.recipientName }],
          subject: content.subject,
          textContent: content.text,
          htmlContent: content.html,
        }),
      });

      if (!res.ok) {
        return {
          delivered: false,
          provider: 'brevo',
          error: 'Unable to send verification email via Brevo.',
        };
      }

      return { delivered: true, provider: 'brevo' };
    } catch {
      return {
        delivered: false,
        provider: 'brevo',
        error: 'Unable to reach Brevo email service.',
      };
    }
  }

  // 4. Outbound Webhook Delivery
  const webhookUrl = process.env.PASSWORD_RESET_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: params.to,
          recipientName: params.recipientName,
          code: params.code,
          expiresInMinutes,
          appName,
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
      });

      if (!res.ok) {
        return {
          delivered: false,
          provider: 'webhook',
          error: 'Password reset email webhook returned an error.',
        };
      }

      return { delivered: true, provider: 'webhook' };
    } catch (err: any) {
      console.error('Webhook delivery error:', err?.message || err);
      return {
        delivered: false,
        provider: 'webhook',
        error: 'Unable to reach password reset email webhook.',
      };
    }
  }

  return { delivered: false, provider: 'none' };
}
