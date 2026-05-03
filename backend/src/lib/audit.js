const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { auditLogs, nowIso } = require('../store');

const AUDIT_LOG_FILE_PATH = process.env.AUDIT_LOG_FILE_PATH
	? path.resolve(process.env.AUDIT_LOG_FILE_PATH)
	: path.resolve(process.cwd(), 'audit-logs.ndjson');

let auditFileReady = false;
const THIS_FILE = path.resolve(__filename);

function parseStackLine(line) {
	const normalized = String(line || '').trim();
	const match = normalized.match(/^at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?$/);
	if (!match) return null;
	const [, functionName, filePath, lineNumber, columnNumber] = match;
	if (!path.isAbsolute(filePath)) return null;
	return {
		functionName: functionName || null,
		filePath,
		line: Number(lineNumber),
		column: Number(columnNumber),
	};
}

function getCallerLocation() {
	const lines = String(new Error().stack || '').split('\n').slice(1);
	for (const line of lines) {
		const parsed = parseStackLine(line);
		if (!parsed) continue;
		if (parsed.filePath === THIS_FILE) continue;
		if (parsed.filePath.includes('node:internal') || parsed.filePath.includes('/internal/')) continue;
		return {
			file: path.relative(process.cwd(), parsed.filePath),
			line: parsed.line,
			column: parsed.column,
			functionName: parsed.functionName,
		};
	}
	return null;
}

function ensureAuditFilePath() {
	if (auditFileReady) return;
	fs.mkdirSync(path.dirname(AUDIT_LOG_FILE_PATH), { recursive: true });
	auditFileReady = true;
}

function appendAuditLogToFile(entry) {
	try {
		ensureAuditFilePath();
		fs.appendFileSync(
			AUDIT_LOG_FILE_PATH,
			`${JSON.stringify({
				loggedAt: nowIso(),
				...entry,
			})}\n`,
			'utf8',
		);
	} catch {
		// Keep auth/business flows resilient even if file logging fails.
	}
}

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
	const source = getCallerLocation();
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
		source,
	};
	auditLogs.set(entry.id, entry);
	appendAuditLogToFile(entry);
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
		const metadataWithSource = entry.source
			? {
				...(entry.metadata || {}),
				__source: entry.source,
			}
			: (entry.metadata || {});
		const row = [
			entry.id,
			entry.createdAt,
			entry.organizationId || '',
			entry.userId,
			entry.action,
			entry.status,
			JSON.stringify(metadataWithSource),
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
