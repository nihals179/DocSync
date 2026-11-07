require('dotenv').config();

const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');

const cache = new Map();
let client;

function getVaultUrl() {
  return String(process.env.AZURE_KEY_VAULT_URL || '').trim().replace(/\/+$/, '');
}

function isEnabled() {
  return Boolean(getVaultUrl());
}

function getClient() {
  if (!isEnabled()) return null;
  if (!client) {
    client = new SecretClient(getVaultUrl(), new DefaultAzureCredential());
  }
  return client;
}

function normalizeSecretName(name) {
  const normalized = String(name || '').trim();
  if (!normalized || !/^[A-Za-z0-9-]+$/.test(normalized)) {
    throw new Error('Azure Key Vault secret names may contain only letters, numbers, and hyphens.');
  }
  return normalized;
}

async function getSecret(name, { cacheTtlMs = 300_000, required = true } = {}) {
  const secretName = normalizeSecretName(name);
  const cached = cache.get(secretName);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const keyVaultClient = getClient();
  if (!keyVaultClient) {
    if (required) throw new Error('AZURE_KEY_VAULT_URL is not configured.');
    return null;
  }

  try {
    const result = await keyVaultClient.getSecret(secretName);
    const value = result.value;
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Azure Key Vault secret "${secretName}" is empty.`);
    }
    cache.set(secretName, { value, expiresAt: Date.now() + cacheTtlMs });
    return value;
  } catch (error) {
    if (!required && error?.statusCode === 404) return null;
    throw new Error(`Failed to retrieve Azure Key Vault secret "${secretName}".`, { cause: error });
  }
}

async function setSecret(name, value) {
  const secretName = normalizeSecretName(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Azure Key Vault secret value must be a non-empty string.');
  }
  const keyVaultClient = getClient();
  if (!keyVaultClient) throw new Error('AZURE_KEY_VAULT_URL is not configured.');
  const result = await keyVaultClient.setSecret(secretName, value);
  cache.delete(secretName);
  return result;
}

async function loadConfiguredSecrets() {
  const mappingText = String(process.env.AZURE_KEY_VAULT_ENV_MAPPINGS || '').trim();
  if (!mappingText) return;

  let mappings;
  try {
    mappings = JSON.parse(mappingText);
  } catch (error) {
    throw new Error('AZURE_KEY_VAULT_ENV_MAPPINGS must be valid JSON.', { cause: error });
  }

  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
    throw new Error('AZURE_KEY_VAULT_ENV_MAPPINGS must be a JSON object.');
  }

  for (const [environmentName, secretName] of Object.entries(mappings)) {
    if (!/^[A-Z][A-Z0-9_.]*$/.test(environmentName)) {
      throw new Error(`Invalid environment variable name in Key Vault mapping: ${environmentName}`);
    }
    process.env[environmentName] = await getSecret(secretName);
  }
}

module.exports = {
  getSecret,
  loadConfiguredSecrets,
  setSecret,
};
