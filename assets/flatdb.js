import FileDB from '/filedb.js';
import { cache } from '/state.js';
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

  constructor({uuid, content, title, date, metadata}) {
    this.uuid = uuid;
    this.content = content;
    this.title = title;
    this.date = date;
    this.metadata = metadata;
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

export async function newNote(title, date) {
  let content = `--- METADATA ---
Date: ${date}
Title: ${title}`;
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  let uuid = (await get_local_repo_name()) + '/' + crypto.randomUUID() + '.note';
  await global.notes.writeFile(uuid, content);
  return uuid;
}

export async function newJournal(title, date) {
  let content = `--- METADATA ---
Date: ${date}
Title: ${title}
Tags: Journal`;
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  let uuid = (await get_local_repo_name()) + '/' + crypto.randomUUID() + '.note';
  await global.notes.writeFile(uuid, content);
  return uuid;
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

// === Efficient cache for a single read/ scan of the whole database. ===
// make sure to make a new one and plumb it through properly in each request.
// - it will probably be difficult to stash one of these globally and interrupt its usage when page transitions happen.
// - we'll probably have to handle that with a state machine that interrupts renders and clears the cache if it has been invalidated.
// N.B. it is _not_ correct to stash this and only modify the elements that are modified from write operations and syncs, because other pages may have modified this.
// - we'll have to make a cache within indexedDB that is invalidated when the database in a cooperative way _between tabs_ for that to work.
// - that might also have pernicious bugs.
// N.B. make sure to not capture this in a handler or a lambda that is preserved, because that's basically stashing it.
class FlatRead { // a single "read" operation for the flat note database.
  async build() {
    this.metadata_map = await getNoteMetadataMap('FlatRead');
    this._local_repo = await get_local_repo_name();
    return this;
  }

  getNotesWithTitle(title, repo) {
    if (repo === undefined) {
      return this.metadata_map.filter(note => note.title === title);
    }
    return this.metadata_map.filter(note => note.uuid.startsWith(repo + "/") && note.title === title).map(note => note.uuid);
  }

  getAllNotesWithSameTitleAs(uuid) {
    let title = this.metadata_map.find(note => note.uuid == uuid).title;
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
}

async function buildFlatRead() {
  console.log('building flat read');
  let flatRead = new FlatRead()
  await flatRead.build();
  return flatRead;
}

class FlatCache {
  constructor() {
    this.flatRead = null;
  }

  async build() {
    console.log('building flat cache');
    this.flatRead = await buildFlatRead();
    this.booleanFiles = {};
    this.booleanFiles[SHOW_PRIVATE_FILE] = await readBooleanFile(SHOW_PRIVATE_FILE, "false");;
  }

  async rebuild() {
    this.flatRead = await buildFlatRead();
    this.booleanFiles[SHOW_PRIVATE_FILE] = await readBooleanFile(SHOW_PRIVATE_FILE, "false");;
  }
  
  show_private_messages() {
    return this.booleanFiles[SHOW_PRIVATE_FILE];
  }

  getNotesWithTitle(title, repo) {
    return this.flatRead.getNotesWithTitle(title, repo);
  }

  getAllNotesWithSameTitleAs(uuid) {
    return this.flatRead.getAllNotesWithSameTitleAs(uuid);
  }

  get_note(uuid) {
    return this.flatRead.get_note(uuid);
  }

  rewrite(uuid) {
    return this.flatRead.rewrite(uuid);
  }

  local_repo_name() {
    return this.flatRead.local_repo_name();
  }

  async readFile(uuid) {
    // TODO check for cache invalidation with most recent update
    return this.flatRead.get_note(uuid).content;
  }

  async writeFile(uuid, content) {
    // TODO check for cache invalidation with most recent update
    // could make this not async, but i'd either have to busy-wait while it's writing or i'd have to return a promise
    await global_notes.writeFile(uuid, content);
    if (this.flatRead.get_note(uuid) !== null) {
      this.flatRead.get_note(uuid).content = content;
    } else {
      await this.rebuild();
    }
  }

  async updateFile(uuid, updater) {
    // TODO check for cache invalidation with most recent update
    let note = this.flatRead.get_note(uuid);
    let updated_content = updater(note.content);
    note.content = updated_content;
    await global_notes.updateFile(uuid, updater);
    await this.rebuild();
    return updated_content;
  }

  async listFiles() {
    return this.flatRead.metadata_map.map(note => note.uuid);
  }
}

export async function buildFlatCache() {
  let flatCache = new FlatCache();
  await flatCache.build();
  return flatCache;
}
