const { EmailClient } = require('@azure/communication-email');
const mjml2html = require('mjml');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
const senderEmail = process.env.AZURE_EMAIL_SENDER;
const emailTemplatesDir = path.join(__dirname, '../..', 'public/emails');

if (!connectionString) {
  throw new Error('AZURE_COMMUNICATION_CONNECTION_STRING environment variable is not set');
}

if (!senderEmail) {
  throw new Error('AZURE_EMAIL_SENDER environment variable is not set');
}

const emailClient = new EmailClient(connectionString);

async function compileMjml(mjmlContent, variables = {}) {
  let replacedContent = mjmlContent;
  for (const [key, value] of Object.entries(variables)) {
    replacedContent = replacedContent.replace(new RegExp(key, 'g'), value);
  }

  const result = await mjml2html(replacedContent);
  const html = result.html || '';
  const errors = result.errors || [];

  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`MJML compilation error: ${errors.map(e => e.message || e).join(', ')}`);
  }

  if (!html) {
    throw new Error('MJML compilation failed: No HTML generated');
  }

  return html;
}

function plainTextFromHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');
}

async function sendEmail({ to, subject, htmlContent, plainTextContent, importance = 'normal', replyTo = null }) {
  if (!to || !subject) {
    throw new Error('Email recipient (to) and subject are required');
  }

  const supportEmail = process.env.SUPPORT_EMAIL || 'support@docsync.app';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  const emailMessage = {
    senderAddress: senderEmail,
    recipients: {
      to: Array.isArray(to) ? to.map(email => ({ address: email })) : [{ address: to }],
    },
    content: {
      subject,
      ...(htmlContent && { html: htmlContent }),
      ...(plainTextContent && { plainText: plainTextContent }),
    },
    headers: {
      'X-Priority': importance === 'high' ? '1' : '3',
      'Importance': importance === 'high' ? 'high' : 'normal',
      'X-MSMail-Priority': importance === 'high' ? 'High' : 'Normal',
      'X-Mailer': 'DocSync',
      'Reply-To': replyTo || supportEmail,
      'List-Unsubscribe': `<${appUrl}/unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Precedence': 'bulk',
    },
  };

  const poller = await emailClient.beginSend(emailMessage);
  const result = await poller.pollUntilDone();

  return result;
}

async function sendVerificationEmail(email, verificationLink, userName = '') {
  const mjmlPath = path.join(emailTemplatesDir, 'verify-email.mjml');
  const mjmlContent = fs.readFileSync(mjmlPath, 'utf-8');

  const htmlContent = await compileMjml(mjmlContent, {
    '{{userName}}': userName,
    '{{verificationLink}}': verificationLink,
  });

  const plainTextContent = plainTextFromHtml(htmlContent);

  return sendEmail({
    to: email,
    subject: 'Verify Your Email Address',
    htmlContent,
    plainTextContent,
  });
}

async function sendPasswordResetEmail(email, resetLink, userName = '') {
  const mjmlPath = path.join(emailTemplatesDir, 'reset-password.mjml');
  const mjmlContent = fs.readFileSync(mjmlPath, 'utf-8');

  const htmlContent = await compileMjml(mjmlContent, {
    '{{userName}}': userName,
    '{{resetLink}}': resetLink,
  });

  const plainTextContent = plainTextFromHtml(htmlContent);

  return sendEmail({
    to: email,
    subject: 'Reset Your Password',
    htmlContent,
    plainTextContent,
  });
}

async function sendWelcomeEmail(email, userName) {
  const mjmlPath = path.join(emailTemplatesDir, 'welcome.mjml');
  const mjmlContent = fs.readFileSync(mjmlPath, 'utf-8');

  const htmlContent = await compileMjml(mjmlContent, {
    '{{userName}}': userName,
  });

  const plainTextContent = plainTextFromHtml(htmlContent);

  return sendEmail({
    to: email,
    subject: 'Welcome to DocSync',
    htmlContent,
    plainTextContent,
  });
}

async function sendInviteEmail(email, inviterName, tenantName, acceptLink, expirationDate) {
  const mjmlPath = path.join(emailTemplatesDir, 'invite.mjml');
  const mjmlContent = fs.readFileSync(mjmlPath, 'utf-8');

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@docsync.app';

  const htmlContent = await compileMjml(mjmlContent, {
    '{{inviterName}}': inviterName,
    '{{tenantName}}': tenantName,
    '{{acceptLink}}': acceptLink,
    '{{expirationDate}}': expirationDate,
    '{{supportUrl}}': `${appUrl}/support`,
    '{{unsubscribeUrl}}': `${appUrl}/unsubscribe?email=${encodeURIComponent(email)}`,
  });

  const plainTextContent = plainTextFromHtml(htmlContent);

  return sendEmail({
    to: email,
    subject: `You're invited to join ${tenantName} on DocSync`,
    htmlContent,
    plainTextContent,
    importance: 'high',
    replyTo: supportEmail,
  });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendInviteEmail,
  emailClient,
};
