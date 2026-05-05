const { prisma } = require('../db/client');

const persistentMaps = [];

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

class PersistentMap extends Map {
  constructor(mapName) {
    super();
    this.mapName = mapName;
    this.hydrated = false;
    persistentMaps.push(this);
  }

  async hydrate() {
    if (!hasDatabase() || this.hydrated) return;
    const entries = await prisma.localStoreEntry.findMany({
      where: { mapName: this.mapName },
    });
    for (const row of entries) {
      super.set(row.entryKey, row.value);
    }
    this.hydrated = true;
  }

  set(key, value) {
    const result = super.set(key, value);
    if (hasDatabase()) {
      void prisma.localStoreEntry.upsert({
        where: {
          mapName_entryKey: {
            mapName: this.mapName,
            entryKey: String(key),
          },
        },
        update: { value },
        create: {
          mapName: this.mapName,
          entryKey: String(key),
          value,
        },
      }).catch(() => {});
    }
    return result;
  }

  delete(key) {
    const result = super.delete(key);
    if (hasDatabase()) {
      void prisma.localStoreEntry.deleteMany({
        where: {
          mapName: this.mapName,
          entryKey: String(key),
        },
      }).catch(() => {});
    }
    return result;
  }

  clear() {
    super.clear();
    if (hasDatabase()) {
      void prisma.localStoreEntry.deleteMany({
        where: { mapName: this.mapName },
      }).catch(() => {});
    }
  }
}

async function initializePersistentMaps() {
  if (!hasDatabase()) return;
  for (const mapInstance of persistentMaps) {
    await mapInstance.hydrate();
  }
}

function createPersistentMap(mapName) {
  return new PersistentMap(mapName);
}

module.exports = {
  createPersistentMap,
  initializePersistentMaps,
};
