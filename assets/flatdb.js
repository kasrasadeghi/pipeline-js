import FileDB from '/filedb.js';
import { cache, getNow } from '/state.js';
import { readBooleanFile } from '/boolean-state.js';
import { parseContent } from '/parse.js';
import { rewrite, Msg } from '/rewrite.js';
import { dateComp } from '/date-util.js';

export const SHOW_PRIVATE_FILE = 'private mode state';

// private global
let global_notes = null;

export function debugGlobalNotes() {
  return global_notes;
}

export async function initFlatDB(reload) {
  global_notes = new FileDB();
  await global_notes.init(reload);
}

export const LOCAL_REPO_NAME_FILE = "local_repo_name";
async function get_local_repo_name() {
  let repo = await cache.readFile(LOCAL_REPO_NAME_FILE)
  if (repo === null || repo.trim() === '') {
    await gotoSetup();
    throw new Error('no local repo defined, redirecting to setup');
  }
  return cache.readFile(LOCAL_REPO_NAME_FILE);
}

function today() {
  const today = getNow();
  return dateToJournalTitle(today);
}

export function dateToJournalTitle(date) {
  const year = date.getFullYear();

  const month = date.toLocaleString('en-us', { month: "long" });
  const day = date.getDate();

  const day_suffix =
      [11, 12, 13].includes(day) ? 'th'
    : day % 10 === 1 ? 'st'
    : day % 10 === 2 ? 'nd'
    : day % 10 === 3 ? 'rd'
    : 'th';

  return `${month} ${day}${day_suffix}, ${year}`;
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
  const readAllResult = await global_notes.readAllFiles();
  let current_version = readAllResult.current_version;
  let blobs = readAllResult.result;
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
  return {current_version, result};
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze
// ORIGINAL NOTES from mozilla:
// To make an object immutable, recursively freeze each non-primitive property (deep freeze).
// Use the pattern on a case-by-case basis based on your design when you know the object contains no cycles in the reference graph, 
// otherwise an endless loop will be triggered.
// For example, functions created with the function syntax have a prototype property 
// with a constructor property that points to the function itself, so they have cycles by default.
// Other functions, such as arrow functions, can still be frozen.
//
// An enhancement to deepFreeze() would be to store the objects it has already visited, 
// so you can suppress calling deepFreeze() recursively when an object is in the process of being made immutable.
// For one example, see using WeakSet to detect circular references.
// You still run a risk of freezing an object that shouldn't be frozen, such as window.
// 
// KAZ NOTES
// we're using this to freeze cached values, so that they are not modified when used.
// to modify an element, we'll need to run structuredClone on it, and then modify the clone.
function deepFreeze(object) {
  // Retrieve the property names defined on object
  const propNames = Reflect.ownKeys(object);

  // Freeze properties before freezing self
  for (const name of propNames) {
    const value = object[name];

    if ((value && typeof value === "object") || typeof value === "function") {
      deepFreeze(value);
    }
  }

  return Object.freeze(object);
}

// === Efficient cache that preserves a read/scan of the whole database ===
// - we'll probably have to handle page transitions with a state machine that interrupts renders and clears the cache if it has been invalidated.
// N.B. it is _not_ correct to stash this and only modify the elements that are modified from write operations and syncs, because other pages may have modified this.
// - we'll have to make a cache within indexedDB that is invalidated when the database in a cooperative way _between tabs_ for that to work.
// - that might also have pernicious bugs.

// DESIGN DECISIONS
// - any operation that modifies the cache must check that the version before the modification is the same as the indexedDB version,
//   otherwise they must refresh the cache.
//   - this is because write and update operations are performed in an async context, but the cache is often used in a non-async context, 
//     making it very un-ergonomic to refresh the cache and check that it's valid on every read.

class FlatCache {
  constructor() {
    this.metadata_map = null;
    this._local_repo = null;
    this.version = null;
  }

  async refresh_cache() {
    console.log('building flat cache');
    this._local_repo = await get_local_repo_name();

    let metadataMapResult = await getNoteMetadataMap('FlatRead');
    this.metadata_map = metadataMapResult.result;
    this.version = metadataMapResult.current_version;

    this.booleanFiles = {};
    this.booleanFiles[SHOW_PRIVATE_FILE] = await readBooleanFile(SHOW_PRIVATE_FILE, "false");
  }

  // NOTE use this before read operations to ensure coherence
  async ensure_valid_cache() {
    if (this.version !== (await global_notes.getVersion())) {
      await this.refresh_cache();
    }
  }

  async writeFile(uuid, content) {
    let expected_version = this.version;
    let result = await global_notes.writeFile(uuid, content, expected_version);
    if (result.content === null) {
      // expected version was stale, someone else updated before us, revalidate cache
      await this.ensure_valid_cache();
      return;
    }
    if (result.new_version === expected_version + 1) {
      // our update was the only change
      await global_notes.writeFile(uuid, content);
      if (this.get_note(uuid) !== null) {
        this.get_note(uuid).content = content;
      }
    } else {
      // someone else updated before us, revalidate cache
      await this.ensure_valid_cache();
    }
    // TODO how is there two failure modes?
  }

  async updateFile(uuid, updater) {
    let expected_version = this.version;
    let result = await global_notes.updateFile(uuid, updater, expected_version);
    if (result.content === null) {
      // expected version was stale, someone else updated before us, someone else updated before us, revalidate cache
      await this.ensure_valid_cache();
      return;
    }
    if (result.new_version === expected_version + 1) {
      // our update was the only change
      await global_notes.writeFile(uuid, content);
      if (this.get_note(uuid) !== null) {
        this.get_note(uuid).content = content;
      }
    } else {
      // someone else updated before us, revalidate cache
      await this.ensure_valid_cache();
    }
    // TODO how is there two failure modes?
  }

  async readFile(uuid) {
    await this.ensure_valid_cache();
    return this.get_note(uuid).content;
  }
  
  show_private_messages() {
    return this.booleanFiles[SHOW_PRIVATE_FILE];
  }

  async getNotesWithTitle(title, repo) {
    await this.ensure_valid_cache();
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
      let rewrite_result = rewrite(page, uuid);
      note.rewrite = deepFreeze(rewrite_result);
    }

    // without deepFreeze, it is dangerous to modify the result of .rewrite(), because it is passed by reference.
    // - this was the source of BUG search duplication, where messages were duplicated, but only for the past 2 days.
    // - the CAUSE was that we mixed the most recent page (adding the previous page into it) on the journal,
    //   but we did that on the passed-by-reference cached result of the page rewrite.
    return note.rewrite;
  }

  // a non-async alternative that fails if the current_journal hasn't been made.
  // returns null for a quick check, EXAMPLE if search needs to check if a message is on the current page to render it green or pink
  maybe_current_journal() {
    let title = today();
    let repo = this.local_repo_name();
    let notes = this.metadata_map.filter(note => note.uuid.startsWith(repo + "/") && note.title === title).map(note => note.uuid);
    if (notes.length === 0) {
      return null;
      // let uuid = await global.notes.newJournal(today(), getNow());
      // notes = [uuid];
      // // TODO maybe we only want to do a full update of the cache on sync, hmm.  nah, it seems like it should be on every database operation, for _consistency_'s (ACID) sake.
    }
    return notes[0];
  }

  local_repo_name() {
    return this._local_repo;
  }

  async listFiles() {
    await this.ensure_valid_cache();
    return this.metadata_map.map(note => note.uuid);
  }

  async newNote(title, date) {
    let content = `--- METADATA ---
Date: ${date}
Title: ${title}`;
    // https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
    let uuid = (await this.local_repo_name()) + '/' + crypto.randomUUID() + '.note';
    await this.writeFile(uuid, content);
    await this.ensure_valid_cache();
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
    await this.ensure_valid_cache();
    return uuid;
  }

  get_messages_around(uuid) {
    let note = this.get_note(uuid);

    // get date of the note
    let origin_date = new Date(note.metadata.Date);
    // get messages that are 24 hours before and after that date from the message list
    // TODO optimization ideas:
    // - we know these are sorted, so we can binary search
    // - there are fewer notes than messages, so maybe we can binary search on the notes first, to give us a good over-approximation that we can refine
    //   - maybe we can store the interval range of the dates that appear in a note
    let messages = this.get_message_list(); // a list of Msg
    console.log(messages.length);
    
    // for now, we'll just do a linear search
    let msg_24h_before_idx = null;
    let msg_24h_after_idx = null;
    for (let i = 0; i < messages.length; i++) {
      // if we don't have a before, and the message is less than 24 hours before the origin date
      // set it to before
      // 86400000 is the number of milliseconds in a day
      if (msg_24h_before_idx === null && (new Date(messages[i].date) < origin_date - 86400000)) {
        msg_24h_before_idx = i;
      } else if (msg_24h_after_idx === null && (new Date(messages[i].date) > origin_date + 2*86400000)) {
        msg_24h_after_idx = i;
        break;
      }
    }

    if (msg_24h_before_idx === null) {
      msg_24h_before_idx = messages.length;
    }
    if (msg_24h_after_idx === null) {
      msg_24h_after_idx = 0;
    }

    let valid = msg_24h_before_idx !== null && msg_24h_after_idx !== null;
    if (!valid) {
      console.assert(false, `could not find messages 24 hours before and after origin date ${origin_date}: ${msg_24h_before_idx} ${msg_24h_after_idx}`);
    }

    // the results are sorted most recent first, so we need to reverse the slice
    let result = messages.slice(msg_24h_after_idx, msg_24h_before_idx);
    console.log('all_messages', messages);
    console.log('messages around result', result);
    console.log(msg_24h_before_idx, msg_24h_after_idx);
    console.log('origin_date of note', origin_date, uuid);
    return result;
  }

  // message list

  // 570ms, then 30ms once cached
  gather_messages() {
    // TODO only rewrite the pages that have changed since the last time we gathered messages

    console.log('gathering messages');
    // rewriting all of the pages takes 500ms ish
    const pages = this.metadata_map.map(x => this.rewrite(x.uuid));

    // each page is usually 2 sections, 'entry' and 'METADATA'
    // a page is a list of sections
    // a section is a list of blocks
    const entry_sections = pages.flatMap(p => p.filter(s => s.title === 'entry'));
    const messages = entry_sections.flatMap(s => s.blocks ? s.blocks.filter(m => m instanceof Msg) : []);
    
    // detectDuplicates(messages);

    return messages;
  }

  gather_sorted_messages() {
    // sorting takes 300ms
    // TODO sort by bins?  we should find the notes that are journals and have clear dilineations, and "optimize" the notes.
    // - we should probably do that after we show previous and next days on the same journal, so if the notes gets optimized, it's still legible to the user.
    console.log('sorting gathered messages');
    let messages = this.gather_messages().sort((a, b) => dateComp(b, a));
    // detectDuplicates(messages);
    return messages;
  }

  get_message_list() {
    return this.gather_sorted_messages();
  }
}

export async function buildFlatCache() {
  let flatCache = new FlatCache();
  await flatCache.refresh_cache();
  return flatCache;
}
