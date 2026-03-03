function isElectron() {
  return !!(window.electronAPI && window.electronAPI.storageGet);
}

const electronStorage = {
  get: (key) => window.electronAPI.storageGet(key),
  set: (key, value) => window.electronAPI.storageSet(key, value),
};

const browserStorage = {
  get: (key) => {
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(key)));
    } catch {
      return Promise.resolve(null);
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Degrade silently on QuotaExceededError (localStorage is full)
      if (e.name === 'QuotaExceededError') return Promise.resolve();
      return Promise.reject(e);
    }
    return Promise.resolve();
  },
};

export const isElectronRuntime = isElectron;

export default isElectron() ? electronStorage : browserStorage;
