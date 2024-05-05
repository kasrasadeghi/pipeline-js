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


        this.db.createObjectStore(this.storeName, { keyPath: "path" });
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
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName]);
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(path);

      request.onsuccess = () => resolve(request.result ? request.result.content : null);
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
}

// GLOBALS

const global_notes = new FileDB();

global = null;
const LOCAL_REPO_NAME_FILE = "local_repo_name";
const SUBBED_REPOS_FILE = "subbed_repos";

// GENERAL UTIL

function paintSimple(render_result) {
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

function timezoneCompatibility(datestring) {
  // old dates look like: Wed Jan 17 22:02:44 PST 2024
  // new dates look like: Thu Jan 17 2024 22:02:44 GMT-0800 (Pacific Standard Time)
  // NB: they end in ')'
  if (datestring.endsWith(")")) {
    return datestring; // no compatibility needed
  }

  const compatibility_timezones = {
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
  }
  let chunks = datestring.split(" ").filter(x => x !== '');
  console.assert(chunks.length == 6, chunks, "datestring should have 6 chunks: weekday, month, monthday, time, timezone, year");
  let time = chunks[3];
  let timezone = chunks[4];
  console.assert(timezone in compatibility_timezones, timezone, "timezone should be in compatibility_timezones, from", datestring, compatibility_timezones);
  let year = chunks[5];
  let new_chunks = chunks.slice(0, 3);  // first three are the same.
  new_chunks.push(year, time, compatibility_timezones[timezone]);
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
Date: ${new Date()}
Title: ${title}`;
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  let uuid = (await get_local_repo_name()) + '/' + crypto.randomUUID() + '.note';
  await global_notes.writeFile(uuid, content);
  return uuid;
}

async function newJournal(title) {
  let content = `--- METADATA ---
Date: ${new Date()}
Title: ${title}
Tags: Journal`;
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  let uuid = (await get_local_repo_name()) + '/' + crypto.randomUUID() + '.note';
  await global_notes.writeFile(uuid, content);
  return uuid;
}

function parseMetadata(note_content) {
  const lines = note_content.split("\n");
  const metadata_lines = lines.slice(lines.indexOf("--- METADATA ---") + 1);
  let metadata = {};
  metadata_lines.forEach(line => {
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

function today() {
  const today = new Date();
  const year = today.getFullYear();

  const month = today.toLocaleString('en-us', { month: "long" });
  const day = today.getDate();

  const day_suffix =
      [11, 12, 13].includes(day) ? 'th'
    : day % 10 === 1 ? 'st'
    : day % 10 === 2 ? 'nd'
    : day % 10 === 3 ? 'rd'
    : 'th';

  return `${month} ${day}${day_suffix}, ${year}`;
}

async function getNoteMetadataMap() {
  const blobs = await global_notes.readAllFiles();
  return blobs.map(blob => {
    let metadata = null;
    try {
      metadata = parseMetadata(blob.content);
    } catch (e) {
      console.log('broken metadata', blob.path, e);
      metadata = {Title: "broken metadata", Date: `${new Date()}`};
    }
    return {uuid: blob.path, title: metadata.Title, date: metadata.Date, content: blob.content};
  });
}

async function getNotesWithTitle(title, repo) {
  const files_with_names = await getNoteMetadataMap();
  return files_with_names.filter(note => note.uuid.startsWith(repo + "/") && note.title === title).map(note => note.uuid);
}

async function getAllNotesWithSameTitleAs(uuid) {
  const files_with_names = await getNoteMetadataMap();
  let title = files_with_names.find(note => note.uuid == uuid).title;
  return files_with_names.filter(note => note.title === title);
}

// PARSE

async function parseFile(filepath) {
  let content = await global_notes.readFile(filepath);
  if (content === null) {
    return null;
  }
  return parseContent(content);
}

function parseContent(content) {
  // EXPL: a page is a list of sections, which each have a title and a list of blocks
  // - a block is a list of nodes
  // - a node can be either a line of type 'str', or a parsed tree
  let sections = [{title: 'entry', lines: []}];
  for (let L of content.split("\n")) {
    if (L.startsWith("--- ") && L.endsWith(" ---") && L.length > 9) {
      sections.push({title: L.slice(4, -4), lines: []});
    } else {
      // console.log('append ', L, 'to section', sections);
      sections.slice(-1)[0].lines.push(L);
    }
  }

  for (let S of sections) {
    if (! ['METADATA', 'HTML'].includes(S.title)) {
      S.blocks = parseSection(S.lines);
      delete S.lines;
    }
  }
  return sections;
}

function parseSection(lines) {
  let blocks = [];
  for (let L of lines) {
    if (L === '') {
      blocks.push([])
    } else {
      // TODO what?  if there are no blocks or if the last block is a newline, add another one?
      if (blocks.length === 0
      //|| blocks.slice(-1).length === 0
      ) {
        blocks.push([])
      }
      blocks.slice(-1)[0].push(L)
    }
  }
  return blocks.map(parseTree);
}

class TreeNode {
  constructor(obj) {
    this.children = [];
    this.indent = obj.indent;
    this.value = obj.value;
  }

  toString() {
    let indent = this.indent == -1 ? "" : "- " + "  ".repeat(this.indent);
    return indent + htmlLine(this.value) + "\n" + this.children.map(x => x.toString()).join("");
  }
}

function parseTree(block) {
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
    if (block.length === 0) {  // TODO i should maybe actually render blocks like [] as newlines
      continue;
    }
    new_blocks.push(rewriteBlock(block, note));
  }

  // push blocks that aren't messages onto messages
  let blocks = new_blocks;
  new_blocks = [];
  for (let block of blocks) {
    let not_msg = !(block instanceof Msg);
    let prev_back = new_blocks.slice(-1);
    let prev_is_msg = prev_back.length === 1 && prev_back[0] instanceof Msg;
    if (not_msg && prev_is_msg) {
      prev_back[0].blocks.push(block);
    } else {
      new_blocks.push(block);
    }
  }

  section.blocks = new_blocks;
  return section;
  // return rewriteDiscSection(section, isJournal);
}

// function rewriteDiscSection(section, isJournal) {
//   let disc_section = section.title === 'DISCUSSION';
//   let journal_disc_section = (section.title === 'entry' && isJournal);

//   if (! (disc_section || journal_disc_section)) {
//     return section;
//   }

//   let roots = [{roots: 'pre_roots', children: []}];
//   for (let block of section.blocks) {

//   }
// }

class Msg {
  msg;
  content;
  date;
  origin;
  blocks;
  constructor(properties) {
    console.assert(['content', 'date', 'msg', 'origin'].every(x => Object.keys(properties).includes(x)), properties, 'huh');
    Object.assign(this, properties);
    this.blocks = [];
  }
}

class Newline {
  constructor() {}
}

function rewriteBlock(block, note) {
  if (block.length === 0) { // newline
    return new Newline();
  }
  if (block.length === 1) {
    try {
      // console.log('rewrite block', block);
      let item = block[0];
      if (item instanceof Object && 'value' in item && item.value.startsWith("msg: ") && item.indent === 0 && item.children.length === 1) {
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
  constructor(url) {
    this.url = url;
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
      let head_dash = (line[i] === '-' || line[i] === '_');
      let intermediate_dash = head_dash && (i + 1 > line.length && isUpperCase(line[i+1]));
      while (i < line.length && (isUpperCase(line[i]) || intermediate_dash)) {
        uppercase_prefix += line[i++];
      }

      if (uppercase_prefix.length < 2) {
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
  let content = await global_notes.readFile(filepath);
  if (page === null) {
    return `couldn't find file '${uuid}'`;
  }
  return htmlNoteContent(uuid, content);
}

function htmlNoteContent(uuid, content) {
  console.assert(content !== null, content, 'content should not be null');
  let page = parseContent(content);
  let rewritten = rewrite(page, uuid);
  let rendered = rewritten.map(htmlSection).join("\n");
  return "<div class='msglist'>" + rendered + "</div>";
}

function htmlSection(section, i) {
  output = []
  if (! ('entry' === section.title && i === 0)) {
    output.push(`--- ${section.title} ---`)
  }
  if (['METADATA', 'HTML'].includes(section.title)) {
    output.push(...section.lines);
    return "<pre>" + output.join("\n") + "</pre>";
  }

  if (section.blocks.length === 0) {
    return '\n';
  }

  output.push(...section.blocks.map(htmlBlock))

  return output.join("\n");
}

function htmlBlock(block) {
  if (block instanceof Msg) {
    return htmlMsg(block);
  }
  if (block instanceof Newline) {
    return "<br/>";
  }
  return htmlTextBlock(block);
}

function htmlTextBlock(block) {
  if (block instanceof Array) {
    if (block[0] == 'QUOTE') {
      return "<blockquote>" + block.slice(1).map(x => "<p>" + htmlLine(x) + "</p>").join("") + "</blockquote>";
    }
    return "<pre>" + block.map(htmlLine).join("\n") + "</pre>";
  }
  if (block instanceof TreeNode) {
    return `<pre>` + block.toString() + `</pre>`;
  }
  return JSON.stringify(block, undefined, 2);
}

// date timestamp, like hh:mm:ss in 24-hour clock
const timestamp_format = new Intl.DateTimeFormat('en-us', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// datetime format for "search" mode, like "Wed, Jan 15, hh:mm:ss" in 24-hour clock
const datetime_format = new Intl.DateTimeFormat('en-us', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// datetime format for "search" mode with year, like "Wed, Jan 15 2024, hh:mm:ss" in 24-hour clock
const datetime_year_format = new Intl.DateTimeFormat('en-us', { year: "numeric", month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function htmlMsg(item, mode) {

  let date = Date.parse(timezoneCompatibility(item.date));
  let now = new Date();

  let time_format = timestamp_format;
  if (mode === 'search') {
    time_format = datetime_format;
    if (now.getFullYear() !== new Date(date).getFullYear()) {
      time_format = datetime_year_format
    }
  }
  
  let timestamp_content = time_format.format(date)
    .replaceAll(",", ""); // "Wed, Jan 15, hh:mm:ss" -> "Wed Jan 15 hh:mm:ss"
  let href_id = `/disc/${item.origin}#${item.date}`;
  let msg_timestamp_link = ShortcircuitLink(href_id, timestamp_content, 'msg_timestamp');

  let line = htmlLine(item.msg);
  let style_option = "";
  if (item.origin !== getCurrentNoteUuid()) {
    style_option = " style='background: #5f193f'";
  }

  return (`
    <div class='msg' id='${item.date}'>
      <div class="msg_menu">${msg_timestamp_link} ${item.origin.split('/')[0]}</div>
      <div class="msg_content"${style_option}>${line}</div>
    </div>
    ${item.blocks.map(block => htmlTextBlock(block)).join("<br/>")}`
  )
}

function ShortcircuitLink(url, text, style_class) {
  let style_class_include = "";
  if (style_class !== undefined) {
    style_class_include = `class='${style_class}'`;
  }
  return `<a ${style_class_include} onclick="window.history.pushState({}, '', '${url}'); handleRouting(); return false;" href="${url}">${text}</a>`;
}

function htmlLine(line) {
  if (line instanceof Array) {
    return line.map(x => {
      if (x instanceof Tag) {
        return "<emph class='tag'>" + x.tag + "</emph>";
      }
      if (x instanceof Link) {
        let rendered = x.url;
        if (x.url.startsWith("http://") || x.url.startsWith("https://")) {
          rendered = rendered.slice(rendered.indexOf('://') + '://'.length);
        }
        const reddit_share_tail = "?utm_source=share&utm_medium=mweb3x&utm_name=mweb3xcss&utm_term=1&utm_content=share_button";
        if (rendered.endsWith(reddit_share_tail)) {
          rendered = rendered.slice(0, -reddit_share_tail.length);
        }
        if (rendered.startsWith(window.location.host)) {
          rendered = rendered.slice(window.location.host.length);
          rendered = decodeURI(rendered);

          return ShortcircuitLink(x.url, rendered);
        }
        return `<a href="${x.url}">${rendered}</a>`
      }
      return x;
    }).join("");
  }
  console.log('huh', line);
  return line;
}

// DISC

const MIX_FILE = 'disc mix state';

async function paintDisc(uuid, flag) {
  let main = document.getElementsByTagName('main')[0];
  let footer = document.getElementsByTagName('footer')[0];
  if (flag === 'only main') {
    main.innerHTML = (await renderDisc(uuid))[0];
  } else {
    [main.innerHTML, footer.innerHTML] = await renderDisc(uuid);
    setTimeout(() => {
      document.getElementById('msg_input')?.focus();
    }, 0);
  }
  const selected = updateSelected();
  if (selected === null) {
    main.scrollTop = main.scrollHeight;
  } else {
    selected.scrollIntoView();
  }
}

async function renderDiscMixedBody(uuid) {
  let page = await parseFile(uuid);
  if (page === null) {
    return `couldn't find file '${uuid}'`;
  }
  let current_page = rewrite(page, uuid);

  // notes that share our title
  let sibling_notes = await getAllNotesWithSameTitleAs(uuid);
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

  let current_entry_section = current_page.filter(section => section.title === 'entry')[0];
  current_entry_section.blocks = new_blocks;

  let rendered = current_page.map(htmlSection).join("\n");
  return "<div class='msglist'>" + rendered + "</div>";
}

async function renderDisc(uuid) {
  const displayState = (state) => { document.getElementById('state_display').innerHTML = state; };

  global.handlers = {};

  const has_remote = await hasRemote();
  let mix_state = "false";
  let mix_button = '';
  if (has_remote) {
    mix_state = await cache.readFile(MIX_FILE);
    if (mix_state === null) {
      mix_state = "false";
      await cache.writeFile(MIX_FILE, mix_state);
    }
    global.handlers.mix = async () => {
      console.log('actually swapping mix state');
      // toggle mix state in the file
      await cache.writeFile(MIX_FILE, (await cache.readFile(MIX_FILE)) === "true" ? "false" : "true");
      await paintDisc(uuid);
      return false;
    };
    mix_button_value = mix_state === 'true' ? lookupIcon('focus') : lookupIcon('mix');
    mix_button = `<button class='menu-button' onclick="return global.handlers.mix(event)">${mix_button_value}</button>`;
  }

  console.log('mix state', mix_state);
  let rendered_note = '';
  if (mix_state === "true") {
    rendered_note = await renderDiscMixedBody(uuid);
  } else {
    rendered_note = await htmlNote(uuid);
  }

  let msg_form = "";
  let edit_button = "";
  if (uuid.startsWith(await get_local_repo_name())) {
    global.handlers.handleMsg = async (event) => {
      console.log(event);

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
      if (msg.trim().length > 0) {
        console.log('msg', msg);
        msg_input.innerText = '';

        let content = await global_notes.readFile(uuid);
        let lines = content.split("\n");
        const content_lines = lines.slice(0, lines.indexOf("--- METADATA ---"));
        const metadata_lines = lines.slice(lines.indexOf("--- METADATA ---"));
        const old_content = content_lines.join("\n");
        const metadata = metadata_lines.join("\n");

        const new_content = old_content + `\n- msg: ${msg}\n  - Date: ${new Date}\n\n`;
        await global_notes.writeFile(uuid, new_content + metadata);

        await paintDisc(uuid, 'only main');
      }

      let repos = await getRepos();
      let combined_remote_status = await getRemoteStatus(repos.join(","));
      displayState("syncing...");
      await pullRemoteSimple(combined_remote_status);
      
      // don't paint after syncing as it is quite disruptive as sync is sometimes slow (500ms)
      // await paintDisc(uuid, 'only main'); 

      displayState("done");
      await pushLocalSimple(combined_remote_status);
      return false;
    };

    msg_form = `<div
      onkeydown="return global.handlers.handleMsg(event);"
      id="msg_input"
      class="msg_input"
      aria-describedby=":r4u:"
      aria-label="Message"
      contenteditable="true"
      role="textbox"
      tabindex="0" 
      style="user-select: text; white-space: pre-wrap; word-break: break-word;"
      data-lexical-editor="true"><br></div>`
    
    // msg_form += `<form id="msg_form" onsubmit="return global.handlers.handleMsg(event)">
    //   <input id="msg_input" class="msg_input" autocomplete="off" autofocus="" type="text" name="msg">
    // </form>`;
    edit_button = `<button class='menu-button' onclick="gotoEdit('${uuid}')">${lookupIcon('edit')}</button>`;
  }

  return [
    rendered_note,
    `${msg_form}
    <div>
      ${edit_button}
      <button class='menu-button' onclick="gotoList()">${lookupIcon('list')}</button>
      <button class='menu-button' onclick="gotoJournal()">${lookupIcon('journal')}</button>
      <button class='menu-button' onclick="gotoSearch()">${lookupIcon('search')}</button>
      <button class='menu-button' onclick="gotoMenu()">${lookupIcon('menu')}</button>
      ${mix_button}
    </div>
    <div id='state_display'></div>`
  ];
}

async function gotoDisc(uuid) {
  window.history.pushState({},"", "/disc/" + uuid);
  paintDisc(uuid);
  return false;
}

// EDIT

async function paintEdit(uuid) {
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

async function renderEdit(uuid) {
  console.log('rendering /edit/ for ', uuid);
  let content = await global_notes.readFile(uuid);
  if (content === null) {
    return `couldn't find file '${uuid}'`;
  }
  const submitEdit = async () => {
    let textarea = document.getElementsByTagName('textarea')[0];
    let content = textarea.value.split("\r\n").join("\n");  // dos2unix because textarea.value is dos by default
    await global_notes.writeFile(uuid, content);
    gotoDisc(uuid);
  };
  global.handlers = {submitEdit};
  return [
    `<textarea class='editor_textarea'>` + content + "</textarea>",
    `<button class='menu-button' onclick="global.handlers.submitEdit()">${lookupIcon('submit')}</button>
     <button class='menu-button' onclick="gotoDisc('${uuid}')">${lookupIcon('back')}</button>`
  ];
}

// LIST

async function gotoList() {
  window.history.pushState({}, "", "/list");
  let painted = paintSimple(await renderList());
  painted.main.scrollTop = 0;
}

async function renderList() {
  let rows = (await getNoteMetadataMap()).sort((a, b) => dateComp(b, a)).map(x => `<tr><td>${x.uuid.split('/')[0]}</td><td><a href="/disc/${x.uuid}">${x.title}</a></td></tr>`).join("\n");
  let table = "<table><tr><th>repo</th><th>title</th></tr>" + rows + "</table>";
  return [
    table,
    `<button class='menu-button' onclick="gotoJournal()">${lookupIcon('journal')}</button>`
  ];
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
  console.log('enable highlight-selected');

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
  if (! (await cache.exists(SYNC_REMOTE_FILE))) {
    await cache.writeFile(SYNC_REMOTE_FILE, '');
  }
  return cache.readFile(SYNC_REMOTE_FILE);
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
    return `<button class='menu-button' onclick="gotoSync()">${lookupIcon('sync')}</button>`;
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
  if (! (await cache.exists(SYNC_FILE))) {
    await cache.writeFile(SYNC_FILE, '{}');
  }

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
    <button class='menu-button' onclick="gotoList()">${lookupIcon('list')}</button>
    <button class='menu-button' onclick="gotoSetup()">${lookupIcon('setup')}</button>
    <button class='menu-button' onclick="gotoJournal()">${lookupIcon('journal')}</button>
  </div>
  `]
}

async function fetchNotes(repo, uuids) {
  // can either be single note: <repo>/<uuid>
  // or multiple: <repo>/<uuid>(/<uuid>)*
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
    remote_status = combined_remote_status[repo];
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
  await Promise.all(remotes.map(async subscribed_remote =>
    await pullRemoteNotes(subscribed_remote, /*dry run*/false, combined_remote_status)));
}

async function pushLocalSimple(combined_remote_status) {
  let [local, ...ignored_remotes] = await getRepos();
  await pushLocalNotes(local, /*dry run*/false, combined_remote_status);
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
    remote_status = combined_remote_status[repo];
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
    body: await global_notes.readFile(note), // body data type must match "Content-Type" header
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
  const encoder = new TextEncoder('utf-8');
  const bytes = encoder.encode(input_string);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return hashToString(hash);
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

async function getLocalStatus(repo) {
  const notes = await getLocalNotes(repo);
  let status = {};
  for (let note of notes) {
    status[note] = await sha256sum(await global_notes.readFile(note));
  }
  return status;
}

async function getLocalNotes(repo) {
  const notes = await global_notes.listFiles();
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

async function search(text) {
  if (text === '' || text === null || text === undefined) {
    return [];
  }
  let notes = await getNoteMetadataMap();
  let cache_log = console.log;
  console.log = (x) => {};
  let filtered_notes = notes.filter(note => note.content.includes(text));  // first pass filter without parsing using a hopefully fast impl-provided string-includes.
  let pages = filtered_notes.map(note => rewrite(parseContent(note.content), note.uuid));

  let messages = [];
  console.log = cache_log;

  pages.forEach(sections =>
    sections.filter(s => s.blocks).forEach(section =>
      section.blocks.filter(b => b instanceof Msg && b.content.includes(text)).forEach(message =>
        messages.push(message))));

  messages.sort((a, b) => dateComp(b, a));
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

function renderSearchMain(all_messages) {
  let main = document.getElementsByTagName('main')[0];
  const urlParams = new URLSearchParams(window.location.search);
  let page = urlParams.get('page');
  if (page === 'all') {
    main.innerHTML = `<h3>render all ${all_messages.length} results</h3><div class='msglist'>${all_messages.map((x) => htmlMsg(x, 'search')).join("")}</div>`;
    return;
  }
  page = (page === null ? 0 : parseInt(page));
  let messages = all_messages.slice(page * SEARCH_RESULTS_PER_PAGE, (page + 1) * SEARCH_RESULTS_PER_PAGE);
  main.innerHTML = `<h3>${page * SEARCH_RESULTS_PER_PAGE} to ${(page) * SEARCH_RESULTS_PER_PAGE + messages.length} of ${all_messages.length} results</h3><div class='msglist'>${messages.map((x) => htmlMsg(x, 'search')).join("")}</div>`;
}

function renderSearchPagination(all_messages) {
  global.handlers.paginate = (delta) => {
    if (delta === 'all') {
      const urlParams = new URLSearchParams(window.location.search);
      const text = urlParams.get('q');
      window.history.pushState({}, "", "/search/?q=" + encodeURIComponent(text) + "&page=all");
      renderSearchMain(all_messages);
      return;
    }
    // delta is an integer, probably +1 or -1
    const urlParams = new URLSearchParams(window.location.search);
    const text = urlParams.get('q');
    let page = urlParams.get('page');
    page = (page === null ? 0 : parseInt(page));
    page = clamp(page + delta, 0, Math.floor(all_messages.length / SEARCH_RESULTS_PER_PAGE)); // round down to get the number of pages
    window.history.pushState({}, "", "/search/?q=" + encodeURIComponent(text) + "&page=" + page);
    renderSearchMain(all_messages);
  };
  let pagination = document.getElementById('search-pagination');
  pagination.innerHTML = `
    <button class='menu-button' onclick="return global.handlers.paginate(1)">${lookupIcon('next')}</button>
    <button class='menu-button' onclick="return global.handlers.paginate(-1)">${lookupIcon('prev')}</button>
    <button class='menu-button' onclick="return global.handlers.paginate('all')">${lookupIcon('all')}</button>
  `;
}

function runSearch() {
  console.assert(window.location.pathname.startsWith("/search/"));
  document.getElementsByTagName('main')[0].innerHTML = 'searching...';
  const urlParams = new URLSearchParams(window.location.search);
  const text = urlParams.get('q');
  searchResults = search(text).then(all_messages => {
    renderSearchMain(all_messages);
    document.getElementsByTagName("footer")[0].innerHTML = renderSearchFooter();
    renderSearchPagination(all_messages);
  });
}

function renderSearchFooter() {
  const urlParams = new URLSearchParams(window.location.search);
  const text = urlParams.get('q') || '';
  let menu = `
    <button class='menu-button' onclick="gotoJournal()">${lookupIcon('journal')}</button>
    <input onkeydown="return global.handlers.handleSearch(event)" type='text' id='search_query' value="${text}"></input>
    <button class='menu-button' onclick="return global.handlers.handleSearch(true)">${lookupIcon('search')}</button>
    <br/>
    <div id='search-pagination'></div>
  `;
  global.handlers = {};
  global.handlers.handleSearch = (event) => {
    console.log(event);
    if (event == true || event.key === 'Enter') {
      let text = document.getElementById('search_query').value;
      console.log('handling search', text);
      window.history.pushState({}, "", "/search/?q=" + encodeURIComponent(text) + "&page=0");
      runSearch();
      return false;
    }
  };
  return menu;
}

async function gotoSearch() {
  let footer = document.getElementsByTagName('footer')[0];
  window.history.pushState({}, "", "/search/");
  footer.innerHTML = renderSearchFooter();
  runSearch();
  return false;
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
    <button class='menu-button' onclick="return handleTextField(true, '${id}', '${file_name}', ${rerender})">${label}</button>`
  );
}

async function handleTextAction(event, id, action) {
  if (event === true || event.key === 'Enter') {
    let text = document.getElementById(id).value;
    await action(text);
    return false;
  }
};

function TextAction({id, label, value, action}) {
  return (
    `<input onkeydown="return handleTextAction(event, '${id}', ${action})" type='text' id='${id}' value="${value}"></input>
    <button class='menu-button' onclick="return handleTextAction(true, '${id}', ${action})">${label}</button>`
  );
}

// SETUP

const colorize_repo = (repo) => `<span style="color: #ffcc55; font-family: monospace">${repo}</span>`;

async function renderSetup() {

  // TODO allow renaming local repo?
  global.handlers = {};

  let add_links = '<div style="margin: 10px">Please set a local repo name to continue.</div>';
  let local_repo_name_message = 'Local repo name is unset.';
  let local_repo_name = await cache.readFile(LOCAL_REPO_NAME_FILE);
  if (local_repo_name === null) {
    local_repo_name = '';
  }
  if (local_repo_name.length > 0) {
    local_repo_name_message = `Local repo name is ${colorize_repo(local_repo_name)}`;
    add_links = `
    <button class='menu-button' onclick="gotoMenu()">${lookupIcon('menu')}</button>
    <button class='menu-button' onclick="gotoJournal()">${lookupIcon('journal')}</button>
    `;
  }

  const welcome_splash = `<div>
  <h3>Welcome to Pipeline!</h3>
  <p>This is the May 1st, 2024 version of Pipeline Notes, version ${tag_color('1.1')}.</p>
  <p>Changelog, roadmap, help, usage, and examples coming soon!</p>
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
     ${splash}`,
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

async function gotoNewNote(title) {
  let uuid = await newNote(title);
  await gotoDisc(uuid);
}

const tag_color = (x) => `<span style="color: var(--link_button_main_color)">${x}</span>`

async function renderMenu() {
  global.handlers = {};
  global.handlers.clearServiceWorkerCaches = async () => {
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

  return [
    `${TextAction({id: 'new_note', label: lookupIcon('new note'), value: '', action: 'gotoNewNote'})}
    <br/>
    <button class='menu-button' onclick="gotoRoutine()">${lookupIcon('routine')}</button>
    <br/>
    <div>
      <p> Advanced Debugging Tools: </p>
      <ul>
      <li><button class='menu-button' onclick="return global.handlers.clearServiceWorkerCaches();">clear service worker cache</button></li>
      </ul>
    </div>`,
    `<div>
      <button class='menu-button' onclick="gotoJournal()">${lookupIcon('journal')}</button>
      <button class='menu-button' onclick="gotoList()">${lookupIcon('list')}</button>
      <button class='menu-button' onclick="gotoSearch()">${lookupIcon('search')}</button>
      <button class='menu-button' onclick="gotoSync()">${lookupIcon('sync')}</button>
      <button class='menu-button' onclick="gotoSetup()">${lookupIcon('setup')}</button>
    </div>`
  ];
}

// ICONS

function lookupIcon(full_name) {
  // return {
  //   'search' : '🔍',
  //   'sync' : '🔄',
  //   'setup' : '⚙️',
  //   'journal' : '📓',
  //   'edit' : '✏️',
  //   'list' : '📜',
  //   'menu' : '🍔',
  //   'mix' : '🔀',
  //   'focus' : '',  // arrow pointing to the right
  // }[full_name];
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
  }[full_name];
}

// ROUTINE

async function gotoRoutine() {
  paintSimple(await renderRoutine());
  window.history.pushState({},"", "/routine");
}

async function renderRoutine() {
  const notes = await getNoteMetadataMap();
  const routine_notes = notes.filter(note => note.title === "ROUTINE");
  let content = "no routine notes found"
  if (routine_notes.length > 0) {
    const most_recent_routine_note = routine_notes.sort((a, b) => dateComp(b, a))[0];
    content = htmlNoteContent(most_recent_routine_note.uuid, most_recent_routine_note.content);
  }
  
  return [
    `<div>
      <h3>routine</h3>
      ${content}
    </div>`,
    `<button class='menu-button' onclick="gotoJournal()">${lookupIcon('journal')}</button>
    <button class='menu-button' onclick="gotoMenu()">${lookupIcon('menu')}</button>`
  ];
}

// MAIN

const cache = new FileDB("pipeline-db-cache", "cache");

async function gotoJournal() {
  let notes = await getNotesWithTitle(today(), await get_local_repo_name());
  if (notes.length === 0) {
    let uuid = await newJournal(today());
    notes = [uuid];
  }
  await gotoDisc(notes[0]);
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
  console.log("notes that match today's date:", await getNotesWithTitle(today(), await get_local_repo_name()));
  console.log("initializing from path", window.location.pathname);

  if (window.location.pathname.startsWith('/disc/')) {
    let uuid = window.location.pathname.slice("/disc/".length);
    paintDisc(uuid);

  } else if (window.location.pathname.startsWith('/edit/')) {
    let uuid = window.location.pathname.slice("/edit/".length);
    paintEdit(uuid);

  } else if (window.location.pathname.startsWith('/list')) {
    paintSimple(await renderList());

  } else if (window.location.pathname.startsWith('/sync')) {
    paintSimple(await renderSync());

  } else if (window.location.pathname.startsWith('/search')) {
    document.getElementsByTagName("footer")[0] = renderSearchFooter();
    runSearch();
  } else if (window.location.pathname.startsWith('/setup')) {
    paintSimple(await renderSetup());

  } else if (window.location.pathname.startsWith('/menu')) {
    paintSimple(await renderMenu());

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
    document.getElementsByTagName("body")[0].innerHTML = `Database is outdated, please <button class='menu-button' onclick="window.location.reload(); return false;">reload the page</button>.`;
  }

  await global_notes.init(reloadNecessary);
  await cache.init(reloadNecessary);

  console.log('today is', today());

  global = {};

  await handleRouting();
}
