const persistentMaps = [];

class PersistentMap extends Map {
  constructor(mapName) {
    super();
    this.mapName = mapName;
    this.hydrated = false;
    persistentMaps.push(this);
  }

  async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
  }

  set(key, value) {
    return super.set(key, value);
  }

  delete(key) {
    return super.delete(key);
  }

  clear() {
    super.clear();
  }
}

async function initializePersistentMaps() {
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
