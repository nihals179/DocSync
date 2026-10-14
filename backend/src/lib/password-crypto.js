const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'RSA-OAEP';
const ENCRYPTION_HASH = 'sha256';

function normalizePemFromEnv(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

function resolveEncryptionKeyPair() {
  const privateKeyFromEnv = normalizePemFromEnv(process.env.PASSWORD_ENCRYPTION_PRIVATE_KEY);
  const publicKeyFromEnv = normalizePemFromEnv(process.env.PASSWORD_ENCRYPTION_PUBLIC_KEY);

  if (privateKeyFromEnv) {
    const derivedPublicKey = crypto.createPublicKey(privateKeyFromEnv).export({
      type: 'spki',
      format: 'pem',
    });
    return {
      privateKey: privateKeyFromEnv,
      publicKey: publicKeyFromEnv || derivedPublicKey,
    };
  }

  if (publicKeyFromEnv) {
    throw new Error('PASSWORD_ENCRYPTION_PRIVATE_KEY is required when PASSWORD_ENCRYPTION_PUBLIC_KEY is configured.');
  }

  // Development fallback for local runs when key material is not provided.
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });
}

const { publicKey, privateKey } = resolveEncryptionKeyPair();

function getPasswordEncryptionPublicKey() {
  return {
    algorithm: ENCRYPTION_ALGORITHM,
    hash: ENCRYPTION_HASH,
    publicKey,
  };
}

function decryptPassword(encryptedPasswordBase64) {
  if (!encryptedPasswordBase64) {
    throw new Error('Encrypted password is required.');
  }

  const encryptedBuffer = Buffer.from(String(encryptedPasswordBase64), 'base64');
  if (!encryptedBuffer.length) {
    throw new Error('Encrypted password payload is empty.');
  }

  const decryptedBuffer = crypto.privateDecrypt(
    {
      key: privateKey,
      oaepHash: ENCRYPTION_HASH,
    },
    encryptedBuffer,
  );

  return decryptedBuffer.toString('utf8');
}

module.exports = {
  getPasswordEncryptionPublicKey,
  decryptPassword,
};