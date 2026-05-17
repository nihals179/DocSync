const TEMPLATE_CACHE_TTL_MS = Number(process.env.TEMPLATE_CACHE_TTL_MS || 60_000);

const templateCache = {
  items: null,
  expiresAt: 0,
};

function cloneTemplates(list) {
  return list.map((template) => ({ ...template }));
}

function readTemplateCache() {
  if (!templateCache.items) return null;
  if (Date.now() >= templateCache.expiresAt) {
    templateCache.items = null;
    templateCache.expiresAt = 0;
    return null;
  }
  return cloneTemplates(templateCache.items);
}

function writeTemplateCache(list) {
  templateCache.items = cloneTemplates(list);
  templateCache.expiresAt = Date.now() + TEMPLATE_CACHE_TTL_MS;
}

module.exports = {
  cloneTemplates,
  readTemplateCache,
  writeTemplateCache,
};
