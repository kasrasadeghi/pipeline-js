import FileDB from '/filedb.js';
import { cache, getNow } from '/state.js';
import { readBooleanFile } from '/boolean-state.js';
import { parseContent } from '/parse.js';
import { rewrite } from '/rewrite.js';

export const SHOW_PRIVATE_FILE = 'private mode state';

// private global
let global_notes = null;

export async function initFlatDB(reload) {
  global_notes = new FileDB();
  await global_notes.init(reload);
}

const LOCAL_REPO_NAME_FILE = "local_repo_name";
async function get_local_repo_name() {
  let repo = await cache.readFile(LOCAL_REPO_NAME_FILE)
  if (repo === null || repo.trim() === '') {
    await gotoSetup();
    throw new Error('no local repo defined, redirecting to setup');
  }
  return cache.readFile(LOCAL_REPO_NAME_FILE);
}

class Note {
  uuid;
  content;
  metadata;
  title;
  date;
  rewrite;

  constructor({uuid, content, title, date, metadata}) {
    this.uuid = uuid;
    this.content = content;
    this.title = title;
    this.date = date;
    this.metadata = metadata;
    this.rewrite = undefined;
  }
};

function parseMetadata(note_content) {
  const lines = note_content.slice(note_content.indexOf("--- METADATA ---") + 1).split('\n');
  let metadata = {};
  lines.forEach(line => {
    let split_index = line.indexOf(": ");
    if (split_index === -1) {
      return;
    }
    let first = line.slice(0, split_index);
    let rest = line.slice(split_index + 2); // ": ".length
    metadata[first.trim()] = rest;
  });
  return metadata;
}

async function getNoteMetadataMap(caller) {
  if (caller === undefined) {
    console.log('raw note metadata used');
    throw new Error('raw note metadata used');
  } else {
    console.log('getNoteMetadataMap from', caller);
  }
  console.time('read files');
  const blobs = await global_notes.readAllFiles();
  console.timeEnd('read files');
  console.time('parse metadata');
  let result = blobs.map(blob => {
    let metadata = null;
    try {
      metadata = parseMetadata(blob.content);
    } catch (e) {
      console.log('broken metadata', blob.path, e);
      metadata = {Title: "broken metadata", Date: `${getNow()}`};
    }
    if (metadata.Title === undefined) {
      metadata.Title = "broken title";
    }
    if (metadata.Date === undefined) {
      metadata.Date = `${getNow()}`;
    }
    return new Note({uuid: blob.path, title: metadata.Title, date: metadata.Date, content: blob.content, metadata});
  });
  console.timeEnd('parse metadata');
  return result;
}

// === Efficient cache that preserves a read/scan of the whole database ===
// - we'll probably have to handle page transitions with a state machine that interrupts renders and clears the cache if it has been invalidated.
// N.B. it is _not_ correct to stash this and only modify the elements that are modified from write operations and syncs, because other pages may have modified this.
// - we'll have to make a cache within indexedDB that is invalidated when the database in a cooperative way _between tabs_ for that to work.
// - that might also have pernicious bugs.

class FlatCache {
  constructor() {
    this.metadata_map = null;
    this._local_repo = null;
  }

  async rebuild() {
    console.log('building flat cache');
    this.metadata_map = await getNoteMetadataMap('FlatRead');
    this._local_repo = await get_local_repo_name();

    this.booleanFiles = {};
    this.booleanFiles[SHOW_PRIVATE_FILE] = await readBooleanFile(SHOW_PRIVATE_FILE, "false");;
  }
  
  show_private_messages() {
    return this.booleanFiles[SHOW_PRIVATE_FILE];
  }

  getNotesWithTitle(title, repo) {
    if (repo === undefined) {
      return this.metadata_map.filter(note => note.title === title);
    }
    return this.metadata_map.filter(note => note.uuid.startsWith(repo + "/") && note.title === title).map(note => note.uuid);
  }

  getAllNotesWithSameTitleAs(uuid) {
    let title = this.get_note(uuid).title;
    return this.metadata_map.filter(note => note.title === title);
  }

  get_note(uuid) {
    return this.metadata_map.find(note => note.uuid === uuid) || null;
  }

  rewrite(uuid) {
    let note = this.get_note(uuid);
    if (note.rewrite === undefined) {
      let page = parseContent(note.content);
      note.rewrite = rewrite(page, uuid);
    }
    return note.rewrite;
  }

  local_repo_name() {
    return this._local_repo;
  }

  async readFile(uuid) {
    // TODO check for cache invalidation with most recent update
    return this.get_note(uuid).content;
  }

  async writeFile(uuid, content) {
    // TODO check for cache invalidation with most recent update
    // could make this not async, but i'd either have to busy-wait while it's writing or i'd have to return a promise
    await global_notes.writeFile(uuid, content);
    if (this.get_note(uuid) !== null) {
      this.get_note(uuid).content = content;
    } else {
      await this.rebuild();
    }
  }

  async updateFile(uuid, updater) {
    // TODO check for cache invalidation with most recent update
    let note = this.get_note(uuid);
    let updated_content = updater(note.content);
    note.content = updated_content;
    await global_notes.updateFile(uuid, updater);
    await this.rebuild();
    return updated_content;
  }

  async listFiles() {
    return this.metadata_map.map(note => note.uuid);
  }

  async newNote(title, date) {
    let content = `--- METADATA ---
Date: ${date}
Title: ${title}`;
    // https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
    let uuid = (await this.local_repo_name()) + '/' + crypto.randomUUID() + '.note';
    await this.writeFile(uuid, content);
    return uuid;
  }

  async newJournal(title, date) {
    let content = `--- METADATA ---
Date: ${date}
Title: ${title}
Tags: Journal`;
    // https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
    let uuid = (await this.local_repo_name()) + '/' + crypto.randomUUID() + '.note';
    await this.writeFile(uuid, content);
    return uuid;
  }
}

export async function buildFlatCache() {
  let flatCache = new FlatCache();
  await flatCache.rebuild();
  return flatCache;
}
