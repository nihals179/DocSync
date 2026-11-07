# Azure Key Vault

The backend supports Azure Key Vault through `DefaultAzureCredential`. In Azure, use a managed identity; locally, authenticate with Azure CLI (`az login`) or another supported developer credential.

## Configuration

Set these environment variables:

```dotenv
AZURE_KEY_VAULT_URL=https://<vault-name>.vault.azure.net/
AZURE_KEY_VAULT_ENV_MAPPINGS={"DATABASE_URL":"docsync-database-url","JWT_SECRET":"docsync-jwt-secret"}
```

`AZURE_KEY_VAULT_ENV_MAPPINGS` maps environment variable names to Key Vault secret names. Secrets are loaded before Prisma and the HTTP server initialize. Existing environment variables are overwritten by the configured Key Vault values.

If `AZURE_KEY_VAULT_ENV_MAPPINGS` is not set, Key Vault is not contacted. This keeps local development and tests compatible with the existing `.env` configuration.

## Azure setup

1. Create a Key Vault.
2. Add the required secrets using names containing only letters, numbers, and hyphens.
3. Enable a system-assigned managed identity for the backend host.
4. Grant that identity `Key Vault Secrets User` on the vault.
5. Set `AZURE_KEY_VAULT_URL` and `AZURE_KEY_VAULT_ENV_MAPPINGS` in the deployment environment.
6. Restart the backend after changing mappings.

The backend implementation is in `src/config/key-vault.js`. It caches retrieved values for five minutes and never logs secret values.
