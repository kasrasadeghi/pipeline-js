class FileDB {
  constructor(dbName = "pipeline-db", storeName = "notes") {
    this.db = null;
    this.dbName = dbName;
    this.storeName = storeName;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = event => {
        this.db = event.target.result;
        this.db.createObjectStore(this.storeName, { keyPath: "path" });
        // TODO create index on uuid and other stuff
      };

      request.onsuccess = event => {
        this.db = event.target.result;
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
}
const global_notes = new FileDB();

let global = null;
let handlers = {msg: (e) => {}};

async function newNote(title) {
  let content = `--- METADATA ---
Date: ${new Date()}
Title: ${title}
Tags: Journal`;
// https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  let uuid = crypto.randomUUID();
  await global_notes.writeFile(uuid, content);
  return uuid;
}

async function getTitle(uuid) {
  const note = await global_notes.readFile(uuid);
  const lines = note.split("\n");
  const metadata_lines = lines.slice(lines.indexOf("--- METADATA ---") + 1);
  const title_line = metadata_lines.find(line => line.startsWith("Title: "));
  const title = title_line.split(": ", 2)[1];  // 2 is number of chunks, not number of splits
  return title;
}

// JOURNAL

function today() {
  const today = new Date();
  const year = today.getFullYear();
  const month_number = today.getMonth() + 1;

  const month = today.toLocaleString('en-us', { month: "long" });
  const day = today.getDate();

  const day_suffix =
      [11, 12, 13].includes(day) === 11 ? 'th'
    : day % 10 === 1 ? 'st'
    : day % 10 === 2 ? 'nd'
    : day % 10 === 3 ? 'rd'
    : 'th';

  return `${month} ${day}${day_suffix}, ${year}`;
}

async function getNotesWithTitle(title) {
  const files = await global_notes.listFiles();
  console.log('all files', files);
  const files_with_names = await Promise.all(files.map(async uuid => { return {uuid, title: await getTitle(uuid)}; }));
  console.log('all files with names', files_with_names);
  return files_with_names.filter(note => note.title === title).map(note => note.uuid);
}

// PARSE
async function parseFile(filepath) {
  let content = await global_notes.readFile(filepath);
  return parseContent(content);
}

function parseContent(content) {
  // EXPL: a page is a list of sections, which each have a title and a list of blocks
  // - a block is a list of nodes
  // - a node can be either a line of type 'str', or a parsed tree
  let sections = [{title: 'entry', lines: []}];
  for (let L of content.split("\n")) {
    if (L.startsWith("--- ") && L.endsWith(" ---") && L.length > 9) {
      sections.push({title: L.slice(4, -4), lines: []})
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

  console.log('indent_lines', indent_lines);

  let roots = [];
  let stack = [];
  let found_children = false;

  for (let [indent, L] of indent_lines) {
    while (stack.length !== 0 && stack.slice(-1)[0].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      if ([-1, 0].includes(indent)) {
        let node = {indent, value: L, children: []};
        stack.push(node);
        roots.push(node);
        continue;
      } else {
        return block; // failure, block must start with root
      }
    }

    // stack must have elements in it, so the current line must be the stack's child
    found_children = true;

    let node = {indent, value: L, children: []};
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

// REWRITE

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
    .find(l => l.startsWith("Tags: ")).slice("Tags: ".length)
    .split(",").map(x => x.trim()).includes("Journal");
}

function rewrite(page) {
  return page.map(rewriteSection, pageIsJournal(page));
}

function rewriteSection(section, isJournal) {
  if (['METADATA', 'HTML'].includes(section.title)) {
    return section;
  }

  let new_blocks = [];
  for (let i = 0; i < section.blocks.length; ++i) {
    let block = section.blocks[i];
    new_blocks.push(rewriteBlock(block));
    if (block.length === 0) {
      i ++;
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
  constructor(properties) {
    console.assert(['content', 'date', 'msg'].every(x => Object.keys(properties).includes(x)), properties, 'huh');
    Object.assign(this, properties);
  }
}

function rewriteBlock(block) {
  if (block.length === 0) { // newline
    return block;
  }
  if (block.length === 1) {
    console.log('rewrite block', block);
    let item = block[0];
    if (item.value.startsWith("msg: ") && item.indent === 0 && item.children.length === 1) {
      let child = item.children[0];
      if (child.value.startsWith("Date: ") && child.indent === 1 && child.children.length === 0) {
        return new Msg({
          msg: item.value.slice("msg: ".length), 
          content: item.value, 
          date: child.value.slice("Date: ".length)
        });
      }
    }
  }
  
  // TODO the rest of block rewrite
  return block;
}

// RENDER

async function renderNote(uuid) {
  console.log('rendering', global.current_uuid);
  let page = await parseFile(uuid);
  let rewritten = rewrite(page);
  let rendered = rewritten.map(renderSection).join("\n");
  return [
    "<pre>" + rendered + "</pre>", 
    `<form id="msg_form" onsubmit="return global.handlers.handleMsg(event)">
      <input id='msg_input' type="text"/>
    </form>
    <button onclick="gotoEdit()">edit</button>`
  ];
}

function renderSection(section, i) {
  output = []
  if (! ('entry' === section.title && i === 0)) {
    output.push(`--- ${section.title} ---`)
  }
  if (['METADATA', 'HTML'].includes(section.title)) {
    output.push(...section.lines);
    return "<pre>" + output.join("\n") + "</pre>";
  }

  output.push(...section.blocks.map(renderBlock))

  return output.join("\n");
}

function renderBlock(block) {
  console.log('render block', block, block instanceof Msg);
  if (block instanceof Msg) {
    return renderMsg(block);
  }
  return JSON.stringify(block, undefined, 2);
}

// date timestamp
const timestamp_format = new Intl.DateTimeFormat('en-us', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); 
function renderMsg(item) {
  return `<div class='msg'><div class='msg_timestamp'>${timestamp_format.format(Date.parse(item.date))}</div><div class="msg_content">${item.msg}</div></div>`
}

// DISC

async function gotoDisc() {
  let main = document.getElementsByTagName('main')[0];
  let footer = document.getElementsByTagName('footer')[0];
  window.history.pushState({},"", "/disc");

  const handleMsg = async (event) => {

    console.log(event);
    event.preventDefault();

    let msg_input = document.getElementById('msg_input');
    let msg = msg_input.value;
    console.log('msg', msg);
    msg_input.value = '';

    let content = await global_notes.readFile(global.current_uuid);
    let lines = content.split("\n");
    const content_lines = lines.slice(0, lines.indexOf("--- METADATA ---"));
    const metadata_lines = lines.slice(lines.indexOf("--- METADATA ---"));
    const old_content = content_lines.join("\n");
    const metadata = metadata_lines.join("\n");

    const new_content = old_content + `\n- msg: ${msg}` + '\n' + `  - Date: ${new Date}` + '\n\n';
    await global_notes.writeFile(global.current_uuid, new_content + metadata);
  
    gotoDisc();
    return false;
  };
  global.handlers = {handleMsg};

  [main.innerHTML, footer.innerHTML] = await renderNote(global.current_uuid);
  return false;
}

// EDIT

async function gotoEdit() {
  let main = document.getElementsByTagName('main')[0];
  let footer = document.getElementsByTagName('footer')[0];
  window.history.pushState({},"", "/edit");
  [main.innerHTML, footer.innerHTML] = await renderEdit(global.current_uuid);

}

async function renderEdit(uuid) {
  console.log('rendering', uuid);
  let content = await global_notes.readFile(uuid);
  const submitEdit = async () => {
    let textarea = document.getElementsByTagName('textarea')[0];
    let content = textarea.value;
    await global_notes.writeFile(global.current_uuid, content);
    gotoDisc();
  };
  global.handlers = {submitEdit};
  const textarea_style = `
  box-sizing: border-box;
  resize: none;
  overflow: auto;
  width: -webkit-fill-available;
  height: 80dvh;`
  return [
    `<textarea style='${textarea_style}'>` + content + "</textarea>", 
    `<button onclick="global.handlers.submitEdit()">submit</button>`
  ];
}

// MAIN

async function run() {
  await global_notes.init();
  console.log('today is', today());
  let notes = await getNotesWithTitle(today());
  console.log('notes', notes);
  if (notes.length === 0) {
    let uuid = await newNote(today());
    notes = [uuid];
  }

  // we can only handle messages once we know what current_uuid is
  global = {current_uuid: notes[0]};
  
  if (window.location.href.endsWith('/edit')) {
    gotoEdit();
  } else {
    gotoDisc();
  }
}

