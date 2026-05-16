const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'RSA-OAEP';
const ENCRYPTION_HASH = 'sha256';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
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