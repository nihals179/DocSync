const { v4: uuidv4 } = require('uuid');
const { auditLogs, nowIso } = require('../store');

function writeAuditLog({
	userId,
	organizationId = null,
	action,
	status = 'success',
	ipAddress = null,
	userAgent = null,
	metadata = {},
}) {
	if (!userId || !action) return null;
	const entry = {
		id: uuidv4(),
		userId,
		organizationId,
		action,
		status,
		ipAddress,
		userAgent,
		metadata,
		createdAt: nowIso(),
	};
	auditLogs.set(entry.id, entry);
	return entry;
}

function listAuditLogs({ organizationId, userId, action, status, limit = 100 }) {
	const rows = [...auditLogs.values()].filter((entry) => {
		if (organizationId && entry.organizationId !== organizationId) return false;
		if (userId && entry.userId !== userId) return false;
		if (action && entry.action !== action) return false;
		if (status && entry.status !== status) return false;
		return true;
	});

	rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
	return rows.slice(0, Math.min(1000, Math.max(1, Number(limit) || 100)));
}

function toAuditCsv(entries) {
	const headers = ['id', 'createdAt', 'organizationId', 'userId', 'action', 'status', 'metadata'];
	const escape = (value) => {
		const str = String(value ?? '');
		if (/[,"\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
		return str;
	};

	const lines = [headers.join(',')];
	for (const entry of entries) {
		const row = [
			entry.id,
			entry.createdAt,
			entry.organizationId || '',
			entry.userId,
			entry.action,
			entry.status,
			JSON.stringify(entry.metadata || {}),
		].map(escape);
		lines.push(row.join(','));
	}
	return `${lines.join('\n')}\n`;
}

module.exports = {
	writeAuditLog,
	listAuditLogs,
	toAuditCsv,
};
