export default class FileDB {
  constructor(dbName = "pipeline-db", storeName = "notes") {
    this.db = null;
    this.dbName = dbName;
    this.storeName = storeName;
  }

  async init(versionChange) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = async (event) => {
        this.db = event.target.result;
        const old_version = event.oldVersion;
        const new_version = event.newVersion;
        console.log('updating database', this.dbName, 'from', old_version, 'to', new_version);

        switch (old_version) {
          case 0:
            // Create first object store:
            this.db.createObjectStore(this.storeName, { keyPath: 'path' });

          case 1:
            // Get the original object store, and create an index on it:
            // const tx = await db.transaction(this.storeName, 'readwrite');
            // tx.store.createIndex('title', 'title');
        }

        // maybe TODO create index on title and date and other metadata
      };

      request.onsuccess = event => {
        this.db = event.target.result;
        this.db.onversionchange = () => {
          this.db.close();
          if (versionChange !== undefined) {
            versionChange();
          } else {
            alert("Database is outdated, please reload the page.");
          }
        };
        resolve();
      };

      request.onerror = event => {
        console.error("Database error:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async writeFile(path, content) {
    const transaction = this.db.transaction([this.storeName], "readwrite");
    const objectStore = transaction.objectStore(this.storeName);
    return this.promisify(objectStore.put({ path, content }));
  }

  async readFile(path) {
    console.time('read file ' + path);
    const transaction = this.db.transaction([this.storeName]);
    const objectStore = transaction.objectStore(this.storeName);
    const result = await this.promisify(objectStore.get(path));
    console.timeEnd('read file ' + path);
    return result ? result.content : null;
  }

  async updateFile(path, updater) {
    const transaction = this.db.transaction([this.storeName], "readwrite");
    const objectStore = transaction.objectStore(this.storeName);
    
    const getRequest = objectStore.get(path);
    const result = await this.promisify(getRequest);
    
    const read_result = result ? result.content : null;
    const updated_content = updater(read_result);
    
    return this.promisify(objectStore.put({path, content: updated_content}));
  }

  async exists(path) {
    const transaction = this.db.transaction([this.storeName]);
    const objectStore = transaction.objectStore(this.storeName);
    const result = await this.promisify(objectStore.get(path));
    return !!result;
  }

  async listFiles() {
    const transaction = this.db.transaction([this.storeName]);
    const objectStore = transaction.objectStore(this.storeName);
    return this.promisify(objectStore.getAllKeys());
  }

  async readAllFiles() {
    const transaction = this.db.transaction([this.storeName]);
    const objectStore = transaction.objectStore(this.storeName);
    return this.promisify(objectStore.getAll());
  }

  async deleteFile(path) {
    const transaction = this.db.transaction([this.storeName], "readwrite");
    const objectStore = transaction.objectStore(this.storeName);
    return this.promisify(objectStore.delete(path));
  }

  async renameFile(priorPath, newPath) {
    const transaction = this.db.transaction([this.storeName], "readwrite");
    const objectStore = transaction.objectStore(this.storeName);
    
    const getRequest = objectStore.get(priorPath);
    const result = await this.promisify(getRequest);
    
    if (!result) {
      throw new Error(`No content in ${priorPath}`);
    }
    
    await this.promisify(objectStore.put({path: newPath, content: result.content}));
    return this.promisify(objectStore.delete(priorPath));
  }
}
