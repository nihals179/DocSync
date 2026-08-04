const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');
const { isDatabaseConfigured } = require('./runtime-utils');
const { auditLogs, nowIso } = require('../store');

const AUDIT_LOG_FILE_PATH = process.env.AUDIT_LOG_FILE_PATH
	? path.resolve(process.env.AUDIT_LOG_FILE_PATH)
	: path.resolve(process.cwd(), 'audit-logs.ndjson');

let auditFileReady = false;
const THIS_FILE = path.resolve(__filename);

function normalizeAuditEntry(entry) {
	if (!entry) return null;
	const metadata = entry.metadata && typeof entry.metadata === 'object' ? { ...entry.metadata } : {};
	const source = metadata.__source || null;
	if (source) delete metadata.__source;

	return {
		id: entry.id,
		userId: entry.userId || null,
		organizationId: entry.organizationId || null,
		action: entry.action,
		status: entry.status,
		ipAddress: entry.ipAddress || null,
		userAgent: entry.userAgent || null,
		metadata,
		source,
		createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
	};
}

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
	const metadataWithSource = source
		? {
			...(metadata || {}),
			__source: source,
		}
		: (metadata || {});
	const entry = {
		id: uuidv4(),
		userId,
		organizationId,
		action,
		status,
		ipAddress,
		userAgent,
		metadata: metadata || {},
		createdAt: nowIso(),
		source,
	};

	if (isDatabaseConfigured()) {
		prisma.auditLog.create({
			data: {
				id: entry.id,
				userId: entry.userId,
				organizationId: entry.organizationId,
				action: entry.action,
				status: entry.status,
				ipAddress: entry.ipAddress,
				userAgent: entry.userAgent,
				metadata: metadataWithSource,
				createdAt: new Date(entry.createdAt),
			},
		}).catch(() => {
			// Keep request path non-blocking if DB writes fail.
		});
	}

	if (process.env.AUDIT_LOG_FILE_MIRROR === 'true') {
		appendAuditLogToFile(entry);
	}

	return entry;
}

async function listAuditLogs({ organizationId, userId, action, status, limit = 100 }) {
	const cappedLimit = Math.min(1000, Math.max(1, Number(limit) || 100));

	if (isDatabaseConfigured()) {
		const rows = await prisma.auditLog.findMany({
			where: {
				...(organizationId ? { organizationId } : {}),
				...(userId ? { userId } : {}),
				...(action ? { action } : {}),
				...(status ? { status } : {}),
			},
			orderBy: { createdAt: 'desc' },
			take: cappedLimit,
		});

		return rows.map((row) => {
			const normalized = normalizeAuditEntry(row);
			return normalized;
		});
	}

	const rows = [...auditLogs.values()].filter((entry) => {
		if (organizationId && entry.organizationId !== organizationId) return false;
		if (userId && entry.userId !== userId) return false;
		if (action && entry.action !== action) return false;
		if (status && entry.status !== status) return false;
		return true;
	});

	rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
	return rows.slice(0, cappedLimit);
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
