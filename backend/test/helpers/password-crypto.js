const crypto = require('crypto');
const { getPasswordEncryptionPublicKey } = require('../../src/lib/password-crypto');

function encryptPassword(password) {
  const { publicKey } = getPasswordEncryptionPublicKey();
  return crypto
    .publicEncrypt(
      {
        key: publicKey,
        oaepHash: 'sha256',
      },
      Buffer.from(String(password), 'utf8'),
    )
    .toString('base64');
}

module.exports = {
  encryptPassword,
};
