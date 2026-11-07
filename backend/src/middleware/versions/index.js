const { tenantPrisma: prisma } = require('../../db/tenant-client');

function parseSavedAtMs(savedAt) {
  const ts = Date.parse(String(savedAt || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function getRetentionCutoffMs(retentionDays) {
  if (retentionDays === null || retentionDays === undefined) return null;
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return Date.now();
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function filterVersionsByRetention(versionsList, retentionDays) {
  const cutoffMs = getRetentionCutoffMs(retentionDays);
  if (cutoffMs === null) return versionsList;
  return versionsList.filter((item) => parseSavedAtMs(item.savedAt) >= cutoffMs);
}

/**
 * The version a document is on: its baseVersionId (set by commit, publish and restore) when
 * that version is still among `versions`, otherwise the newest of them; null when empty.
 * `versions` must be newest first and already limited to the history retention window, so
 * the current version is always one the user can see and restore.
 */
function pickCurrentVersionId(baseVersionId, versions) {
  if (baseVersionId && versions.some((version) => version.id === baseVersionId)) return baseVersionId;
  return versions[0]?.id ?? null;
}

/**
 * pickCurrentVersionId for a document row, with at most two small lookups. Versions older than
 * the plan's history retention (`retentionDays`, null for unlimited) don't count.
 */
async function getCurrentVersionId(doc, retentionDays = null) {
  const cutoffMs = getRetentionCutoffMs(retentionDays);
  const retained = cutoffMs === null ? {} : { savedAt: { gte: new Date(cutoffMs) } };
  if (doc.baseVersionId) {
    const base = await prisma.version.findFirst({
      where: { id: doc.baseVersionId, docId: doc.id, ...retained },
      select: { id: true },
    });
    if (base) return base.id;
  }
  const latest = await prisma.version.findFirst({
    where: { docId: doc.id, ...retained },
    orderBy: { savedAt: 'desc' },
    select: { id: true },
  });
  return latest?.id ?? null;
}

module.exports = {
  filterVersionsByRetention,
  getCurrentVersionId,
  pickCurrentVersionId,
};
