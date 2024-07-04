// INDEXED DB WRAPPER

class FileDB {
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

  async writeFile(path, content) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readwrite");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.put({ path, content });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async readFile(path) {
    console.time('read file ' + path);
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName]);
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(path);

      request.onsuccess = () => {
        console.timeEnd('read file ' + path);
        resolve(request.result ? request.result.content : null);
      }
      request.onerror = () => reject(request.error);
    });
  }

  async updateFile(path, updater) { // update a file within a transaction
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readwrite");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(path);

      request.onsuccess = () => {
        const read_result = request.result ? request.result.content : null;
        const updated_content = updater(read_result);
        const putRequest = objectStore.put({path, content: updated_content});

        putRequest.onsuccess = () => resolve(updated_content);
        putRequest.onerror = () => reject(putRequest.error);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async exists(path) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName]);
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(path);

      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async listFiles() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName]);
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async readAllFiles() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName]);
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteFile(path) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readwrite");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.delete(path);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async renameFile(priorPath, newPath) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readwrite");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(priorPath);

      request.onsuccess = () => {
        if (! request.result) {
          reject(`no content in ${priorPath}`);
        }
        const writeReq = objectStore.put({path: newPath, content: request.result.content});
        writeReq.onsuccess = () => {
          const deleteReq = objectStore.delete(priorPath);
          deleteReq.onsuccess = () => resolve();
          deleteReq.onerror = () => reject(deleteReq.error);
        };
        writeReq.onerror = () => reject(writeReq.error);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// JAVASCRIPT UTIL

// add .back() to arrays
if (!Array.prototype.back) {
  Array.prototype.back = function() {
    return this[this.length - 1];
  }
}

// GLOBALS

const global_notes = new FileDB();

global = null;  // the only global variable.
const LOCAL_REPO_NAME_FILE = "local_repo_name";
const SUBBED_REPOS_FILE = "subbed_repos";

// GENERAL UTIL

function paintSimple(render_result) {
  document.title = "Pipeline Notes";
  let main = document.getElementsByTagName('main')[0];
  let footer = document.getElementsByTagName('footer')[0];
  [main.innerHTML, footer.innerHTML] = render_result;
  return {main, footer};
}

async function get_local_repo_name() {
  let repo = await cache.readFile(LOCAL_REPO_NAME_FILE)
  if (repo === null || repo.trim() === '') {
    await gotoSetup();
    throw new Error('no local repo defined, redirecting to setup');
  }
  return cache.readFile(LOCAL_REPO_NAME_FILE);
}

// DATE UTIL

function getNow() {
  if (global.mock_now !== undefined) {
    return new Date(global.mock_now);
  }
  return new Date();
}

const COMPATIBILITY_TIMEZONES = {
  'PST': 'GMT-0800 (Pacific Standard Time)',
  'PDT': 'GMT-0700 (Pacific Daylight Time)',
  'EST': 'GMT-0500 (Eastern Standard Time)',
  'EDT': 'GMT-0400 (Eastern Daylight Time)',
  'CST': 'GMT-0600 (Central Standard Time)',
  'CDT': 'GMT-0500 (Central Daylight Time)',
  'MST': 'GMT-0700 (Mountain Standard Time)',
  'MDT': 'GMT-0600 (Mountain Daylight Time)',
  'HST': 'GMT-1000 (Hawaiian Standard Time)',
  // european timezones
  'CET': 'GMT+0100 (Central European Time)',
  'CEST': 'GMT+0200 (Central European Summer Time)',
  // japan
  'JST': 'GMT+0900 (Japan Standard Time)',
  'JDT': 'GMT+1000 (Japan Daylight Time)',
};

function timezoneCompatibility(datestring) {
  // old dates look like: Wed Jan 17 22:02:44 PST 2024
  // new dates look like: Thu Jan 17 2024 22:02:44 GMT-0800 (Pacific Standard Time)
  // NB: they end in ')'
  if (datestring.endsWith(")")) {
    return datestring; // no compatibility needed
  }
  let chunks = datestring.split(" ").filter(x => x !== '');
  if (chunks.length !== 6) {
    console.warn("datestring should have 6 chunks: weekday, month, monthday, time, timezone, year", chunks, datestring);
    return datestring;
  }
  let time = chunks[3];
  let timezone = chunks[4];
  console.assert(timezone in COMPATIBILITY_TIMEZONES, timezone, "timezone should be in compatibility_timezones, from", datestring, COMPATIBILITY_TIMEZONES);
  let year = chunks[5];
  let new_chunks = chunks.slice(0, 3);  // first three are the same.
  new_chunks.push(year, time, COMPATIBILITY_TIMEZONES[timezone]);
  return new_chunks.join(" ");
}

function dateComp(a, b) {
  if (a instanceof Msg || Object.hasOwn(a, 'date')) {
    a = a.date;
  }
  if (b instanceof Msg || Object.hasOwn(b, 'date')) {
    b = b.date;
  }
  return new Date(timezoneCompatibility(a)) - new Date(timezoneCompatibility(b));
}

// FLAT NOTE UTIL

async function newNote(title) {
  let content = `--- METADATA ---
Date: ${getNow()}
Title: ${title}`;
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  let uuid = (await get_local_repo_name()) + '/' + crypto.randomUUID() + '.note';
  await global.notes.writeFile(uuid, content);
  return uuid;
}

async function newJournal(title) {
  let content = `--- METADATA ---
Date: ${getNow()}
Title: ${title}
Tags: Journal`;
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  let uuid = (await get_local_repo_name()) + '/' + crypto.randomUUID() + '.note';
  await global.notes.writeFile(uuid, content);
  return uuid;
}

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

async function getMetadata(uuid) {
  const note = await global_notes.readFile(uuid);
  try {
    return parseMetadata(note);
  } catch (e) {
    console.log('could not find metadata in', uuid, e);
    throw Error("could not find metadata");
  }
}

// JOURNAL

function dateToJournalTitle(date) {
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

function today() {
  const today = getNow();
  return dateToJournalTitle(today);
}

// FLAT DATABASE WRAPPER

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

async function getNotesWithTitle(title, repo) {
  const files_with_names = await getNoteMetadataMap('note with title, probably from gotoJournal');
  return files_with_names.filter(note => note.uuid.startsWith(repo + "/") && note.title === title).map(note => note.uuid);
}

async function getAllNotesWithSameTitleAs(uuid) {
  const files_with_names = await getNoteMetadataMap('raw all notes with same title as uuid');
  let title = files_with_names.find(note => note.uuid == uuid).title;
  return files_with_names.filter(note => note.title === title);
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
  }

  async rebuild() {
    this.flatRead = await buildFlatRead();
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

async function buildFlatCache() {
  let flatCache = new FlatCache();
  await flatCache.build();
  return flatCache;
}

// PARSE

async function parseFile(filepath) {
  let content = await global.notes.readFile(filepath);
  if (content === null) {
    return null;
  }
  return parseContent(content);
}

function parseContent(content) {
  console.assert(typeof content === 'string', 'content should be a string', content);
  // EXPL: a page is a list of sections, which each have a title and a list of blocks
  // - a block is a list of nodes
  // - a node can be either a line of type 'str', or a parsed tree
  let sections = [{title: 'entry', lines: []}];
  for (let L of content.split("\n")) {
    if (L.startsWith("--- ") && L.endsWith(" ---") && L.length > 9) {
      sections.push({title: L.slice(4, -4), lines: []});
    } else if (L === '---') {
      sections.push({title: 'entry', lines: []});
    } else {
      // console.log('append ', L, 'to section', sections);
      sections.slice(-1)[0].lines.push(L);
    }
  }

  for (let S of sections) {
    if (! ['METADATA', 'HTML'].includes(S.title)) {
      S.blocks = parseSection(S.lines);
    }
  }
  return sections;
}

function parseSection(lines) {
  let blocks = [];
  for (let L of lines) {
    if (L === '') {
      blocks.push(new EmptyLine())
    } else {
      // TODO what?  if there are no blocks or if the last block is a newline, add another one?
      if (blocks.length === 0 || blocks.slice(-1)[0] instanceof EmptyLine) {
        blocks.push([]);
      }
      blocks.slice(-1)[0].push(L)
    }
  }
  // console.log('block pre tree', blocks);
  // return blocks;
  return blocks.map(parseTree);
}

class TreeNode {
  constructor(obj) {
    this.children = [];
    this.indent = obj.indent;
    this.value = obj.value;
  }

  toString(nested = false) {
    let indent = this.indent == -1 ? "" : "  ".repeat(this.indent) + "- ";
    let result = indent + htmlLine(this.value) + "\n" + this.children.map(x => x.toString(true)).join("");
    if (! nested && result.endsWith("\n")) {
      result = result.slice(0, -1);
    }
    return result;
  }
}

function parseTree(block) {
  if (block instanceof EmptyLine) {
    return block;
  }
  let indent_lines = []
  for (let L of block) {
    if (L.startsWith("- ")) {
      indent_lines.push([0, L.slice("- ".length)])
    } else if (L.startsWith(" ")) {
      let trimmed = L.trimStart();
      let indent = L.length - trimmed.length;
      if (indent % 2 !== 0) { return block; } // in case of failure, return block
      if (! trimmed.startsWith("- ")) { return block; }
      indent_lines.push([indent / 2, trimmed.slice(2)]); // remove "- "
    } else {
      indent_lines.push([-1, L])
    }
  }

  // console.log('indent_lines', indent_lines);

  let roots = [];
  let stack = [];
  let found_children = false;

  for (let [indent, L] of indent_lines) {
    while (stack.length !== 0 && stack.slice(-1)[0].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      if ([-1, 0].includes(indent)) {
        let node = new TreeNode({indent, value: L});
        stack.push(node);
        roots.push(node);
        continue;
      } else {
        return block; // failure, block must start with root
      }
    }

    // stack must have elements in it, so the current line must be the stack's child
    found_children = true;

    let node = new TreeNode({indent, value: L});
    if (stack.slice(-1)[0].indent + 1 !== indent) {
      return block; // failure, children must be one indent deeper than their parent
    }
    stack.slice(-1)[0].children.push(node);
    stack.push(node); // node is the new top of the stack, also added to prior top of stack
  }

  if (! found_children) {
    return block; // found no children, so there was no tree to parse
  }

  return roots;
}

//#endregion PARSE

//#region REWRITE

// page -> *section
// section -> {title: METADATA, lines: *str} | {title,blocks: *block} | {title,roots: *root}
// root -> {root: 'pre_roots'|'nonfinal'|'final', children: block*}
// block -> message | newline | *node | *line
// newline -> []
// message -> {msg: *line_content,date,content: str}
// node -> {value,indent,children:*node,line: *line_content}
// line -> {line: *line_content}
// line_content -> str | tag | cmd | link
// link -> note | root-link | internal-link | simple-link

function pageIsJournal(page) {
  return page
    .find(s => s.title === 'METADATA').lines
    .find(l => l.startsWith("Tags: "))?.slice("Tags: ".length)
    .split(",").map(x => x.trim()).includes("Journal") !== undefined;
}

function rewrite(page, note) {
  return page.map(x => rewriteSection(x, note));
}

function rewriteSection(section, note) {
  if (['METADATA', 'HTML'].includes(section.title)) {
    return section;
  }

  let new_blocks = [];
  for (let block of section.blocks) {
    if (block.length === 0) continue;
    new_blocks.push(rewriteBlock(block, note));
  }

  // track trailing newlines to aid unparsing
  section.trailing_newline = 0;
  while (new_blocks.slice(-1)[0] instanceof EmptyLine) {
    new_blocks.pop();
    section.trailing_newline += 1;
  }

  let old_blocks = new_blocks;
  new_blocks = [];
  
  for (let i = 0; i < old_blocks.length;) {
    const is_msg = (b) => b instanceof Msg;

    if (old_blocks[i] instanceof Msg) {
      new_blocks.push(old_blocks[i]);
      i++; 

      // gather blocks
      while (i < old_blocks.length && !is_msg(old_blocks[i])) {
        new_blocks.back().blocks.push(old_blocks[i]);
        i++;
      }

      // gobble trailing newlines
      new_blocks.back().gobbled_newline = 0;
      while(new_blocks.back().blocks.back() instanceof EmptyLine) {
        new_blocks.back().blocks.pop();
        new_blocks.back().gobbled_newline += 1;
      }

      if (new_blocks.back().blocks.length !== 0) {
        // remove one prefix EmptyLine when we have blocks
        if (new_blocks.back().blocks[0] instanceof EmptyLine) {
          new_blocks.back().blocks.splice(0, 1); // remove a single element at index 0
          new_blocks.back().block_prefix_newline = 1;
        }
      }
    } else {
      new_blocks.push(old_blocks[i]);
      i++;
    }
  }
  section.blocks = new_blocks;

  return section;
}

class Msg {
  msg;  // rewritten and parsed into tags and links
  content;  // raw string content from the line
  date;
  origin;  // the note that this message came from
  blocks;
  gobbled_newline;  // how many newlines came from after this message (and its blocks)
  msg;
  constructor(properties) {
    console.assert(['content', 'date', 'msg', 'origin'].every(x => Object.keys(properties).includes(x)), properties, 'huh');
    Object.assign(this, properties);
    this.blocks = [];
  }

  toJSON() {
    return Object.assign({}, this);
  }
}

class EmptyLine {
  constructor() {}
  toJSON() {
    return 'EmptyLine{}';
  }
}

function rewriteBlock(block, note) {
  if (block.length === 1) {
    try {
      // console.log('rewrite block', block);
      let item = block[0];
      if (item instanceof TreeNode && 'value' in item && item.value.startsWith("msg: ") && item.indent === 0 && item.children.length === 1) {
        let child = item.children[0];
        if (child.value.startsWith("Date: ") && child.indent === 1 && child.children.length === 0) {
          return new Msg({
            msg: rewriteLine(item.value.slice("msg: ".length)),
            content: item.value,
            date: child.value.slice("Date: ".length),
            origin: note,
          });
        }
      }
    } catch (e) {
      // console.log("failed to rewrite block:", block, e);
      return block;
    }
  }

  // TODO the rest of block rewrite
  return block;
}

class Link {
  url;
  display;
  type;
  constructor(url) {
    this.display = url;
    this.url = url;
    this.type = 'unknown';
    
    if (this.url.startsWith("http://") || this.url.startsWith("https://")) {
      this.display = this.display.slice(this.display.indexOf('://') + '://'.length);
    }
    const reddit_share_tail = "?utm_source=share&utm_medium=mweb3x&utm_name=mweb3xcss&utm_term=1&utm_content=share_button";
    if (this.display.endsWith(reddit_share_tail)) {
      this.display = this.display.slice(0, -reddit_share_tail.length);
    }
    if (this.display.startsWith(window.location.host)) {
      this.display = this.display.slice(window.location.host.length);
      this.display = decodeURI(this.display);

      if (this.display.startsWith("/disc/") && this.display.includes("#")) {
        this.display = this.display.slice("/disc/".length);
        this.type = 'internal_ref';
      } else if (this.display.startsWith("/search/")) {
        this.display = this.display.slice("/search/".length);
        this.type = 'internal_search';
      } else {
        this.type = 'shortcut';
      }
    }
  }

  toString() {
    return `Link(${this.url})`;
  }
}

function rewriteLine(line) {
  if (! (line.includes(": ") || line.includes("http://") || line.includes("https://"))) {
    return tagParse(line); 
  }
  let result = [];
  // we're just gonna look for https:// and http:// initially,
  // but maybe internal links should be old-style single links per line?
  // old style was only one link per line, and the line had to end in ": " and what could conditionally be a link

  // parse URL if line starts with http(s)://, URLs end in space or end-of-line.
  while (line !== '') {
    if (line.startsWith('https://') || line.startsWith('http://')) {
      let end_of_url = line.search(' ');
      if (line.slice(0, end_of_url).length > 9) { // after the "https://" is actually a link
        if (end_of_url === -1) {  // ideally this wouldn't need a special case but i can't think of how to handle it on this flight
          result.push(new Link(line));
          line = '';
        } else {
          result.push(new Link(line.slice(0, end_of_url)));
          line = line.slice(end_of_url);
        }
        continue;
      }
    }

    if (result.slice(-1).length > 0 && typeof result.slice(-1)[0] === 'string') {
      // for some reason `instanceof String` doesn't work??
      result[result.length - 1] += line[0];
    } else {
      result.push(line[0]);
    }
    line = line.slice(1);
  }
  let acc = [];
  for (let i = 0; i < result.length; i++) {
    if (typeof result[i] === 'string') {
      acc.push(...tagParse(result[i]));
    } else {
      acc.push(result[i]);
    }
  }
  return acc;
}

// TAG

class Tag {
  tag;
  constructor(tag) {
    this.tag = tag;
  }
  toString() {
    return `Tag(${this.tag})`;
  }
}

function tagParse(line) {
  let acc = [];
  if (line.startsWith("\\")) {
    // eat the command until a space
    // unless no space, then eat everything (indexOf returns -1, and slice(-1) goes to the end).
    let first_space = line.indexOf(' ');
    let cmd = line.slice(0, first_space);
    line = line.slice(first_space);
    acc.push(cmd);
  }
  const isUpperCase = (string) => /^[A-Z]*$/.test(string);

  let i = 0;
  while(i < line.length) {
    if (isUpperCase(line[i])) {
      // [A-Z]{2,}([-_][A-Z]{2,})*

      let uppercase_prefix = line[i++];
      // eat uppercase prefix, including intermediate dashes
      // - an intermediate dash is when the current character is a dash and the next letter is uppercase
      const head_dash = () => (line[i] === '-' || line[i] === '_');
      const intermediate_dash = () => head_dash() && (i + 1 <= line.length && isUpperCase(line[i+1]));
      while (i < line.length && (isUpperCase(line[i]) || intermediate_dash())) {
        uppercase_prefix += line[i++];
      }

      if (uppercase_prefix.length < 2) {
        // if the uppercase prefix is less than 2 characters, it's not a tag.
        // collect the non-uppercase prefix and continue.
        let non_uppercase_prefix = uppercase_prefix;
        while (i < line.length && (!isUpperCase(line[i+1]))) {
          non_uppercase_prefix += line[i++];
        }
        acc.push(non_uppercase_prefix);
      } else {
        acc.push(new Tag(uppercase_prefix));
      }
    } else {
      let nontag = line[i++];
      while (i < line.length && (! isUpperCase(line[i]))) {
        nontag += line[i++];
      }
      acc.push(nontag);
    }
  }
  return acc;
}

// RENDER

async function htmlNote(uuid) {
  console.log('rendering note for', uuid);
  let content = await global.notes.readFile(uuid);
  if (content === null) {
    return `couldn't find file '${uuid}'`;
  }
  return htmlNoteContent(uuid, content);
}

function htmlNoteContent(uuid, content) {
  console.assert(content !== null, content, 'content should not be null');
  let page = parseContent(content);
  let rewritten = rewrite(page, uuid);
  let rendered = rewritten.map((s, i) => htmlSection(s, i, content, uuid)).join("");
  if (rendered === '') {
    return 'no messages yet';
  }
  return "<div class='msglist'>" + rendered + "</div>"; // TODO it might make sense to move this _within_ section rendering
}

function htmlSection(section, i, content, uuid) {
  let output = [];
  if (! ('entry' === section.title && i === 0)) {
    output.push(`--- ${section.title} ---`)
  }
  if (section.title === 'METADATA' && pageIsJournal(global.notes.rewrite(uuid))) {
    return "";
  }
  if (['METADATA', 'HTML'].includes(section.title)) {
    output.push(...section.lines);
    return "<pre>" + output.join("\n") + "</pre>";
  }

  if (section.blocks.length === 0) {
    return '\n';
  }

  output.push(...section.blocks.map(b => htmlBlock(b, content)));

  let result = output.join("");
  result = trimTrailingRenderedBreak(result);
  return result;
}

function htmlMsgBlock(block, content) {
  if (block instanceof Deleted) {
    return '';
  }
  if (block instanceof Msg) {
    return htmlMsg(block, /*mode*/undefined, content);
  }
  if (block instanceof EmptyLine) {
    return "<br/>";
  }
  if (block instanceof Array) {
    if (block[0] == 'QUOTE') {
      return "<blockquote>" + block.slice(1).map(x => "<p>" + htmlLine(x) + "</p>").join("") + "</blockquote>";
    }
    if (block.length === 1 && block[0] instanceof TreeNode) {
      return "<pre>" + block[0].toString() + "\n</pre>";
    }
    return "<p class='msgblock'>" + block.map(htmlLine).join("<br>") + "</p>";
  }
  if (block instanceof TreeNode) {
    return `<pre>` + block.toString() + `</pre>`;
  }
  return JSON.stringify(block, undefined, 2);
}

function htmlBlock(block, content) {
  if (block instanceof Msg) {
    return htmlMsg(block, /*mode*/undefined, content);
  }
  if (block instanceof EmptyLine) {
    return "<br/>";
  }
  if (block instanceof Array) {
    if (block.length === 1 && block[0] instanceof TreeNode) {
      return "<pre>" + block[0].toString() + "\n</pre>";
    }
    if (block[0] == 'QUOTE') {
      return "<blockquote>" + block.slice(1).map(x => "<p>" + htmlLine(x) + "</p>").join("") + "</blockquote>";
    }
    return "<p>" + block.map(htmlLine).join("") + "\n</p>";
  }
  if (block instanceof TreeNode) {
    return `<pre>` + block.toString() + `</pre>`;
  }
  return JSON.stringify(block, undefined, 2);
}

// calendar format, just the weekday
const weekday_format = new Intl.DateTimeFormat('en-us', { weekday: 'short', timeZone: 'UTC' });

// calendar header format, just the month and year
const calendar_header_format = new Intl.DateTimeFormat('en-us', { timeZone: 'UTC', month: 'long', year: 'numeric' });

// date timestamp, like hh:mm:ss in 24-hour clock
const timestamp_format = new Intl.DateTimeFormat('en-us', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// date timestamp with day, like Jan 15, hh:mm:ss in 24-hour clock
const timestamp_day_format = new Intl.DateTimeFormat('en-us', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// date timestamp with day and year, like Jan 15, 2024, hh:mm:ss in 24-hour clock
const timestamp_year_format = new Intl.DateTimeFormat('en-us', { year: "numeric", month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// datetime format for "search" mode, like "Wed, Jan 15, hh:mm:ss" in 24-hour clock
const datetime_format = new Intl.DateTimeFormat('en-us', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// utc format
const utc_format = new Intl.DateTimeFormat('en-us', { year: "numeric", month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' });

// datetime format for "search" mode with year, like "Wed, Jan 15 2024, hh:mm:ss" in 24-hour clock
const datetime_year_format = new Intl.DateTimeFormat('en-us', { year: "numeric", month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// datetime format for "brief" mode, like "Wed Jan 15 hh:mm:ss PST" in 24-hour clock
const datetime_brief_format = new Intl.DateTimeFormat('en-us', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short'});

// the above format with the year added
const datetime_brief_year_format = new Intl.DateTimeFormat('en-us', { year: "numeric", month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short'});


function renderDatetime(date, mode) {
  let now = getNow();

  let time_format = timestamp_format;
  if (mode === 'search') {
    time_format = datetime_format;
    if (now.getFullYear() !== new Date(date).getFullYear()) {
      time_format = datetime_year_format
    }
  } else if (mode === "brief") {
    time_format = datetime_brief_format;
    if (now.getFullYear() !== new Date(date).getFullYear()) {
      time_format = datetime_brief_year_format;
    }
  } else {
    if (now.getDate() !== new Date(date).getDate() ||
        now.getMonth() !== new Date(date).getMonth() || 
        now.getFullYear() !== new Date(date).getFullYear()
    ) {
      time_format = timestamp_day_format;
    }
    if (now.getFullYear() !== new Date(date).getFullYear()) {
      time_format = timestamp_year_format;
    }
  }
  
  return time_format
    .format(date).replaceAll(",", "");  // "Wed, Jan 15, hh:mm:ss" -> "Wed Jan 15 hh:mm:ss"
}

function trimTrailingRenderedBreak(content) {
  if (content.endsWith("<br/>")) {
    content = content.slice(0, -("<br/>".length));
  }
  if (content.endsWith("<br>")) {
    content = content.slice(0, -("<br>".length));
  }
  return content;
}

function unparseContent(page) {
  let content = [];
  let first = true;
  for (let section of page) {
    let section_content = [];
    if (! first) {
      section_content.push(`--- ${section.title} ---`);
    }
    first = false;
    if (['METADATA', 'HTML'].includes(section.title)) {
      section_content.push(...section.lines);
      content.push(section_content.join("\n"));
      continue;
    }
    section_content.push(...unparseSectionContent(section));

    let trailing = section.trailing_newline ? "\n".repeat(section.trailing_newline) : "";
    content.push(section_content.join("") + trailing);
  }
  return content.join("");
}

function unparseSectionContent(section) {
  let acc = [];
  for (let block of section.blocks) {
    let block_content = unparseBlock(block);
    console.assert(typeof block_content === 'string', block_content, 'block_content should be a string')
    acc.push(block_content);
  }
  return acc;
}

function unparseMessageBlocks(message) {
  if (message.blocks.length > 0) {
    let acc = [];
    for (const [i, block] of message.blocks.map(unparseBlock).entries()) {
      acc.push(block);
    }
    return acc.join("");
  }
  return "";
}

function unparseMsg(msg) {
  if (msg.blocks.length === 1 && msg.blocks[0] instanceof Deleted) {
    let trail = msg.gobbled_newline ? "\n".repeat(msg.gobbled_newline) : "";
    return ["- " + msg.content, '\n  - Date: ' + msg.date, "\n", trail].join("");
  } else if (msg.blocks.length !== 0) {
    let trail = msg.gobbled_newline ? "\n".repeat(msg.gobbled_newline) : "";
    return ["- " + msg.content, '\n  - Date: ' + msg.date, "\n\n", unparseMessageBlocks(msg), trail].join("");
  } else {
    let trail = msg.gobbled_newline ? "\n".repeat(msg.gobbled_newline) : "";
    return ["- " + msg.content, '\n  - Date: ' + msg.date, "\n", trail].join("");
  }  
}

function unparseBlock(block) {
  if (block instanceof Msg) {
    return unparseMsg(block);
  }
  if (block instanceof EmptyLine) {
    return "\n";
  }
  if (block instanceof Array) {
    return block.map(x => unparseLineContent(x) + "\n").join("");
  }
  // throw new Error("failed unparseBlock", block);
  return ['ERROR BLOCK', ...block];
}

function unparseLineContent(l) {
  if (typeof l === 'string') {
    return l;
  }
  if (l instanceof TreeNode) {
    return l.toString();
  }
  // throw new Error("failed unparseLine", l);
  return 'ERROR: ' + l;
}

async function rewriteCurrentNote() {
  // DEBUGGING
  return rewrite(parseContent(await global.notes.readFile(getCurrentNoteUuid())), getCurrentNoteUuid());
}

async function checkCurrentWellFormed() {
  // DEBUGGING
  return checkWellFormed(getCurrentNoteUuid(), await global.notes.readFile(getCurrentNoteUuid()));
}

function checkWellFormed(uuid, content) {
  let page = parseContent(content);
  let rewritten = rewrite(page, uuid);
  
  let result = (unparseContent(rewritten) === content);
  if (! result) {
    console.log('REFERENCE\n', content);
    console.log('UNPARSED\n', unparseContent(rewritten));
    console.log('not well-fromed', uuid);
  }
  return result;
}

// used for when a text block is deleted
class Deleted {
  constructor() {}
}

async function editMessage(item_origin, msg_id) {
  // 1. only allow editing if msg is from local repo and if the page is well-formed
  //    - a page is well formed if unparse(parse(page)) === page
  // 2. only allow editing a single message at a time
  // 3. go from edit to awaiting submit
  // 4. handle submit
  //    - parse the page, replace the message, unparse the page and write it out.
  //    - probably also using updateFile

  // TODO figure out how to use updateFile for this

  // TODO could do split, could do `getLocalRepo()`
  console.log('edit link button');
  if (item_origin.split('/')[0] !== getCurrentNoteUuid().split('/')[0]) {
    console.log('not from local repo');
    return;
  }

  let item_origin_content = await global.notes.readFile(item_origin);

  let well_formed = checkWellFormed(item_origin, item_origin_content);
  if (! well_formed) {
    console.log('not well formed');
    return;
  }

  let parsed = parseContent(item_origin_content);
  let page = rewrite(parsed, item_origin);
  let msg = page.filter(section => section.title === 'entry').flatMap(x => x.blocks).find(block => block.date === msg_id);
  console.assert(msg !== undefined, 'could not find message with id', msg_id, 'in', page);

  // TODO handle syntax coloring and highlighting by maybe replacing the insides

  // "https://[ip]" + "/disc/[uuid]" + "?editmsg=[datetime_id]"
  let new_url = window.location.origin + window.location.pathname;
  let msg_element = document.getElementById(msg_id);
  let edit_msg = msg_element.getElementsByClassName('edit_msg')[0];
  let msg_content = msg_element.getElementsByClassName('msg_content')[0];
  let msg_block_content = msg_element.getElementsByClassName('msg_blocks')[0];
  console.log(edit_msg);
  if (edit_msg.innerText === 'edit') {
    new_url += `?editmsg=${msg_id}`;
    window.history.pushState({}, '', new_url);
    edit_msg.innerText = 'submit';

    // instead of this, we could just leave the content as-is, and react to keyboard and clicking events, onchange() or onkeypress() or something.
    // actually no, we'd still need to re-render the content because we need to undo the stuff _after_ rewrite, like shortening links.
    msg_content.innerHTML = msg.content.slice("msg: ".length); // removeprefix

    msg_content.contentEditable = true;
    msg_content.focus();

    msg_block_content.innerHTML = htmlEditableMsgBlockContent(msg);
    msg_block_content.contentEditable = true;

    // make all other edit buttons invisible
    let all_edit_links = document.getElementsByClassName('edit_msg');
    for (let edit_link of all_edit_links) {
      if (edit_link === edit_msg) {
        continue;
      }
      edit_link.style.display = 'none';
    }

    return false;
  } else {
    // handle submitting
    window.history.pushState({}, '', new_url);
    edit_msg.innerText = 'edit';
    msg_content.contentEditable = false;

    // modify message
    let new_msg_content = msg_content.innerText;
    msg.content = `msg: ${new_msg_content}`; // TODO innerText might have newlines, so we need to prevent that by using the submission dealio we have for the main message box
    // i don't know why divs get introduced, that's pretty annoying.
    if (msg_block_content.innerText.trim() === '') {
      msg.blocks = [new Deleted()];
    } else {
      msg.blocks = parseSection(msg_block_content.innerText.split('\n'));  // innerText is unix newlines, only http request are dos newlines
    }
    // TODO need to be able to delete a textblock by deleting all of its content

    let new_content = unparseContent(page);
    await global.notes.writeFile(item_origin, new_content);
    console.log('rendering inner html from submitted individual message edit', msg_content, htmlLine(msg_content.innerHTML));
    msg_content.innerHTML = htmlLine(rewriteLine(new_msg_content));

    msg_block_content.innerHTML = htmlMsgBlockContent(msg);
    if (msg_block_content.innerHTML === '') {
      msg_block_content.classList.remove('withcontent');
    } else {
      msg_block_content.classList.add('withcontent');
    }
    msg_block_content.contentEditable = false;

    // make all edit links visible again
    let all_edit_links = document.getElementsByClassName('edit_msg');
    for (let edit_link of all_edit_links) {
      edit_link.style.display = 'inline';
    }

    return false;
  }
};

function htmlEditableMsgBlockContent(msg) {
  return unparseMessageBlocks(msg).replace(/\n/g, "<br>");
}

function htmlMsgBlockContent(msg, origin_content) {
  let block_content = msg.blocks.map(block => htmlMsgBlock(block, origin_content)).join("");
  block_content = trimTrailingRenderedBreak(block_content);
  return block_content;
}

function preventDivs(e) {
  const is_weird = (e.key === 'Enter');
  if (! is_weird) {
    return;
  }

  // insert newline
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  const div = event.target;
  
  if (div.innerHTML === '' || div.innerHTML === '<br>') {
    // Case 1: Empty div
    console.log('empty div');
    div.innerHTML = '<br><br>';
    range.setStartAfter(div.firstChild);
    range.collapse(true);
  } else if (range.endOffset === div.textContent.length) {
    // Case 2: At the end of the div
    console.log('end of div');
    if (! div.innerHTML.endsWith('<br>')) {
      const br1 = document.createElement('br');
      range.insertNode(br1);
    }
    const br2 = document.createElement('br');
    range.insertNode(br2);
    range.setStartAfter(br2);
    range.collapse(true);
  } else {
    // Case 3: Everything else
    console.log('default case', range.endOffset, div.childNodes.length);
    const br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
  }
  
  selection.removeAllRanges();
  selection.addRange(range);

  return false;
}

function htmlMsg(item, mode, origin_content) {

  let date = Date.parse(timezoneCompatibility(item.date));
  
  let timestamp_content = renderDatetime(date, mode);
  let href_id = `/disc/${item.origin}#${item.date}`;
  let msg_timestamp_link = shortcircuitLink(href_id, timestamp_content, 'msg_timestamp');

  let line = htmlLine(item.msg);
  let style_option = item.origin !== getCurrentNoteUuid() ? " style='background: #5f193f'": "";

  let block_content = htmlMsgBlockContent(item, origin_content);
  let has_block_content = '';
  if (block_content !== '') {
    has_block_content = 'withcontent';
  }

  let edit_link = '';
  let editable = '';
  if (origin_content !== undefined && item.origin === getCurrentNoteUuid()) {
    if (!checkWellFormed(item.origin, origin_content)) {
      console.warn(item.origin, "should be well-formed");
    } else {
      // get 'editmsg' query param
      let url = new URL(window.location.href);
      let editmsg = url.searchParams.get('editmsg');
      
      // if the query param exists, only render submit for the one we're editing, make the rest invisible
      let style_display = 'inline';
      if (editmsg !== null) {
        style_display = 'none';
      }

      let edit_state = 'edit';
      if (editmsg === item.date) {
        edit_state = 'submit';
        style_display = 'inline';
        line = item.content.slice("msg: ".length); // removeprefix

        block_content = htmlEditableMsgBlockContent(item);
        editable = "contenteditable='true'"
      }

      edit_link = `<a style="display: ${style_display}" class="edit_msg" onclick="return editMessage('${item.origin}', '${item.date}')" href="javascript:void(0)">${edit_state}</a>`;
    }
  }

  return (`
    <div class='msg' id='${item.date}'>
      <div class="msg_menu">${msg_timestamp_link} ${item.origin.split('/')[0]} ${edit_link}</div>
      <div class="msg_content" ${editable} ${style_option}>${line}</div>
      <div class="msg_blocks ${has_block_content}" ${editable} onkeydown="return preventDivs(event)">${block_content}</div>
    </div>`
  )
}

function shortcircuitLink(url, text, style_class) {
  let style_class_include = "";
  if (style_class !== undefined) {
    style_class_include = `class='${style_class}'`;
  }
  return `<a ${style_class_include} onclick="window.history.pushState({}, '', '${url}'); handleRouting(); return false;" href="${url}">${text}</a>`;
}

function parseRef(ref) {
  let s = ref.split('#');  // a ref looks like: "uuid#datetime_id" 
  // EXAMPLE bigmac-js/f726c89e-7473-4079-bd3f-0e7c57b871f9.note#Sun Jun 02 2024 20:45:46 GMT-0700 (Pacific Daylight Time)
  console.assert(s.length == 2);
  console.log(s);
  let [uuid, datetime_id] = s;
  return {uuid, datetime_id};
}

async function retrieveMsg(ref) {
  let url_ref = parseRef(ref);
  let r = rewrite(await parseFile(url_ref.uuid), url_ref.uuid);
  let found_msg = r.filter(section => section.title === 'entry')
    .flatMap(s => s.blocks)
    .filter(x => x instanceof Msg && x.date === url_ref.datetime_id);
  return found_msg; // returns a list
}

function clickInternalLink(url) {
  window.history.pushState({}, '', url); handleRouting();
  return false;
}

function insertHtmlBeforeMessage(obj, html_content) {
  console.log(obj);
  let parent = obj.parentElement;
  while (! parent.classList.contains('msg')) {
    parent = parent.parentElement;
  }

  // TODO persist quotes to cache so they work on refresh
  // TODO UI to remove/toggle quotes
  if (parent.previousElementSibling && parent.previousElementSibling.classList && parent.previousElementSibling.classList.contains('quotes')) {
    parent.previousElementSibling.innerHTML += html_content;
    // TODO make sure to replace the element with the same id if it exists
  } else {
    parent.insertAdjacentHTML('beforebegin', "<div class='quotes'>" + html_content + "</div>");
  }
}

async function expandRef(obj, url) {
  let found_msg = await retrieveMsg(url);
  let result = htmlMsg(found_msg[0]);
  if (found_msg.length > 0) {
    console.log(found_msg);
    insertHtmlBeforeMessage(obj, result);
  } else {
    console.log(`couldn't find ${url_ref.datetime_id} in ${url_ref.uuid}`);
    // TODO error messaging
  }
};

async function expandSearch(obj, search_query) {
  let urlParams = new URLSearchParams(search_query);
  const text = urlParams.get('q');
  const case_sensitive = urlParams.get('case') === 'true';
  search(text, case_sensitive).then(all_messages => {
    let result = renderSearchMain(urlParams, all_messages);
    insertHtmlBeforeMessage(obj, result);
  });
}

function htmlLine(line) {
  if (line instanceof Array) {
    return line.map(x => {
      if (x instanceof Tag) {
        return "<emph class='tag'>" + x.tag + "</emph>";
      }
      if (x instanceof Link) {
        if (x.type === 'shortcut') {
          return shortcircuitLink(x.url, x.display, 'shortcut');
        }
        if (x.type === 'internal_ref') {
          let ref = parseRef(x.display);
          let shorter_datetime = renderDatetime(new Date(ref.datetime_id), 'brief');
          return `<div style="display:inline">
            <button onclick="return expandRef(this, '${x.display}')">get</button>
            <a onclick="return clickInternalLink('${x.url}')" href="${x.url}">${shorter_datetime}</a>
          </div>`;
        }
        if (x.type === 'internal_search') {
          
          // TODO add time of search to search result?
          // let shorter_datetime = renderDatetime(new Date(ref.datetime_id), 'brief');
          return `<div style="display:inline">
            <button onclick="return expandSearch(this, '${x.display}')">get</button>
            <a onclick="return clickInternalLink('${x.url}')" href="${x.url}">${x.display}</a>
          </div>`;
        }
        return `<a href="${x.url}">${x.display}</a>`;
      }
      return x;
    }).join("");
  }

  // TODO actually render these lines by parsing them.  for some reason they're not parsed.
  // console.log('huh', line);
  return line;
}

// DISC

const MIX_FILE = 'disc mix state';
const MENU_TOGGLE_FILE = 'disc menu toggle state';
const LIST_NOTES_TOGGLE_FILE = 'list notes toggle state';
const SEARCH_CASE_SENSITIVE_FILE = 'search case sensitive state';

async function paintDisc(uuid, flag) {
  document.title = `${global.notes.get_note(uuid)?.title || "illegal: " + uuid} - Pipeline Notes`;
  if (flag !== 'only main') {
    await paintDiscFooter(uuid);

    // msg_input doesn't exist when the uuid is not in our local repo
    setTimeout(() => {
      document.getElementById('msg_input')?.focus();
    }, 0);
  }

  let main = document.getElementsByTagName('main')[0];
  if (global.notes.get_note(uuid) === null) {
    main.innerHTML = `couldn't find file '${uuid}'`;
    return;
  }
  main.innerHTML = await renderDiscBody(uuid);
  
  const selected = updateSelected();
  if (selected === null) {
    main.scrollTop = main.scrollHeight;
  } else {
    selected.scrollIntoView();
  }
}

async function mixPage(uuid, mix_as_journal=true) {
  let rewritten = global.notes.rewrite(uuid);

  // notes that share our title
  let sibling_notes = global.notes.getAllNotesWithSameTitleAs(uuid);

  if (mix_as_journal) {
    let date = new Date(timezoneCompatibility(global.notes.get_note(uuid).date));
    
    let tomorrow = new Date(date);
    tomorrow.setDate(date.getDate() + 1);
    console.log('tomorrow', dateToJournalTitle(tomorrow));
    sibling_notes.push(...global.notes.getNotesWithTitle(dateToJournalTitle(tomorrow)));

    let yesterday = new Date(date);
    yesterday.setDate(date.getDate() - 1);
    console.log('yesterday', dateToJournalTitle(yesterday));
    sibling_notes.push(...global.notes.getNotesWithTitle(dateToJournalTitle(yesterday)));
  }

  console.log('mixing entry sections of', sibling_notes.map(note => note.uuid), "with current note", uuid);
  let sibling_pages = sibling_notes.map((sibling_note) => rewrite(parseContent(sibling_note.content), sibling_note.uuid));

  let entry_sections = sibling_pages.map(page => page.filter(section => section.title === 'entry')[0]);
  let entry_blocks = entry_sections.map(entry_section => entry_section.blocks);
  let entry_nonmessage_blocks = entry_blocks.map(blocks => {
    let first_msg_idx = blocks.findIndex(b => b instanceof Msg);
    if (first_msg_idx !== -1) {
      return blocks.slice(0, first_msg_idx);
    }
    return blocks;
  });
  let entry_nonmessages = entry_nonmessage_blocks.reduce((a, b) => [...a, ...b], []);
  let entry_message_blocks = entry_blocks.map((blocks, i) => blocks.slice(entry_nonmessage_blocks[i].length));
  let entry_messages = entry_message_blocks.reduce((a, b) => [...a, ...b], []);
  entry_messages.sort(dateComp);
  let new_blocks = [...entry_nonmessages, ...entry_messages];

  let current_entry_section = rewritten.filter(section => section.title === 'entry')[0];
  current_entry_section.blocks = new_blocks;
  return rewritten;
}

async function renderDiscMixedBody(uuid) {
  let page = await mixPage(uuid, pageIsJournal(global.notes.rewrite(uuid)));
  if (page === null) {
    return `couldn't find file '${uuid}'`;
  }

  const content = global.notes.get_note(uuid).content;  
  let rendered = page.map((s, i) => htmlSection(s, i, content, uuid)).join("\n");
  if (rendered.trim() === '') {
    return 'no messages yet';
  }
  return "<div class='msglist'>" + rendered + "</div>";
}

async function paintDiscRoutine() {
  // maintain the scroll of the modal when repainting it
  let left = document.getElementsByClassName("menu-modal")[0].scrollLeft;
  let top = document.getElementsByClassName("menu-modal")[0].scrollTop;

  document.getElementById("modal-container").innerHTML = `<div class="menu-modal">
      ${await routineContent()}
    </div>`;

  document.getElementsByClassName("menu-modal")[0].scrollLeft = left;
  document.getElementsByClassName("menu-modal")[0].scrollTop = top;
}

async function clickMix() {
  // toggle mix state in the file
  let mix_state = await toggleBooleanFile(MIX_FILE, "false");
  await paintDisc(getCurrentNoteUuid(), 'only main');
  let button = document.getElementById('mix_button') || document.getElementById('focus_button');
  button.innerHTML = lookupIcon(mix_state === "true" ? 'focus' : 'mix');
  return false;
};

async function getSupervisorStatus() {
  const hostname = window.location.hostname;  // "10.50.50.2"
  const status = await fetch(`https://${hostname}:8002/api/status`, {method: 'GET'}).then(response => response.json());
  return status;
}

async function handleMsg(event) {
  const displayState = (state) => { document.getElementById('state_display').innerHTML = state; };

  // console.log(event);  // print out keyboard events 

  // yield to the UI thread with settimeout 0, so the msg_input clientHeight uses the post-keyboardEvent UI state.
  setTimeout(() => {
    let footer_menu_size = (document.getElementById('msg_input').clientHeight) + 80; // for one line, client height is 31px
    console.log('setting footer menu to ', footer_menu_size, 'px');
    document.documentElement.style.setProperty("--footer_menu_size", footer_menu_size + "px");
  }, 0);

  const should_submit = (event.key === 'Enter');
  if (! should_submit) {
    return;
  }

  event.preventDefault();

  let msg_input = document.getElementById('msg_input');
  let msg = msg_input.innerText;
  let current_uuid = getCurrentNoteUuid();
  if (msg.trim().length > 0) {
    console.log('msg', msg);
    msg_input.innerText = '';

    let is_journal = pageIsJournal(global.notes.rewrite(current_uuid));

    // if we're in a journal and we're not on the current one, redirect to the current journal
    if (is_journal) {
      let today_uuid = await getJournalUUID();
      if (current_uuid !== today_uuid) {
        current_uuid = today_uuid;
        window.history.pushState({}, "", `/disc/${current_uuid}`);
      }
    }

    await global.notes.updateFile(current_uuid, (content) => {
      let lines = content.split("\n");
      const content_lines = lines.slice(0, lines.indexOf("--- METADATA ---"));
      const metadata_lines = lines.slice(lines.indexOf("--- METADATA ---"));
      const old_content = content_lines.join("\n");
      const metadata = metadata_lines.join("\n");

      const new_content = old_content + `\n- msg: ${msg}\n  - Date: ${getNow()}\n\n`;
      return new_content + metadata;
    });
  }
  await paintDisc(current_uuid, 'only main');
  await paintDiscRoutine();

  if (hasRemote()) {
    let repos = await getRepos();
    let sync_success = true;
    try {
      let combined_remote_status = await getRemoteStatus(repos.join(","));
      displayState("syncing...");
      await pullRemoteSimple(combined_remote_status);
      
      // don't paint after syncing.  it's jarring/disruptive as sync is sometimes slow (500ms)
      // await paintDisc(uuid, 'only main'); 

      displayState("done");
      await pushLocalSimple(combined_remote_status);
    } catch (e) {
      sync_success = false;
    }
    if (! sync_success) {
      try {
        let status = await getSupervisorStatus();
        displayState(JSON.stringify(status));
      } catch (e) {
        displayState("supervisor down");
      } 
    }
  }
  await global.notes.rebuild();
  return false;
};

async function toggleMenu () {
  let menu_state = await toggleBooleanFile(MENU_TOGGLE_FILE, "false");
  document.documentElement.style.setProperty("--menu_modal_display", menu_state === 'true' ? "flex" : "none");
}

async function paintDiscFooter(uuid) {
  setTimeout(() => {
    if (global.notes.get_note(uuid) === null) {
      return;
    }
    const well_formed = checkWellFormed(uuid, global.notes.get_note(uuid).content) ? 'well-formed' : 'not well-formed';
    document.getElementById('well_formed_display').innerHTML = well_formed;
  }, 100);

  const has_remote = await hasRemote();
  let mix_state = "false";
  let mix_button = '';
  if (has_remote) {
    mix_state = await readBooleanFile(MIX_FILE, "false");
    mix_button_value = mix_state === 'true' ? 'focus' :'mix';
    mix_button = MenuButton({icon: mix_button_value, action: 'return clickMix(event)'});
  }

  let msg_form = "";
  let edit_button = "";
  if (uuid.startsWith(global.notes.local_repo_name())) {
    msg_form = `<div
      onkeydown="return handleMsg(event);"
      id="msg_input"
      class="msg_input"
      aria-describedby=":r4u:"
      aria-label="Message"
      contenteditable="true"
      role="textbox"
      tabindex="0"
      style="user-select: text; white-space: pre-wrap; word-break: break-word;"
      data-lexical-editor="true"><br></div>`

      edit_button = MenuButton({icon: 'edit', action: `gotoEdit('${uuid}')`});
  }

  let menu_state = await readBooleanFile(MENU_TOGGLE_FILE, "false");
  document.documentElement.style.setProperty("--menu_modal_display", menu_state === 'true' ? "flex" : "none");

  let footer = document.getElementsByTagName('footer')[0];
  footer.innerHTML = `${msg_form}
    <div id="modal-container">
      <div class="menu-modal">
        loading routine...
      </div>
    </div>
    <div id="footer_menu_container">
      <div id="footer-button-container">
        ${edit_button}
        ${MenuButton({icon: 'list', action: 'gotoList()'})}
        ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
        ${MenuButton({icon: 'search', action: 'gotoSearch()'})}
        ${MenuButton({icon: 'routine', action: 'return toggleMenu()'})}
        ${mix_button}
      </div>
      <div id="footer_message_container">
        <div id='state_display'></div>
        <div id='well_formed_display'></div>
      </div>
    </div>`;
  await paintDiscRoutine();
}

async function renderDiscBody(uuid) {
  let mix_state = await readBooleanFile(MIX_FILE, "false");
  console.log('mix state', mix_state);
  let rendered_note = '';
  if (mix_state === "true") {
    rendered_note = await renderDiscMixedBody(uuid);
  } else {
    rendered_note = await htmlNote(uuid);
  }
  return rendered_note;
}

async function gotoDisc(uuid) {
  window.history.pushState({},"", "/disc/" + uuid);
  paintDisc(uuid, /* paint both footer and main */ undefined);
  return false;
}

// EDIT

async function paintEdit(uuid) {
  document.title = `editing "${global.notes.get_note(uuid).title}" - Pipeline Notes`;
  let main = document.getElementsByTagName('main')[0];
  let footer = document.getElementsByTagName('footer')[0];
  [main.innerHTML, footer.innerHTML] = await renderEdit(uuid);

  let el = document.getElementsByClassName("editor_textarea")[0];
  el.scrollTop = el.scrollHeight;
}

async function gotoEdit(uuid) {
  window.history.pushState({},"", "/edit/" + uuid);
  await paintEdit(uuid);
}

async function submitEdit() {
  let textarea = document.getElementsByTagName('textarea')[0];
  let content = textarea.value;  // textareas are not dos newlined, http requests are.  i think?
  // TODO consider using .replace instead of .split and .join
  const uuid = getCurrentNoteUuid();
  await global.notes.writeFile(uuid, content);
  await global.notes.rebuild();
  gotoDisc(uuid);
};

async function renderEdit(uuid) {
  console.log('rendering /edit/ for ', uuid);
  let content = await global.notes.readFile(uuid);
  if (content === null) {
    return `couldn't find file '${uuid}'`;
  }
  // TODO if coming from routine, we might want to go back to where we came from, rather than going to the routine disc.
  // - TEMP (lol) adding a JRNL button to go to the journal, which is usually where we need to go back to.
  return [
    // you need a newline after the start textarea tag, otherwise empty first lines are eaten and lost on submit.
    `<textarea class='editor_textarea'>\n` + content + "</textarea>",
    `
    ${MenuButton({icon: 'submit', action: 'submitEdit()'})}
    ${MenuButton({icon: 'back', action: `gotoDisc('${uuid}')`})}
    ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
    `
  ];
}

// LIST

async function gotoList() {
  window.history.pushState({}, "", "/list");
  await paintList();
  let main = document.getElementsByTagName('main')[0];
  main.scrollTop = 0;
}

const date_into_ymd = (date) => {
  let day = `${date.getDate()}`.padStart(2, '0');
  let month = `${date.getMonth() + 1}`.padStart(2, '0');
  let year = date.getFullYear();
  let key = `${year}-${month}-${day}`;
  return key;
};

const utcdate_into_ymd = (date) => {
  let day = `${date.getUTCDate()}`.padStart(2, '0');
  let month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  let year = date.getUTCFullYear();
  let key = `${year}-${month}-${day}`;
  return key;
};

const utcdate_to_weekday = (date) => {
  let day_of_week = date.getUTCDay(); // because days parsed from yyyy-mm-dd format will be in utc
  return day_of_week;
}

const compute_seasonal_color = (date_obj) => {
  let color = "black";
  let month = date_obj.getUTCMonth();

  const make = (r, g, b) => {  // each is a pair of [base, random factor]
    return {
      r: r[0] + Math.random() * r[1], 
      g: g[0] + Math.random() * g[1], 
      b: b[0] + Math.random() * b[1],
    };
  }

  let offset = (month % 3) * 30 + date_obj.getDate();

  let winter = make([70, offset], [70, offset], [160, 55]); // blue-purple
  let spring = make([170, 40], [70, 25], [100, 55]);  // pink
  let summer = make([50, 70], [150, 40], [50, 70]);  // green
  let fall = make([90 + offset, 50], [120, 50], [30, 10]);  // red-orange-yellow-green

  if (0 <= month && month < 3) {
    // blue-ish
    color = "rgb(" + winter.r + ", " + winter.g + ", " + winter.b + ")";
  } else if (3 <= month && month < 6) {
    // pink-ish
    color = "rgb(" + spring.r + ", " + spring.g + ", " + spring.b + ")";
  } else if (6 <= month && month < 9) {
    // green-ish
    color = "rgb(" + summer.r + ", " + summer.g + ", " + summer.b + ")";
  } else { // 9 <= month && month < 12
    // orange-ish
    color = "rgb(" + fall.r + ", " + fall.g + ", " + fall.b + ")";
  }
  return color;
}

async function paintList() {
  document.title = "List - Pipeline Notes";
  // calendar view

  // draw boxes in a 7 wide grid like a calendar
  // each box is a day
  // each day has a number of notes

  // non-journal notes might be a bit more complicated, as they might have notes on separate days

  // gather notes to days
  console.time('paintList get days');
  let notes_by_day = global.notes.flatRead.metadata_map.reduce((acc, note) => {
    let date = new Date(timezoneCompatibility(note.date));
    let key = date_into_ymd(date);
    if (acc[key] === undefined) {
      acc[key] = [];
    }
    acc[key].push(note);
    return acc;
  }, {});
  console.timeEnd('paintList get days');

  console.time('paintList sort days');
  let days = Object.entries(notes_by_day).sort();
  console.timeEnd('paintList sort days');

  console.time('paintList fill in days');
  if (days.length > 0) {
    let last = days[days.length - 1];
    let first = days[0];
    let first_date = new Date(first[0]);
    let last_date = new Date(last[0]);

    // put [] in days that have no notes between first and last
    
    while (first_date < last_date) {
      let key = utcdate_into_ymd(first_date);
      if (notes_by_day[key] === undefined) {
        notes_by_day[key] = [];  // populate empty days with empty lists
      }
      first_date.setDate(first_date.getDate() + 1); // increment days, even looping over months and years.  thanks javascript
    }

    last_date = new Date(last[0]);
    while (true) {
      last_date.setDate(last_date.getDate() + 1);  // go forward to the last saturday
      let key = utcdate_into_ymd(last_date);
      if (notes_by_day[key] === undefined) {
        notes_by_day[key] = [];  // populate empty days with empty lists
      }
      if (utcdate_to_weekday(last_date) === 6) {
        break;
      }
    }

    first_date = new Date(first[0]);
    while (true) {
      first_date.setDate(first_date.getDate() - 1);  // go back to the first sunday
      let key = utcdate_into_ymd(first_date);
      if (notes_by_day[key] === undefined) {
        notes_by_day[key] = [];  // populate empty days with empty lists
      }
      if (utcdate_to_weekday(first_date) === 0) {
        break;
      }
    }
  }
  console.timeEnd('paintList fill in days');

  console.time('paintList compute day features');
  let local_repo_name = global.notes.local_repo_name();
  let grid = Object.entries(notes_by_day).sort().reverse().map(([date, notes]) => {
    let date_obj = new Date(date);
    let color = compute_seasonal_color(date_obj);
    let weekday_name = weekday_format.format(date_obj);
    return {date, notes, color, weekday_name};
  });
  console.timeEnd('paintList compute day features');

  // split into chunks of 7
  
  let acc = [];
  const week_length = 7;
  for (let i = 0; i < grid.length; i += week_length) {
    acc.push(grid.slice(i, i + week_length));
  }

  let render_notes = await readBooleanFile(LIST_NOTES_TOGGLE_FILE, "false");

  console.time('paintList render weeks');
  let weeks = acc
    // .slice(0, 1)
    .map((week) => {
      let year_months_in_week = {};
      let week_notes = [];
      let days = week.reverse().map(({date, notes, color, weekday_name}) => {
        let date_obj = new Date(date);
        year_months_in_week[calendar_header_format.format(date_obj)] = true;
        const is_journal = note => note.metadata.Tags && note.metadata.Tags.includes('Journal');
        let journals = notes.filter(n => is_journal(n));
        let not_journals = notes.filter(n => !is_journal(n));
        if (not_journals.length > 0) {
          week_notes.push({date, notes: not_journals});
        }
        let link_el = document.createElement('div');
        link_el.classList.add('calendar', 'links');
        link_el.innerHTML = weekday_name;
        if (journals.length > 0) {
          let has_local_journal = journals.some(n => n.uuid.startsWith(local_repo_name));
          let note = (has_local_journal) ? journals.find(n => n.uuid.startsWith(local_repo_name)) : journals[0];

          let title = note.title;
          if (note.title.split(" ").length === 3) {
            // January 12th, 2024 -> 12
            let [month, day, year] = note.title.split(" ");
            
            title = day.slice(0, day.length - 3);
          }
          
          let journal_link = `<a href="/disc/${note.uuid}">${title}</a>`
          link_el.innerHTML = `${weekday_name} ${journal_link}`;
        }
        let day_el = document.createElement('div');
        day_el.classList.add('calendar', 'day');
        day_el.style.backgroundColor = color;
        day_el.append(link_el);
        return day_el;;
      });
      let notes = [];
      if (render_notes === "true") {
        const notelist = (notes) => notes.map(note => {
          // `<li class='calendar note'><a href="/disc/${note.uuid}">${note.title}</a></li>`
          let li_el = document.createElement('li');
          li_el.classList.add('calendar', 'note');
          let a_el = document.createElement('a');
          a_el.href = `/disc/${note.uuid}`;
          a_el.innerHTML = note.title;
          li_el.appendChild(a_el);
          return li_el;
        });
        let all_notes = week_notes.map(({date, notes}) => {
          // `<ul class="calendar notelist">${date}` + notelist(notes) + `</ul>`
          let ul_el = document.createElement('ul');
          ul_el.classList.add('calendar', 'notelist');
          let date_el = document.createElement('div');
          date_el.innerHTML = date;
          ul_el.appendChild(date_el);
          ul_el.append(...notelist(notes));
          return ul_el;
        });
        // notes = `<div class='calendar noteset'>` + all_notes + "</div>";
        let notes_el = document.createElement('div');
        notes_el.classList.add('calendar', 'noteset');
        notes_el.append(...all_notes);
        notes.push(notes_el);
      }

      let year_months = Object.keys(year_months_in_week).map(x => {
        // `<div class='calendar year-month'>${x}</div>`
        let el = document.createElement('div');
        el.classList.add('calendar', 'year-month');
        el.innerHTML = x;
        return el;
      });
      let week_header = document.createElement('div');
      week_header.classList.add('calendar', 'week-header');
      week_header.append(...year_months);

      let week_el = document.createElement('div');
      week_el.classList.add('calendar', 'week');
      week_el.append(week_header);

      let weekdays = document.createElement('div');
      weekdays.classList.add('weekdays');
      weekdays.append(...days);

      week_el.append(weekdays);

      week_el.append(...notes);

      // return `<div class='calendar week'><div class='calendar week-header'>${year_months.join(" ")}</div><div class='weekdays'>` + days.join("") + `</div>${notes}</div>`;
      return week_el;
    });
  console.timeEnd('paintList render weeks');
  
  // elements seem faster than strings and innerHtml
  let main = document.getElementsByTagName('main')[0];
  main.replaceChildren(...weeks);
  // let rows = global.notes.flatRead.metadata_map.sort((a, b) => dateComp(b, a)).map(x => `<tr><td>${x.uuid.split('/')[0]}</td><td><a href="/disc/${x.uuid}">${x.title}</a></td></tr>`).join("\n");
  // let table = "<table><tr><th>repo</th><th>title</th></tr>" + rows + "</table>";
  let footer = document.getElementsByTagName('footer')[0];
  footer.innerHTML = `
    ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
    ${MenuButton({icon: 'menu', action: 'gotoMenu()'})}
    ${await ToggleButton({id: 'list_notes_toggle', file: LIST_NOTES_TOGGLE_FILE, query_param: 'show_notes', label: lookupIcon('notes'), rerender: 'paintList'})}
    `;
}

// HIGHLIGHT SELECTED

function updateSelected() {
  // clear selected
  const currently_selected = document.getElementsByClassName('selected');
  for (s of currently_selected) {
    s.classList.remove('selected');
  }

  // select from hash
  if (window.location.hash) {
    const selected = document.getElementById(decodeURI(window.location.hash.slice(1)));
    selected.classList.add('selected');
    return selected;
  } else {
    return null;
  }
};

window.addEventListener('load', () => {
  window.addEventListener('hashchange', () => {
    updateSelected()?.scrollIntoView();
  });

  updateSelected()?.scrollIntoView();
});

// SYNC

const SYNC_FILE = 'sync_status';
const SYNC_REMOTE_FILE = 'sync_remote';
const SYNC_ELEMENT_ID = 'sync_output'

async function gotoSync() {
  window.history.pushState({}, "", "/sync");
  paintSimple(await renderSync());
}

async function getRemote() {
  return await cache.updateFile(SYNC_REMOTE_FILE, state =>
    state === null ? "" : state
  );
}

async function hasRemote() {
  let hostname = window.location.hostname;
  let self_hosted = hostname.startsWith("10.") || hostname.startsWith("192.");
  // if we're self_hosted, we have a remote, even if the remote is ''.
  if (self_hosted) {
    return true;
  }
  // otherwise, we need to check if the remote is set.
  return (await getRemote()).trim() !== '';
}

async function syncButton() {
  if (await hasRemote()) {
    return MenuButton({icon: 'sync', action: 'gotoSync()'});
  } else {
    return ``;
  }
}

async function getRepos() {
  let local_repo_name = await get_local_repo_name();
  let subbed_repo_content = await cache.readFile(SUBBED_REPOS_FILE);
  if (subbed_repo_content === null) {
    await cache.writeFile(SUBBED_REPOS_FILE, '');
    return [local_repo_name];
  }
  if (subbed_repo_content.trim() === '') {
    return [local_repo_name];
  }
  let subbed_repos = (await cache.readFile(SUBBED_REPOS_FILE)).split(" ");
  return [local_repo_name, ...subbed_repos];
}

async function renderSync() {
  await cache.updateFile(SYNC_FILE, c => c === null ? '{}' : c);

  let remote_addr = (await cache.readFile(SYNC_REMOTE_FILE)) || '';

  const repo_sync_menu = (repo, type) => {
    let menu_content = '';
    if (type === 'local') {
      menu_content = (
        `<button style="margin: 10px;" onclick="pushLocalNotes('${repo}')">push update</button>`
        + `<button style="margin: 10px;" onclick="pushLocalNotes('${repo}', true)">check for push update</button>`)
    } else {
      menu_content = (
        `<button style="margin: 10px;" onclick="pullRemoteNotes('${repo}')">update</button>`
        + `<button style="margin: 10px;" onclick="pullRemoteNotes('${repo}', true)">check for update</button>`)
    }
    return `<div style="min-width: 400px; border: 1px white solid; margin: 10px">
    <div>
      <h3 style="margin: 10px">${repo}${type === 'local' ? " (local)" : ""}</h3>
      <button style="margin: 10px;" onclick="putAllNotes('${repo}')">put all</button>
      <button style="margin: 10px;" onclick="getAllNotes('${repo}')">get all</button>
      ${menu_content}
    </div>
    <pre id="${repo}_sync_output"></pre>
  </div>`
  };
  let [local, ...remotes] = await getRepos();


  let subscribed_repos_message = "Not subscribed to any repositories.";
  if (remotes.length > 0) {
    subscribed_repos_message = "Subscribed to " + remotes.map(colorize_repo).join(", ") + ".";
  }

  return [`
  <p>Sync is a very experimental feature! use at your own risk!</p>
  <div>
    ${TextField({id:'remote', file_name: SYNC_REMOTE_FILE, label: 'set remote addr', value: remote_addr, rerender: 'renderSync'})}
    <div style="margin: 10px">
      ${TextField({id: 'subscriptions', file_name: SUBBED_REPOS_FILE, rerender: 'renderSetup', value: remotes.join(" "), label: 'subscribe to repos'})}
      <br/>
      <label for='subscriptions'>subscribe to a list of (whitespace-separated) repositories</label>
    </div>
    ${subscribed_repos_message}
  </div>
  <div style='display: flex;'>` + repo_sync_menu(local, 'local') + remotes.map(remote => repo_sync_menu(remote, 'remote')).join("") + `</div>`,
  `<div>
    ${MenuButton({icon: 'list', action: 'gotoList()'})}
    ${MenuButton({icon: 'setup', action: 'gotoSetup()'})}
    ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
  </div>
  `]
}

function request_len(remote) {
  let request = remote + '/api/get/' + repo + "/" + uuids.join(",");
  return request.length
}

async function fetchNotes(repo, uuids) {
  // can either be single note: <repo>/<uuid>
  // or multiple: <repo>/<uuid>(/<uuid>)*

  if (uuids.length === 0) {
    return;
  }
  if (repo.endsWith('/')) {
    repo = repo.slice(0, -1);
  }
  let result = await fetch((await getRemote()) +'/api/get/' + repo + "/" + uuids.join(",")).then(t => t.json());
  for (let note in result) {
    await global_notes.writeFile(note, result[note]);
  }
}

async function getAllNotes(repo) {
  console.log('getting notes');

  let list = await fetch((await getRemote()) + '/api/list/' + repo).then(x => x.json());

  try {
    await fetchNotes(repo, list);
  } catch (e) {
    console.log(e);
  }
}

async function pullRemoteNotes(repo, dry_run, combined_remote_status) {
  let local_status = await getLocalStatus(repo);
  let remote_status = undefined;
  if (combined_remote_status !== undefined) {
    // console.log('using combined remote status');
    remote_status = combined_remote_status[repo] || {};
  } else {
    remote_status = await getRemoteStatus(repo);
  }
  let updated = statusDiff(local_status, remote_status);
  let updated_notes = Object.keys(updated);
  console.assert(updated_notes.every(x => x.startsWith(repo + '/')));

  let updated_uuids = updated_notes.map(x => x.slice((repo + '/').length));

  if (dry_run) {
    writeOutputIfElementIsPresent(repo + '_sync_output', "update found:\n" + JSON.stringify(updated, undefined, 2));
  } else {
    writeOutputIfElementIsPresent(repo + '_sync_output', "update committed:\n" + JSON.stringify(updated, undefined, 2));
    console.log('updated uuids', updated_uuids);
    if (updated_uuids.length > 0) {
      await fetchNotes(repo, updated_uuids);
    }
  }
}

async function pullRemoteSimple(combined_remote_status) {
  let [ignored_local, ...remotes] = await getRepos();
  console.time('pull remote simple');
  await Promise.all(remotes.map(async subscribed_remote =>
    await pullRemoteNotes(subscribed_remote, /*dry run*/false, combined_remote_status)));
  console.timeEnd('pull remote simple');
}

async function pushLocalSimple(combined_remote_status) {
  let [local, ...ignored_remotes] = await getRepos();
  console.time('push local simple');
  await pushLocalNotes(local, /*dry run*/false, combined_remote_status);
  console.timeEnd('push local simple');
}

function writeOutputIfElementIsPresent(element_id, content) {
  let element = document.getElementById(element_id);
  if (element === null) {
    return;
  }
  element.innerHTML = content;
}

async function pushLocalNotes(repo, dry_run, combined_remote_status) {
  let local_status = await getLocalStatus(repo);
  let remote_status = undefined;
  if (combined_remote_status !== undefined) {
    console.log('using combined remote status');
    remote_status = combined_remote_status[repo] || {};
  } else {
    remote_status = await getRemoteStatus(repo);
  }
  let updated = statusDiff(remote_status, local_status);  // flipped, so it is what things in local aren't yet in the remote.
  // local is the new state, remote is the old state, this computes the diff to get from the old state to the new.

  let updated_notes = Object.keys(updated);
  console.assert(updated_notes.every(x => x.startsWith(repo + '/')));

  let updated_uuids = updated_notes.map(x => x.slice((repo + '/').length));

  if (dry_run) {
    writeOutputIfElementIsPresent(repo + '_sync_output', "push update found:\n" + JSON.stringify(updated, undefined, 2));
  } else {
    writeOutputIfElementIsPresent(repo + '_sync_output', "push update committed:\n" + JSON.stringify(updated, undefined, 2));
    console.log('updated uuids', updated_uuids);
    if (updated_uuids.length > 0) {
      await putNotes(repo, updated_uuids);
    }
  }
}

async function putNote(note) {
  console.log('syncing note', note, 'to server');
  const response = await fetch((await getRemote()) + "/api/put/" + note, {
    method: "PUT", // *GET, POST, PUT, DELETE, etc.
    headers: {
      "Content-Type": "text/plain",
    },
    body: await global.notes.readFile(note), // body data type must match "Content-Type" header
  });
  return response.text();
}

function delay(millis) {
  return new Promise((resolve, reject) => {
    setTimeout(_ => resolve(), millis)
  });
}

async function putNotes(repo, uuids) {
  let failures = [];
  for (let file of uuids.map(x => repo + '/' + x)) {
    for (let i of [1, 2, 3]) {
      try {
        await putNote(file);
        break;
      } catch (e) {
        console.log(`failed attempt #${i}: ${file}`)
        if (i !== 3) {
          console.log('trying again...');
          await delay(100 * i);
        } else {
          failures.push(file);
          console.log(e);
          break;
        }
      }
    }
  }
  return failures;
}

async function putAllNotes(repo) {
  let files = await global_notes.listFiles();
  repo_files = files.filter(file => file.startsWith(repo + "/"));
  uuids = repo_files.map(x => x.slice((repo + '/').length));
  return putNotes(repo, uuids);
}

// STATUS

async function sha256sum(input_string) {
  console.time('sha256sum');
  const encoder = new TextEncoder('utf-8');
  const bytes = encoder.encode(input_string);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  let result = hashToString(hash);
  console.timeEnd('sha256sum');
  return result;
}

async function hashToString(arraybuffer) {
  const bytes = new Uint8Array(arraybuffer);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// a non symmetric set difference, that also compares hashes.
// tells you the number of things in `right` that are not in `left`, or have different hashes.
// we can think of `right` as the `source` of possible changes, and `left` as the `destination`,
// as the result must contain all elements in `right` that are not in `left` or are updated.
function statusDiff(left, right) {
  let diff = {};
  let left_keys = Object.keys(left);
  for (let note in right) {
    if (left_keys.includes(note)) {
      if (left[note] !== right[note]) {
        diff[note] = {status: 'modified', sha: right[note]};
      } else {
        // otherwise, the statuses are the same, so do nothing
        // console.log(`${note} up to date!`)
      }
    } else {
      // `note` isn't even in `left`, whatever status it has is new.
      diff[note] = {status: 'created', sha: right[note]};
    }
  }
  return diff;
}

async function getRemoteStatus(repo_or_repos) {
  console.log('getting remote status for', repo_or_repos); // may be comma separated list
  let statuses = await fetch((await getRemote()) + '/api/status/' + repo_or_repos).then(x => x.json());
  return statuses;
}

async function compareNote(uuid) {
  let note = await global.notes.readFile(uuid);
  let reference = await global.notes.readFile(uuid);
  let result = (note === reference);
  console.log('reference', reference);
  console.log('note', note);
  console.log('result', result);
  return result;
}

async function getLocalStatus(repo) {
  const notes = await getLocalNotes(repo);
  let status = {};
  console.time('get local status ' + repo);
  for (let note of notes) {

    status[note] = await sha256sum(await global.notes.readFile(note));
  }
  console.timeEnd('get local status ' + repo);
  return status;
}

async function getLocalNotes(repo) {
  const notes = await global.notes.listFiles();
  return notes.filter(note => note.startsWith(repo + "/"));
}

async function perfChecksum() {
  // perf 10k notes hashed, where notes are from 20-100k bytes.
  console.time('test');
  let array = [];
  for (let i = 0; i < 10 * 1000; ++i) {
    array.push(i);
  }
  await Promise.allSettled(array.map(i => sha256sum((i + '').repeat(20000))));
  console.timeEnd('test');
}

async function perfStatus() {
  console.time('remote status');
  await getRemoteStatus('core');
  console.timeEnd('remote status');

  console.time('local status');
  await getLocalStatus('core');
  console.timeEnd('local status');
}

// SEARCH

// 570ms, then 30ms once cached
function gather_messages() {
  // TODO only rewrite the pages that have changed since the last time we gathered messages
  if (global.notes.flatRead.all_messages === undefined) {
    // rewriting all of the pages takes 500ms ish
    const pages = global.notes.flatRead.metadata_map.map(x => global.notes.rewrite(x.uuid));

    // each page is usually 2 sections, 'entry' and 'METADATA'
    // a page is a list of sections
    // a section is a list of blocks
    const entry_sections = pages.flatMap(p => p.filter(s => s.title === 'entry'))
    const messages = entry_sections.flatMap(s => s.blocks ? s.blocks.filter(m => m instanceof Msg) : []);
    global.notes.flatRead.all_messages = messages;
  }
  return global.notes.flatRead.all_messages;
}

function gather_sorted_messages() {
  // sorting takes 300ms
  // TODO sort by bins?  we should find the notes that are journals and have clear dilineations, and "optimize" the notes.
  // - we should probably do that after we show previous and next days on the same journal, so if the notes gets optimized, it's still legible to the user.
  if (global.notes.flatRead.sorted_messages === undefined) {
    global.notes.flatRead.sorted_messages = gather_messages().sort((a, b) => dateComp(b, a));
  }
  return global.notes.flatRead.sorted_messages;
}

async function search(text, is_case_sensitive=false) {
  if (text === '' || text === null || text === undefined) {
    return [];
  }

  console.time('search total');

  let case_insensitive = (a, b) => a.toLowerCase().includes(b.toLowerCase());
  let case_sensitive = (a, b) => a.includes(b);
  let includes = (is_case_sensitive) ? case_sensitive : case_insensitive;

  let cache_log = console.log;
  console.log = (x) => {};
  
  console.time('search gather msgs');
  let messages = gather_sorted_messages();
  messages = messages.filter(m => includes(m.content, text));
  console.timeEnd('search gather msgs');
  
  console.log = cache_log;

  console.timeEnd('search total');

  return messages;
}

function clamp(value, lower, upper) {
  if (value < lower) {
    return lower;
  }
  if (value > upper) {
    return upper;
  }
  return value;
}

const SEARCH_RESULTS_PER_PAGE = 100;

function renderSearchMain(urlParams, all_messages) {
  let page = urlParams.get('page');
  if (page === 'all') {
    return `<h3>render all ${all_messages.length} results</h3><div class='msglist'>${all_messages.map((x) => htmlMsg(x, 'search')).join("")}</div>`;
  }
  page = (page === null ? 0 : parseInt(page));
  let messages = all_messages.slice(page * SEARCH_RESULTS_PER_PAGE, (page + 1) * SEARCH_RESULTS_PER_PAGE);
  return `<h3>${page * SEARCH_RESULTS_PER_PAGE} to ${(page) * SEARCH_RESULTS_PER_PAGE + messages.length} of ${all_messages.length} results</h3><div class='msglist'>${messages.map((x) => htmlMsg(x, 'search')).join("")}</div>`;
}

function renderSearchPagination(all_messages) {

  // must be global because it captures `all_messages`
  global.handlers.paginate = (delta) => {
    let main = document.getElementsByTagName('main')[0];

    if (delta === 'all') {
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.set('page', 'all');
      window.history.pushState({}, "", "/search/?" + urlParams.toString());
      main.innerHTML = renderSearchMain(urlParams, all_messages);
      return;
    }
    // delta is an integer, probably +1 or -1
    const urlParams = new URLSearchParams(window.location.search);
    const text = urlParams.get('q');
    let page = urlParams.get('page');
    page = (page === null ? 0 : parseInt(page));
    page = clamp(page + delta, /*bottom*/0, /*top*/Math.floor(all_messages.length / SEARCH_RESULTS_PER_PAGE)); // round down to get the number of pages
    window.history.pushState({}, "", "/search/?q=" + encodeURIComponent(text) + "&page=" + page);
    main.innerHTML = renderSearchMain(urlParams, all_messages);
  };
  let pagination = document.getElementById('search-pagination');
  pagination.innerHTML = `
    ${MenuButton({icon: 'next', action: 'return global.handlers.paginate(1)'})}
    ${MenuButton({icon: 'prev', action: 'return global.handlers.paginate(-1)'})}
    ${MenuButton({icon: 'all', action: "return global.handlers.paginate('all')"})}
  `;
}

function runSearch() {
  console.assert(window.location.pathname.startsWith("/search/"));
  const urlParams = new URLSearchParams(window.location.search);
  const text = urlParams.get('q');
  const case_sensitive = urlParams.get('case') === 'true';
  document.title = `Search "${text}" - Pipeline Notes`;

  const has_text = !(text === null || text === undefined || text === '');
  if (has_text && global.notes.flatRead.sorted_messages === undefined) {
    console.log('has text, gathering messages');
    gather_sorted_messages();
  }

  // search footer should already be rendered
  searchResults = search(text, case_sensitive).then(all_messages => {
    let main = document.getElementsByTagName('main')[0];
    main.innerHTML = renderSearchMain(urlParams, all_messages);
    renderSearchPagination(all_messages);
  });
  console.log('checking for text');
  if (!has_text && global.notes.flatRead.sorted_messages === undefined) {
    console.log('no text, gathering messages');
    gather_sorted_messages();
  }
}

async function searchAction(id) {
  id = id || "search_query";
  let text = document.getElementById(id).value;
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set('q', text);
  urlParams.set('page', '0');
  window.history.pushState({}, "", "/search/?" + urlParams.toString());

  runSearch();
}

async function renderSearchFooter() {
  const urlParams = new URLSearchParams(window.location.search);
  const text = urlParams.get('q') || '';
  let menu = `
    ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
    ${TextAction({id: 'search_query', label: lookupIcon('search'), value: text, action: 'searchAction', everykey: true})}
    <br/>
    <div id='search-pagination'></div>
    <div id='search-options'>
    ${await ToggleButton({id: "case-sensitive-enabled", label: lookupIcon("case"), file: SEARCH_CASE_SENSITIVE_FILE, query_param: "case", default_value: "true", rerender: 'searchAction'})}
    </div>
  `;
  return menu;
}

async function gotoSearch() {
  console.log('goto /search/');
  let footer = document.getElementsByTagName('footer')[0];
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set('case', await readBooleanFile(SEARCH_CASE_SENSITIVE_FILE, "true"));
  window.history.pushState({}, "", "/search/?" + urlParams.toString());
  footer.innerHTML = await renderSearchFooter();
  document.getElementById('search_query')?.focus();
  if (urlParams.get('q') !== null) {
    runSearch();
  } else {
    document.getElementsByTagName('main')[0].innerHTML = ``;
    setTimeout(() => {
      gather_sorted_messages();
    }, 100);
  }
  return false;
}

// COMPONENT MENU BUTTON

function MenuButton({icon, action}) {
  return `<button class='menu-button' id='${icon}_button' onclick="${action}">${lookupIcon(icon)}</button>`;
}

// COMPONENT TEXTFIELD

// used for first time setup and setup configuration
async function handleTextField(event, id, file_name, rerender) {
  if (event === true || event.key === 'Enter') {
    let text = document.getElementById(id).value;
    await cache.writeFile(file_name, text);

    paintSimple(await rerender());
    return false;
  }
};

function TextField({id, file_name, label, value, rerender}) {
  return (
    `<input onkeydown="return handleTextField(event, '${id}', '${file_name}', ${rerender})" type='text' id='${id}' value="${value}"></input>
    <button class='menu-button' id='${id}_button' onclick="return handleTextField(true, '${id}', '${file_name}', ${rerender})">${label}</button>`
  );
}

async function handleTextAction(event, source_id, action, everykey) {
  if (everykey) {
    await action(source_id);
    return true;
  }
  if (event === true || event.key === 'Enter') {
    await action(source_id);
    return false;
  }
};

function TextAction({id, label, value, action, everykey}) {
  return (
    `<input onkeyup="return handleTextAction(event, '${id}', ${action}, ${!!everykey})" type='text' id='${id}' value="${value}"></input>
    <button class='menu-button' id='${id}_button' onclick="return handleTextAction(true, '${id}', ${action})">${label}</button>`
  );
}

// COMPONENT TOGGLE-BUTTON

async function toggleBooleanFile(file, default_value) {
  return await cache.updateFile(file, (state) => {
    if (state === null) {
      state = default_value;
    }
    return state === "true" ? "false" : "true";
  });
}

async function readBooleanFile(file, default_value) {
  return await cache.updateFile(file, (state) => {
    if (state === null) {
      state = default_value;
    }
    return state;
  });
}

async function handleToggle(event, id, file, query_param, default_value, rerender) {
  let indexedDB_result = undefined;
  if (file) {
    indexedDB_result = await toggleBooleanFile(file, default_value);
  }

  if (query_param && indexedDB_result) {
    setBooleanQueryParam(query_param, indexedDB_result);
  } else if (query_param) {
    toggleBooleanQueryParam(query_param, default_value);
  }
  if (rerender) {
    let result = await rerender();
    if (result && result.length === 2) {
      paintSimple(result);
    }
  }

  if (indexedDB_result === "true") {
    event.target.classList.add('enabled');
  } else {
    event.target.classList.remove('enabled');
  }

  return false;
}

function readBooleanQueryParam(query_param, default_value) {
  const urlParams = new URLSearchParams(window.location.search);
  const param = urlParams.get(query_param);
  if (param === null) {
    return default_value;
  }
  return param === 'true';
}

function toggleBooleanQueryParam(query_param, default_value) {
  const urlParams = new URLSearchParams(window.location.search);
  const param = urlParams.get(query_param);
  if (param === null) {
    urlParams.set(query_param, default_value);
  } else {
    urlParams.set(query_param, param === 'true' ? 'false' : 'true');
  }
  window.history.pushState({}, "", window.location.pathname + "?" + urlParams.toString());
  return urlParams.get(query_param);
}

function setBooleanQueryParam(query_param, value) {
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set(query_param, value);
  window.history.pushState({}, "", window.location.pathname + "?" + urlParams.toString());
  return urlParams.get(query_param);
}

async function ToggleButton({id, label, file, query_param, default_value, rerender}) {
  let status = undefined;
  if (file) {
    status = await readBooleanFile(file, default_value);
  }
  if (query_param) {
    // NOTE it seems like a good idea to only use the indexedDB status, so the line below is commented out.
    // - we might want to read the query param if we're loading a link.
    // status = await readBooleanQueryParam(query_param, default_value);
  }

  let enabled = "";
  if (status === 'true') {
    enabled = " enabled";
  }
  return (
    `<button id="${id}" onclick="return handleToggle(event, '${id}', '${file}', '${query_param}', '${default_value}', ${rerender})" class='menu-button${enabled}'>${label}</button>`
  );
}

// SETUP

const colorize_repo = (repo) => `<span style="color: #ffcc55; font-family: monospace">${repo}</span>`;

async function renderSetup() {

  // TODO allow renaming local repo?
  let add_links = '<div style="margin: 10px">Please set a local repo name to continue.</div>';
  let local_repo_name_message = 'Local repo name is unset.';
  let local_repo_name = await cache.readFile(LOCAL_REPO_NAME_FILE);
  if (local_repo_name === null) {
    local_repo_name = '';
  }
  if (local_repo_name.length > 0) {
    if (global.notes === undefined) {
      global.notes = await buildFlatCache();
    }
    local_repo_name_message = `Local repo name is ${colorize_repo(local_repo_name)}`;
    add_links = `
    ${MenuButton({icon: 'menu', action: 'gotoMenu()'})}
    ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
    `;
  }

  const welcome_splash = `<div>
  <h3>Welcome to Pipeline!</h3>
  <p>This is the June 2nd, 2024 version of Pipeline Notes, version ${tag_color('1.2')}.</p>
  <p>Changelog, roadmap, and tutorial coming soon!</p>
  <p>For now, make a ${tag_color('J')}ou${tag_color('RNL')} for each day, ${tag_color('S')}ea${tag_color('RCH')} your notes, and ${tag_color('LIST')} them out.</p>
  </div>`;

  const setup_splash = `<div>
  <h3>Setup</h3>
  <p>Set up your local repo name to get started.</p>
  <p>A good local repo name is your first name, optionally with the name of your device.</p>
  </div>`

  let splash = local_repo_name.length > 0 ? welcome_splash : setup_splash;

  return [
    `<div style="margin: 10px">
       ${TextField({id: 'local_repo_name', file_name: LOCAL_REPO_NAME_FILE, rerender: 'renderSetup', value: local_repo_name, label: 'set local repo name'})}
       </div>
       <p>${local_repo_name_message}</p>
     ${splash}
     <a id='cert-button' href="/pipeline-cert.pem" download style="margin: 10px">download self-signed client certificate</a>
     `,
    add_links
  ];
}

async function gotoSetup() {
  paintSimple(await renderSetup());
  window.history.pushState({},"", "/setup");
}

// MENU

async function gotoMenu() {
  paintSimple(await renderMenu());
  window.history.pushState({},"", "/menu");
}

async function gotoNewNote(id) {
  let text = document.getElementById(id).value;
  let uuid = await newNote(text);
  await gotoDisc(uuid);
}

const tag_color = (x) => `<span style="color: var(--link_button_main_color)">${x}</span>`

async function clearServiceWorkerCaches() {
  if ('serviceWorker' in navigator) {
    caches.keys().then(function(cacheNames) {
      cacheNames.forEach(function(cacheName) {
        console.log('deleting', cacheName, 'from', caches);
        caches.delete(cacheName);
      });
    });
  }
  return false;
}

async function renderMenu() {
  return [
    `${TextAction({id: 'new_note', label: lookupIcon('new note'), value: '', action: 'gotoNewNote'})}
    <br/>
    ${MenuButton({icon: 'routine', action: 'gotoRoutine()'})}
    <br/>
    <div>
      <p> Advanced Debugging Tools: </p>
      <ul>
      <li><button class='menu-button' id="clear-cache-button" onclick="return clearServiceWorkerCaches();">clear service worker cache</button></li>
      </ul>
    </div>`,
    `<div>
      ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
      ${MenuButton({icon: 'list', action: 'gotoList()'})}
      ${MenuButton({icon: 'search', action: 'gotoSearch()'})}
      ${MenuButton({icon: 'sync', action: 'gotoSync()'})}
      ${MenuButton({icon: 'setup', action: 'gotoSetup()'})}
    </div>`
  ];
}

// ICONS

function lookupIcon(full_name) {
  return {
    'search': 'SRCH',
    'sync': 'SYNC',
    'setup': 'SETP',
    'journal': 'JRNL',
    'edit': 'EDIT',
    'list': 'LIST',
    'menu': 'MENU',
    'mix': 'MIX_',
    'focus': 'FOCS',
    'next': 'NEXT',
    'prev': 'PREV',
    'all': 'ALL_',
    'submit': 'SUBM',
    'back': 'BACK',
    'routine': 'RTNE',
    'new note': 'NEW_',
    'notes': "NOTE",
    'case': "CASE"
  }[full_name];
}

// ROUTINE

async function gotoRoutine() {
  paintSimple(await renderRoutine());
  window.history.pushState({},"", "/routine");
}

async function routineContent() {
  const local_repo_name = global.notes.local_repo_name();
  const notes = global.notes.flatRead.metadata_map;
  const routine_notes = notes.filter(note => note.title === "ROUTINE");

  let content = "no routine notes found";
  let is_local_routine = false;
  if (routine_notes.length > 0) {
    const most_recent_routine_note = routine_notes.sort((a, b) => dateComp(b, a))[0];
    is_local_routine = most_recent_routine_note.uuid.startsWith(local_repo_name + "/");

    let page = parseContent(most_recent_routine_note.content);
    page = rewrite(page, most_recent_routine_note.uuid);
    let maybe_current_journal = global.notes.getNotesWithTitle(today(), local_repo_name);
    if (maybe_current_journal.length === 0) {
      return "no journal found for today";
    }
    let current_journal = maybe_current_journal[0];
    const tags = await getTagsFromMixedNote(current_journal);

    const error = (msg, obj) => {
      console.log(msg, obj);
      return `<div><h3>${msg}</h3><pre>` + JSON.stringify(obj, undefined, 2) + "</pre></div>"
    };

    const renderRoutineSection = (section) => {
      if (section.blocks === undefined) {
        return error("expected section to have blocks", section);
      }
      if (section.blocks.length === 0) {
        return section;
      }
      return section.blocks.map(block => {
        if (block instanceof Array) {
          const renderRoutineValue = (v) => {
            if (tags.map(t => t.tag).includes(v)) {
              return `<span style="color: var(--tag_color)">${v}</span>`;
            }
            return `<span>${v}</span>`;
          }
          const renderRoutineBlockItem = element => {
            if (element instanceof TreeNode) {
              const renderRoutineNode = (x) => {
                if (x.children.length === 0) {
                  return renderRoutineValue(x.value);
                }
                return `${renderRoutineValue(x.value)}<ul>${x.children.map(c => "<li>" +  renderRoutineNode(c) + "</li>").join("")}</ul>`;
              };
              return `<div class="routine-block">${renderRoutineValue(element.value)} <ul>${element.children.map(c => "<li>" + renderRoutineNode(c) + "</li>").join("")}</ul></div>`;
            }
            if (typeof element === 'string') {
              return renderRoutineValue(element);
            } 
            return error('unimpl element', element);
          };

          if (block.length !== 1) {
            // return error('array of len ' + block.length, block);
            return block.map(renderRoutineBlockItem).join("<br>") + "<br>";
          }
          
          let [element] = block;
          return renderRoutineBlockItem(element);
        }
        if (block instanceof EmptyLine) {
          return '';
        }
        return error('unimpl block', block);
      }).join("");
    };

    page = page.filter(section => section.title == "ROUTINE").map(renderRoutineSection);
    content = page.join("\n") + `<br><br>`;
    if (is_local_routine) {
      let edit_action = `gotoEdit('${most_recent_routine_note.uuid}')}`;
      content += `<div style="display: flex; justify-content: end;">${MenuButton({icon: 'edit', action: edit_action})}</div>`;
    }
  }
  return content;
}

async function renderRoutine() {
  let content = await routineContent();
  
  return [
    `<div>
      <h3>routine</h3>
      ${content}
    </div>`,
    `
    ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
    ${MenuButton({icon: 'menu', action: 'gotoMenu()'})}
    `
  ];
}

async function getTagsFromMixedNote(uuid) {
  let page = await mixPage(uuid);
  return page
    .flatMap(s => s.blocks?.filter(x => x instanceof Msg))  // get all messages from every section
    .filter(x => x)  // filter away sections that didn't have blocks
    .flatMap(x => x.msg.filter(p => p instanceof Tag));  // get all tags from every message
}

// MAIN

const cache = new FileDB("pipeline-db-cache", "cache");

async function getJournalUUID() {
  global.notes.rebuild();  // sync before we make a new journal to make sure another tab didn't make one.
  let notes = global.notes.getNotesWithTitle(today(), global.notes.local_repo_name());
  if (notes.length === 0) {
    let uuid = await newJournal(today());
    notes = [uuid];
    await global.notes.rebuild();
    // TODO maybe we only want to do a full update of the cache on sync, hmm.  nah, it seems like it should be on every database operation, for _consistency_'s (ACID) sake.
  }
  return notes[0];
}

async function gotoJournal() {
  let uuid = await getJournalUUID();
  await gotoDisc(uuid);
}

window.addEventListener("popstate", (event) => {
  console.log(
    `location: ${document.location}, state: ${JSON.stringify(event.state)}`,
  );
  handleRouting();
});

// may return null iff not /edit/ or /disc/
function getCurrentNoteUuid() {
  // console.log("getting note uuid from path", window.location.pathname);

  if (window.location.pathname.startsWith('/disc/')) {
    let uuid = window.location.pathname.slice("/disc/".length);
    return uuid;
  } else if (window.location.pathname.startsWith('/edit/')) {
    let uuid = window.location.pathname.slice("/edit/".length);
    return uuid;
  }
  return null;
}

async function handleRouting() {
  console.log("notes that match today's date:", global.notes.getNotesWithTitle(today(), global.notes.local_repo_name()));
  console.log("initializing from path", window.location.pathname);

  if (window.location.pathname.startsWith('/disc/')) {
    paintDisc(getCurrentNoteUuid());

  } else if (window.location.pathname.startsWith('/edit/')) {
    paintEdit(getCurrentNoteUuid());

  } else if (window.location.pathname.startsWith('/list')) {
    paintList();

  } else if (window.location.pathname.startsWith('/sync')) {
    paintSimple(await renderSync());

  } else if (window.location.pathname.startsWith('/search')) {
    document.getElementsByTagName("footer")[0].innerHTML = await renderSearchFooter();
    runSearch();
  } else if (window.location.pathname.startsWith('/setup')) {
    paintSimple(await renderSetup());

  } else if (window.location.pathname.startsWith('/menu')) {
    paintSimple(await renderMenu());
  
  } else if (window.location.pathname.startsWith('/routine')) {
    paintSimple(await renderRoutine());

  } else if (window.location.pathname.startsWith('/today')) {
    await gotoJournal();

  } else {
    await gotoJournal();
  }
}

async function perf(func) {
  console.time('perf');
  await func();
  console.timeEnd('perf');
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register("/service-worker.js", {
        scope: "/",
      });
      if (registration.installing) {
        console.log("Service worker installing");
      } else if (registration.waiting) {
        console.log("Service worker installed");
      } else if (registration.active) {
        console.log("Service worker active");
      }

      navigator.serviceWorker.addEventListener("message", (event) => {
        console.log(event.data);
      });
    } catch (error) {
      console.error(`Registration failed with ${error}`);
    }
  }
}

async function run() {
  console.log('attempting to register service worker');
  registerServiceWorker();

  const reloadNecessary = () => {
    alert("Database is outdated, please reload the page.");
    // document.location.reload();
    document.getElementsByTagName("body")[0].innerHTML = `Database is outdated, please <button class='menu-button' id='reload-button' onclick="window.location.reload(); return false;">reload the page</button>.`;
  }
  
  await global_notes.init(reloadNecessary);
  await cache.init(reloadNecessary);
  
  global = {};
  global.handlers = {};
  global.notes = await buildFlatCache();
  console.log('today is', today());

  await handleRouting();
}
