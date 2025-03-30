import { File, FileDB } from '/filedb.js';
import { cache, getNow } from '/state.js';
import { readBooleanFile } from '/boolean-state.js';
import { parseContent } from '/parse.js';
import { rewrite, Msg } from '/rewrite.js';
import { dateComp, timezoneCompatibility, getCompatibilityCounter, resetCompatibilityCounter } from '/date-util.js';

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
  let repo = await cache.readFile(LOCAL_REPO_NAME_FILE);
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

export class Note {
  uuid;
  content;
  metadata;
  title;
  date;
  rewrite;
  _compat_date;
  _date_obj;

  constructor({uuid, content, title, date, metadata}) {
    this.uuid = uuid;
    this.content = content;
    this.title = title;
    this.date = date;
    this.metadata = metadata;
    this.rewrite = undefined;
    this._compat_date = timezoneCompatibility(date);
    this._date_obj = new Date(this._compat_date);
  }

  compat_date() {
    return this._compat_date;
  }

  date_obj() {
    return this._date_obj;
  }
};

function parseMetadata(file) {
  let metadata = {};
  try {
    const lines = file.content.slice(file.content.indexOf("--- METADATA ---") + 1).split('\n');
    lines.forEach(line => {
      let split_index = line.indexOf(": ");
      if (split_index === -1) {
        return;
      }
      let first = line.slice(0, split_index);
      let rest = line.slice(split_index + 2); // ": ".length
      metadata[first.trim()] = rest;
    });
  } catch (e) {
    console.log("broken metadata", file.path, e);
    metadata = {Title: "broken metadata", Date: `${getNow()}`};
  }
  if (metadata.Title === undefined) {
    metadata.Title = "broken title";
  }
  if (metadata.Date === undefined) {
    metadata.Date = `${getNow()}`;
  }
  return metadata;
}

function constructNoteFromFile(file) {
  console.assert(file instanceof File);
  let metadata = parseMetadata(file);
  return new Note({uuid: file.path, title: metadata.Title, date: metadata.Date, content: file.content, metadata});
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
    this.metadata_map = null;  // a list of Notes
    this._local_repo = null;
    this._messages_cacher = null;
    this.version = null;
    this._cache_current_journal = null;
    this.scheduler = new IncrementalScheduler();
    this.scheduler.start();
  }

  async load_metadata_map() {
    const {current_version, result: files} = await global_notes.readAllFiles();
    this.metadata_map = files.map(file => {
      return constructNoteFromFile(new File(file));
    });
    this.version = current_version;
  }

  async insert_note(objectStore, content, uuid, title, transaction) {
    // notice that this put/write is part of the same transaction as the getVersion and the possible getAll from above.
    // that's how we can ensure that nobody has created the journal between the time we read all of the files and wrote/created this new one.
    await global_notes.promisify(objectStore.put({ path: uuid, content }));
    this.update_current_journal_cached(uuid, title);
    
    // we should update this.metadata_map with the new entry from above.
    const new_version = await global_notes.getVersion(transaction);

    // from load_metadata_map, but we already have `files`
    this.metadata_map.push(constructNoteFromFile(new File({ path: uuid, content })));
    this.version = new_version;
  }

  async refresh_cache() {
    console.log('refreshing cache');
    this._local_repo = await get_local_repo_name();

    await this.load_metadata_map();

    this.booleanFiles = {};
    this.booleanFiles[SHOW_PRIVATE_FILE] = await readBooleanFile(SHOW_PRIVATE_FILE, "false");

    this._messages_cacher = new IncrementalWorker(this.incrementally_gather_sorted_messages());
    this.scheduler.addWorker('sorted_messages', this._messages_cacher);
    console.log('done flat cache');
  }

  // NOTE use this before read operations to ensure coherence
  async ensure_valid_cache() {
    let idb_version = await global_notes.getVersion();
    if (this.version !== idb_version) {
      console.log(`cache: versions ${this.version} != ${idb_version} don't match, refreshing cache`);
      await this.refresh_cache();
    }
  }

  async writeFile(uuid, content) {
    let expected_version = this.version;
    let result = await global_notes.writeFile(uuid, content, expected_version);
    if (result.content === null) {
      console.log('cache: writeFile: expected version was stale, someone else updated before us, revalidate cache');
      await this.ensure_valid_cache();
      return;
    } else {
      console.log('cache: writeFile: expected version was correct, our update was the only change and we received a valid result from updateFile')
      if (this.get_note(uuid) !== null) {
        this.overwrite_note(uuid, content);
      } else {
        // TODO we might be writing to a non-existant file, in which case we should create the file in our cache as well
        await this.ensure_valid_cache();
      }
    }
  }

  async updateFile(uuid, updater) {
    let expected_version = this.version;
    
    let result = await global_notes.updateFile(uuid, updater, expected_version);
    if (result.content === null) {
      console.log('cache: updateFile: expected version was stale, someone else updated before us, revalidate cache');
      await this.ensure_valid_cache();

    } else {
      console.log('cache: updateFile: expected version was correct, our update was the only change and we received a valid result from updateFile', result);
      if (this.get_note(uuid) !== null) {
        this.overwrite_note(uuid, result.content);
        this.version = result.new_version;
      } else {
        // TODO we might be updating a non-existant file, in which case we should create the file in our cache as well
        await this.ensure_valid_cache();
      }
    }
  }

  async putFiles(files) {
    // files is a mapping from uuid to file-content
    let expected_version = this.version;
    let result = await global_notes.putFiles(files, expected_version);
    
    if (result.files === null) {
      console.log('cache: updateFile: expected version was stale, someone else updated before us, revalidate cache');
      await this.ensure_valid_cache();

    } else {
      console.log('cache: updateFile: expected version was correct, our update was the only change and we received a valid result from updateFile');
      for (let uuid in files) {
        if (this.get_note(uuid) !== null) {
          this.overwrite_note(uuid, files[uuid]);
        }
        this.version = result.new_version;
      }
    }
  }

  async readFile(uuid) {
    await this.ensure_valid_cache();
    return this.get_note(uuid).content;
  }
  
  show_private_messages() {
    return this.booleanFiles[SHOW_PRIVATE_FILE];
  }

  get_note(uuid) {
    return this.metadata_map.find(note => note.uuid === uuid) || null;
  }

  overwrite_note(uuid, content) {
    let note = this.get_note(uuid);
    console.assert(note instanceof Note);
    note.content = content;
    delete note.cache;
  }

  rewrite(uuid) {
    let note = this.get_note(uuid);
    if (note === null) {
      console.assert(false, `could not find note ${uuid}`);
      return null;
    }
    note.cache = note.cache || {};
    if (note.cache.rewrite === undefined) {
      let page = parseContent(note.content);
      let rewrite_result = rewrite(page, uuid);
      note.cache.rewrite = deepFreeze(rewrite_result);
    }

    // without deepFreeze, it is dangerous to modify the result of .rewrite(), because it is passed by reference.
    // - this was the source of BUG search duplication, where messages were duplicated, but only for the past 2 days.
    // - the CAUSE was that we mixed the most recent page (adding the previous page into it) on the journal,
    //   but we did that on the passed-by-reference cached result of the page rewrite.
    return note.cache.rewrite;
  }

  has_current_journal_cached() {
    let title = today();
    if (this._cache_current_journal !== null && this._cache_current_journal.title === title) {
      return this._cache_current_journal.uuid;
    }
    return false;
  }

  update_current_journal_cached(uuid, title) {
    this._cache_current_journal = {uuid, title};
  }
 
  // a non-async alternative that fails if the current_journal hasn't been made.
  // returns null for a quick check, EXAMPLE if search needs to check if a message is on the current page to render it green or pink
  maybe_current_journal() {
    let title = today();
    let journal_result = this.has_current_journal_cached();
    if (journal_result !== false) {
      return journal_result;
    }
    console.log('getting current journal', title);
    let repo = this.local_repo_name();
    let notes = this.metadata_map.filter(note => note.uuid.startsWith(repo + "/") && note.title === title).map(note => note.uuid);
    if (notes.length === 0) {
      return null;
      // we always ensure the cache is correct after a write operation, so we don't need to do it here, nor in other non-async contexts.
      // - reasoning: writes and updates can be slow, but the user doesn't expect any read to be slow
    }
    console.assert(notes.length === 1, `expected 1 journal, got ${notes.length}`);
    this.update_current_journal_cached(notes[0], title);
    return notes[0];
  }

  async get_or_create_current_journal() {
    let title = today();
    let journal_result = this.has_current_journal_cached();
    if (journal_result !== false) {
      return journal_result;
    }

    let local_repo = await this.local_repo_name();

    const transaction = global_notes.db.transaction([global_notes.storeName, global_notes.versionStoreName], "readwrite");
    const objectStore = transaction.objectStore(global_notes.storeName);

    let current_version = await global_notes.getVersion(transaction);
    if (current_version !== this.version) {
      // if the version has changed, we need to re-read all of the files to ensure that we have the most up-to-date list of notes.
      let files = await global_notes.promisify(objectStore.getAll());

      // TODO we only need to re-parse the ones that have changed, which maybe we can compute with status somehow.  hmm
      // this is a pretty hefty amount of parsing, which will be slow, but eh.  maybe we can make it faster by storing the metadata in the database rows.
      this.metadata_map = files.map(file => {
        return constructNoteFromFile(new File(file));
      });
      this.version = current_version;
    }
    let notes = this.metadata_map.filter(note => note.uuid.startsWith(local_repo + "/") && note.title === title).map(note => note.uuid);

    if (notes.length == 0) {
      let content = `--- METADATA ---
Date: ${getNow()}
Title: ${title}
Tags: Journal`;
      let uuid = local_repo + '/' + crypto.randomUUID() + '.note';

      await this.insert_note(objectStore, content, uuid, title, transaction);
      return uuid;
    }
    console.assert(notes.length === 1, `expected 1 journal, got ${notes.length}`);
    this.update_current_journal_cached(notes[0], title);
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

  get_messages_around(uuid) {
    let note = this.get_note(uuid);

    if (note === null) {
      console.assert(false, `could not find note ${uuid}`);
      return [];
    }

    // get date of the note
    let origin_date = new Date(note.metadata.Date);
    // get messages that are 24 hours before and after that date from the message list
    // TODO optimization ideas:
    // - we know these are sorted, so we can binary search
    // - there are fewer notes than messages, so maybe we can binary search on the notes first, to give us a good over-approximation that we can refine
    //   - maybe we can store the interval range of the dates that appear in a note

    // TODO get a list of notes, and possible notes that overlap with the 72-hour range in any way
    const can_overlap = (date_str, origin_date) => {
      let date = Date.parse(timezoneCompatibility(date_str));
      // 86400000 is the number of milliseconds in a day
      return (Math.abs(origin_date - date) < 86400000*2);
    }

    let messages = null;
    // if (this._messages_cacher === null || this._messages_cacher.is_done === false) {
      let notes_that_can_overlap = this.metadata_map
        .filter(note => can_overlap(note.date, origin_date));
      
      messages = notes_that_can_overlap.map(note => this.get_messages_in(note.uuid)).flat().sort((a, b) => dateComp(b, a));
    // } else {
    //   console.assert(this._messages_cacher.is_done === true, 'messages cacher should be complete');
    //   messages = this._messages_cacher.current_result;
    // }

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
    return result;
  }

  // message list

  // generator
  *incrementally_gather_sorted_messages() {
    console.log('incrementally gathering messages');

    let sorted_notes = this.metadata_map.sort((a, b) => dateComp(b, a));
    let messages = [];
    for (let note of sorted_notes) {
      // TODO gather messages here and merge them into the full result.
      // messages = this.merge(messages, this.get_messages_in(note.uuid), (a, b) => { return dateComp(a, b) } );
      messages.push(...this.get_messages_in(note.uuid));
      yield;
    }

    messages.sort((a, b) => dateComp(b, a));

    return messages;
  }

  subscribe_to_messages_cacher(user) {
    // TODO maybe each user area should have a subscription ID, and then when you unsubscribe, you can pass that ID.
    // TODO that way we don't need to propagate to the same user twice, and when the same user re-subscribes, it just deletes its prior subscription.
    return this._messages_cacher.observeResult(user);
  }

  get_messages_in(uuid) {
    // each page is usually 2 sections, 'entry' and 'METADATA'
    // a page is a list of sections
    // a section is a list of blocks
    let page = this.rewrite(uuid);  // a list of sections
    const entry_sections = page.filter(s => s.title === 'entry');
    const messages = entry_sections.flatMap(s => s.blocks ? s.blocks.filter(m => m instanceof Msg) : []);
    return messages;
  }
}

class IncrementalScheduler {
  constructor() {
    this.timer = null;
    this.workers = new Map();
    this.worker_queue = [];
    this.quantum_length = 8; // in milliseconds
  }
  
  start() {
    this.timer = setInterval(() => {
      // run one worker per quantum
      if (this.worker_queue.length === 0) {
        this.worker_queue = Array.from(this.workers.values());
      }
      if (this.worker_queue.length === 0) {
        return;
      }
      const worker = this.worker_queue.pop();
      this.quantum(worker);
    }, 2*this.quantum_length);  // give 8ms to other tasks
  }
  
  quantum(worker) {
    // perform work until the quantum is done, default 8ms
    
    if (worker.is_done) {
      return;
    }

    let now = performance.now();  // time in milliseconds with sub-millisecond precision
    while (performance.now() - now < this.quantum_length) {
      worker.step();
    }
    worker.propagate();
  }

  addWorker(name, worker) {
    this.workers.set(name, worker);
  }
}

class IncrementalWorker {
  constructor(generator) {
    this.generator = generator;
    this.users = [];
    this.is_done = false;
    this.current_result = undefined;
    this.needs_propagate = false;
  }

  step() {
    const { value, done } = this.generator.next();
      
    if (value !== undefined) {
      this.current_result = value;
      this.needs_propagate = true;
    }
    this.is_done = done;
    return this.is_done;
  }

  // propagate current result to all users
  propagate() {
    if (this.needs_propagate) {
      this.users.forEach(user => {
        user(this.current_result);
      });
      this.needs_propagate = false;
    }
  }

  observeResult(user) {
    this.users.push(user);

    // if we're done, we should call the user immediately
    // otherwise we can just wait for the next propagate
    if (this.is_done) {
      user(this.current_result);
    }
  }
}

export async function buildFlatCache(refresh) {
  let flatCache = new FlatCache();
  if (refresh) {
    await flatCache.refresh_cache();
  }
  return flatCache;
}
