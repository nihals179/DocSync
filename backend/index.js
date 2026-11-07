const { loadConfiguredSecrets } = require('./src/config/key-vault');

(async () => {
	await loadConfiguredSecrets();
	require('./src/server');
})().catch((error) => {
	console.error('[startup] Failed to load Azure Key Vault configuration.');
	console.error(error);
	process.exitCode = 1;
});
