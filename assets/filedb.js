const currentFileDBVersion = 2;
const versionStoreName = '.version';

export class File {
  constructor({path, content}) {
    this.path = path;
    this.content = content;
  }
}

export class FileDB {
  constructor(dbName = "pipeline-db", storeName = "notes") {
    this.db = null;
    this.dbName = dbName;
    if (storeName.startsWith(".")) {
      throw new Error("storeName cannot start with '.', as those are reserved for internal structures");
    }
    this.storeName = storeName;
    this.versionStoreName = versionStoreName;
  }

  async init(versionChange) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, currentFileDBVersion);

      request.onupgradeneeded = async (event) => {
        this.db = event.target.result;
        const old_version = event.oldVersion;
        const new_version = event.newVersion;
        console.log('updating database', this.dbName, 'from', old_version, 'to', new_version);

        switch (old_version) {
          case 0:
            this.db.createObjectStore(this.storeName, { keyPath: 'path' });

          case 1:
            this.db.createObjectStore(this.versionStoreName, { keyPath: 'key' });
        }

        // maybe TODO create index on title and date and other metadata
        // const tx = await db.transaction(this.storeName, 'readwrite');
        // tx.store.createIndex('title', 'title');
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

  // internal utility methods

  promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async bumpVersion(transaction, operationName) {
    const versionStore = transaction.objectStore(versionStoreName);
    let version = await this.promisify(versionStore.get('version'));

    if (!version) {
      version = { key: 'version', value: 0 };
    }

    let prior_version = version.value;
    version.value++;
    console.log('db: bumping version to', version.value, 'as part of', operationName);
    await this.promisify(versionStore.put(version));
    return {prior_version, new_version: version.value};
  }

  async getVersion(transaction) {
    if (transaction === undefined) {
      transaction = this.db.transaction([versionStoreName]);
    }

    const versionStore = transaction.objectStore(versionStoreName);
    let version = await this.promisify(versionStore.get('version'));

    if (!version) {
      version = { key: 'version', value: 0 };
    }

    return version.value;
  }

  // interface used in the cache

  async writeFile(path, content, expected_version) {
    const transaction = this.db.transaction([this.storeName, versionStoreName], "readwrite");
    const objectStore = transaction.objectStore(this.storeName);
    let {new_version, prior_version} = await this.bumpVersion(transaction, 'writeFile');
    await this.promisify(objectStore.put({ path, content }));

    if (expected_version !== undefined && prior_version !== expected_version) {
      return {new_version: new_version, content: null};
    } else {
      return {new_version: new_version, content};
    }
  }

  async readAllFiles() {
    console.time('read all files');
    const transaction = this.db.transaction([this.storeName, versionStoreName]);
    const current_version = await this.getVersion(transaction);
    const objectStore = transaction.objectStore(this.storeName);
    const result = {current_version, result: await this.promisify(objectStore.getAll())};
    console.timeEnd('read all files');
    return result;
  }

  async updateFile(path, updater, expected_version) {
    const transaction = this.db.transaction([this.storeName, versionStoreName], "readwrite");
    const objectStore = transaction.objectStore(this.storeName);
    let {new_version, prior_version} = await this.bumpVersion(transaction, 'updateFile');
    
    const result = await this.promisify(objectStore.get(path));
    
    const read_result = result ? result.content : null;
    const updated_content = updater(read_result);
    
    await this.promisify(objectStore.put({path, content: updated_content}));

    if (expected_version !== undefined && prior_version !== expected_version) {
      return {new_version, content: null};
    } else {
      return {new_version, content: updated_content};
    }
  }

  async putFiles(files, expected_version) {
    const transaction = this.db.transaction([this.storeName, versionStoreName], "readwrite");
    const objectStore = transaction.objectStore(this.storeName);
    let {new_version, prior_version} = await this.bumpVersion(transaction, 'putFiles');
    
    for (let uuid in files) {
      await this.promisify(objectStore.put({path: uuid, content: files[uuid]}));
    }

    if (expected_version !== undefined && prior_version !== expected_version) {
      return {new_version, files: null};
    } else {
      return {new_version, files};
    }
  }

  // direct interface (no versions)

  async readFile(path) {
    console.time('read file ' + path);
    const transaction = this.db.transaction([this.storeName]);
    const objectStore = transaction.objectStore(this.storeName);
    const result = await this.promisify(objectStore.get(path));
    console.timeEnd('read file ' + path);
    return result ? result.content : null;
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
