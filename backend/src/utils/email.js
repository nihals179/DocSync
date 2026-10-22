const { EmailClient } = require('@azure/communication-email');

require('dotenv').config();

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
const senderEmail = process.env.AZURE_EMAIL_SENDER;

if (!connectionString) {
  throw new Error('AZURE_COMMUNICATION_CONNECTION_STRING environment variable is not set');
}

if (!senderEmail) {
  throw new Error('AZURE_EMAIL_SENDER environment variable is not set');
}

const emailClient = new EmailClient(connectionString);

async function sendEmail({ to, subject, htmlContent, plainTextContent }) {
  if (!to || !subject) {
    throw new Error('Email recipient (to) and subject are required');
  }

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
  };

  const poller = await emailClient.beginSend(emailMessage);
  const result = await poller.pollUntilDone();

  return result;
}

async function sendVerificationEmail(email, verificationLink) {
  const htmlContent = `
    <h2>Email Verification</h2>
    <p>Click the link below to verify your email:</p>
    <a href="${verificationLink}">Verify Email</a>
    <p>Or copy and paste this link in your browser:</p>
    <p>${verificationLink}</p>
    <p>This link expires in 24 hours.</p>
  `;

  const plainTextContent = `Email Verification\n\nVerify your email: ${verificationLink}\n\nThis link expires in 24 hours.`;

  return sendEmail({
    to: email,
    subject: 'Verify Your Email Address',
    htmlContent,
    plainTextContent,
  });
}

async function sendPasswordResetEmail(email, resetLink) {
  const htmlContent = `
    <h2>Password Reset</h2>
    <p>Click the link below to reset your password:</p>
    <a href="${resetLink}">Reset Password</a>
    <p>Or copy and paste this link in your browser:</p>
    <p>${resetLink}</p>
    <p>This link expires in 1 hour.</p>
    <p>If you didn't request this, please ignore this email.</p>
  `;

  const plainTextContent = `Password Reset\n\nReset your password: ${resetLink}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, please ignore this email.`;

  return sendEmail({
    to: email,
    subject: 'Reset Your Password',
    htmlContent,
    plainTextContent,
  });
}

async function sendWelcomeEmail(email, userName) {
  const htmlContent = `
    <h2>Welcome to DocSync!</h2>
    <p>Hi ${userName},</p>
    <p>Thank you for joining DocSync. We're excited to have you on board!</p>
    <p>You can now start creating and managing your documents.</p>
    <p>If you have any questions, feel free to reach out to our support team.</p>
  `;

  const plainTextContent = `Welcome to DocSync!\n\nHi ${userName},\n\nThank you for joining DocSync. We're excited to have you on board!\n\nYou can now start creating and managing your documents.`;

  return sendEmail({
    to: email,
    subject: 'Welcome to DocSync',
    htmlContent,
    plainTextContent,
  });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  emailClient,
};
