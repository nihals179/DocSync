function bytes(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

module.exports = {
  bytes,
};
