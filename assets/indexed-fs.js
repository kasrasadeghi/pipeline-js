import { parseContent, parseSection, TreeNode, EmptyLine } from '/parse.js';
import { initFlatDB, SHOW_PRIVATE_FILE, LOCAL_REPO_NAME_FILE } from '/flatdb.js';
import { initState, cache, getNow } from '/state.js';
import { readBooleanFile, toggleBooleanFile, readBooleanQueryParam, toggleBooleanQueryParam, setBooleanQueryParam } from '/boolean-state.js';
import { rewrite, rewriteLine, rewriteBlock, Msg, Line, Tag, Link } from '/rewrite.js';
import { dateComp, timezoneCompatibility } from '/date-util.js';
import { hasRemote } from '/remote.js';
import { sync, restoreRepo } from '/sync.js';
import { getGlobal, initializeKazGlobal, kazglobal } from '/global.js';
import { paintList } from '/calendar.js';
import { lookupIcon, MenuButton, ToggleButton } from '/components.js';

export { handleToggleButton } from '/components.js';
export { gotoList } from '/calendar.js';
export { getGlobal };
export { parseContent, parseSection, TreeNode, EmptyLine } from '/parse.js';
export { rewrite } from '/rewrite.js';
export { debugGlobalNotes } from '/flatdb.js';
export { setNow, tomorrow, getNow } from '/state.js';
export { dateComp, timezoneCompatibility } from '/date-util.js';

// JAVASCRIPT UTIL

// add .back() to arrays
if (!Array.prototype.back) {
  Array.prototype.back = function() {
    return this[this.length - 1];
  }
}

// GENERAL UTIL

function paintSimple(render_result) {
  document.title = "Pipeline Notes";
  let main = document.getElementsByTagName('main')[0];
  let footer = document.getElementsByTagName('footer')[0];
  [main.innerHTML, footer.innerHTML] = render_result;
  return {main, footer};
}

// PARSE

//#endregion PARSE

//#region REWRITE

// page -> *section
// section -> {title: METADATA, lines: *str} | {title,blocks: *block} | {title,roots: *root}
// root -> {root: 'pre_roots'|'nonfinal'|'final', children: block*}
// block -> message | EmptyLine | *node | *line
// class EmptyLine {}
// message -> {msg: Line ,date,content: str}
// node -> {value,indent,children:*node,line: Line}
// class Line {content: str, parts: *line_part}
// line_part -> str | Tag | cmd | Link
// link -> note | root-link | internal-link | simple-link

function pageIsJournal(page) {
  return page
    .find(s => s.title === 'METADATA').lines
    .find(l => l.startsWith("Tags: "))?.slice("Tags: ".length)
    .split(",").map(x => x.trim()).includes("Journal") !== undefined;
}

// RENDER

function htmlNote(uuid) {
  console.log('rendering note for', uuid);
  let messages = kazglobal.notes.get_messages_around(uuid);
  messages.reverse();
  // let messages = [];
  let content = kazglobal.notes.get_note(uuid).content;
  let rendered_messages = messages.map(msg => htmlMsg(msg, /*mode*/undefined, content));
  return rendered_messages.join("");
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
      return  htmlTreeNode(block[0]);
    }
    return "<p class='msgblock'>" + block.map(htmlBlockPart).join("<br>") + "</p>";
  }
  if (block instanceof TreeNode) {
    return htmlTreeNode(block);
  }
  console.assert(false, block, 'unexpected block type');
}

function htmlBlockPart(part) {
  if (part instanceof Line) {
    return htmlLine(part);
  } else if (part instanceof TreeNode) {
    return htmlTreeNode(part);
  }
  console.assert(false, part, 'unexpected block part type');
}

export function htmlTreeNode(thisNode) {
  return `<div class="treenode indent${thisNode.indent}">
  ${thisNode.value}
  <ul class="treenode-list">
  ${thisNode.children.map(x => "<li>" + htmlTreeNode(x, true) + "</li>").join("")}
  </ul>
  </div>`;
}

// date timestamp, like hh:mm:ss in 24-hour clock
const timestamp_format = new Intl.DateTimeFormat('en-us', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// date timestamp with day, like Jan 15, hh:mm:ss in 24-hour clock
const timestamp_day_format = new Intl.DateTimeFormat('en-us', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// date timestamp with day and year, like Jan 15, 2024, hh:mm:ss in 24-hour clock
const timestamp_year_format = new Intl.DateTimeFormat('en-us', { year: "numeric", month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });


function renderDatetime(date) {
  let now = getNow();

  let time_format = timestamp_format;
  if (now.getDate() !== new Date(date).getDate() ||
      now.getMonth() !== new Date(date).getMonth() || 
      now.getFullYear() !== new Date(date).getFullYear()
  ) {
    time_format = timestamp_day_format;
  }
  if (now.getFullYear() !== new Date(date).getFullYear()) {
    time_format = timestamp_year_format;
  }
  
  try {
    return time_format
      .format(date).replaceAll(",", "");  // "Wed, Jan 15, hh:mm:ss" -> "Wed Jan 15 hh:mm:ss"
  } catch (e) {
    console.log('error rendering datetime', date, e);
    return 'datetime error';
  }
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

export function unparseMsg(msg) {
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

export function unparseTreeNode(thisNode, nested = false) {
  let indent = thisNode.indent == -1 ? "" : "  ".repeat(thisNode.indent) + "- ";
  let result = indent + htmlLine(thisNode.value) + "\n" + thisNode.children.map(x => unparseTreeNode(x, true)).join("");
  if (! nested && result.endsWith("\n")) {
    result = result.slice(0, -1);
  }
  return result;
}

function unparseLineContent(l) {
  if (typeof l === 'string') {
    return l;
  }
  if (l instanceof TreeNode) {
    return unparseTreeNode(l);
  }
  if (l instanceof Line) {
    return l.content;
  }
  // throw new Error("failed unparseLine", l);
  return 'ERROR: ' + l;
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

export async function getMessageFromElement(element) {
  let msg_id = element.id;
  let page = kazglobal.notes.rewrite(getCurrentNoteUuid());
  let msg = page.filter(section => section.title === 'entry').flatMap(x => x.blocks).find(block => block.date === msg_id);
  return msg;
}

export async function editMessage(item_origin, msg_id) {
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

  let item_origin_content = await kazglobal.notes.readFile(item_origin);

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
      console.log('message block content', msg_block_content.innerHTML);
      let lines = msg_block_content.innerText.trim().split('\n');  // innerText is unix newlines, only http request are dos newlines
      let blocks = parseSection(lines);
      let rewritten_blocks = blocks.map(rewriteBlock);
      // if there are two emptylines next to each other, delete one
      for (let i = 0; i < rewritten_blocks.length - 1; i++) {
        while (rewritten_blocks[i] instanceof EmptyLine && rewritten_blocks[i + 1] instanceof EmptyLine) {
          rewritten_blocks.splice(i, 1);
        }
      }

      // TODO fix this by just pasting correctly.  i'm not sure why the paste is so broken.

      msg.blocks = rewritten_blocks;  
    }

    let new_content = unparseContent(page);
    await kazglobal.notes.writeFile(item_origin, new_content);
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

export function htmlMsgBlockContent(msg, origin_content) {
  let block_content = msg.blocks.map(block => htmlMsgBlock(block, origin_content)).join("");
  block_content = trimTrailingRenderedBreak(block_content);
  return block_content;
}

export function preventDivs(e) {
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

export function htmlMsg(item, mode, origin_content) {

  let date = Date.parse(timezoneCompatibility(item.date));
  
  let timestamp_content = renderDatetime(date);
  let href_id = `/disc/${item.origin}#${item.date}`;
  let msg_timestamp_link = shortcircuitLink(href_id, timestamp_content, 'msg_timestamp');

  let show_private_messages = kazglobal.notes.show_private_messages();
  if (show_private_messages === "false") {
    if (item.content.includes("PRIVATE")) {
      return "";
    }
  }

  let line = htmlLine(item.msg);
  let style_option = item.origin !== kazglobal.notes.maybe_current_journal() ? " style='background: #5f193f'": "";

  let block_content = htmlMsgBlockContent(item, origin_content);
  let has_block_content = '';
  if (block_content !== '') {
    has_block_content = 'withcontent';
  }

  let edit_link = '';
  let editable = '';
  // can only edit messages on the current note, so we `=== getCurrentNoteUuid()`
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
  if (s.length !== 2) {
    return {uuid: '', datetime_id: ''};
  }
  let [uuid, datetime_id] = s;
  return {uuid, datetime_id};
}

async function retrieveMsg(ref) {
  let url_ref = parseRef(ref);
  if (url_ref.uuid === '') {
    console.log('ERROR 3: could not parse ref', ref);
    return [];
  }
  let r = kazglobal.notes.rewrite(url_ref.uuid);
  let found_msg = r.filter(section => section.title === 'entry')
    .flatMap(s => s.blocks)
    .filter(x => x instanceof Msg && x.date === url_ref.datetime_id);
  return found_msg; // returns a list
}

export function clickInternalLink(url) {
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

export async function expandRef(obj, url) {
  let found_msg = await retrieveMsg(url);
  let result = htmlMsg(found_msg[0]);
  if (found_msg.length > 0) {
    console.log(found_msg);
    insertHtmlBeforeMessage(obj, result);
  } else {
    console.log(`ERROR 4: couldn't find ${url_ref.datetime_id} in ${url_ref.uuid}`);
    // TODO error messaging
  }
};

export async function expandSearch(obj, search_query) {
  let urlParams = new URLSearchParams(search_query);
  const text = urlParams.get('q');
  const case_sensitive = urlParams.get('case') === 'true';

  kazglobal.notes.subscribe_to_messages_cacher(messages => {
    let search_results = search(messages, text, case_sensitive);
    let painted_search_results = renderSearchMain(urlParams, search_results);
    insertHtmlBeforeMessage(obj, painted_search_results);
    obj.scrollIntoView();
  });
}

function htmlLine(line) {
  if (line instanceof Line) {
    return line.parts.map(x => {
      if (x instanceof Tag) {
        return "<emph class='tag'>" + x.tag + "</emph>";
      }
      if (x instanceof Link) {
        if (x.type === 'shortcut') {
          return shortcircuitLink(x.url, x.display, 'shortcut');
        }
        if (x.type === 'internal_ref') {
          let ref = parseRef(x.display);
          if (ref.uuid === '') {
            return x;
          }
          let shorter_datetime = renderDatetime(new Date(ref.datetime_id));
          if (shorter_datetime === 'datetime error') {
            // invalid datetime value
            return x;
          }
          return `<div style="display:inline">
            <button onclick="return expandRef(this, '${x.display}')">get</button>
            <a onclick="return clickInternalLink('${x.url}')" href="${x.url}">${shorter_datetime}</a>
          </div>`;
        }
        if (x.type === 'internal_search') {
          
          // TODO add time of search to search result?
          // let shorter_datetime = renderDatetime(new Date(ref.datetime_id));
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

const MENU_TOGGLE_FILE = 'disc menu toggle state';
const SEARCH_CASE_SENSITIVE_FILE = 'search case sensitive state';

async function paintDisc(uuid, flag) {
  document.title = `${kazglobal.notes.get_note(uuid)?.title || "illegal: " + uuid} - Pipeline Notes`;
  if (flag !== 'only main') {
    await paintDiscFooter(uuid);

    // msg_input doesn't exist when the uuid is not in our local repo
    setTimeout(() => {
      document.getElementById('msg_input')?.focus();
    }, 0);
  }

  let main = document.getElementsByTagName('main')[0];
  if (kazglobal.notes.get_note(uuid) === null) {
    main.innerHTML = `ERROR 5: couldn't find file '${uuid}'`;
    console.error('ERROR 5: couldn\'t find file', uuid);
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

export function getSupervisorStatusPromise() {
  const hostname = window.location.hostname;  // "10.50.50.2"
  return fetch(`https://${hostname}:8002/api/status`, {method: 'GET'}).then(response => response.json());
}

export async function handleMsg(event) {
  const displayState = (state) => { document.getElementById('state_display').innerHTML = state; };

  // console.log(event);  // print out keyboard events 

  // yield to the UI thread with settimeout 0, so the msg_input clientHeight uses the post-keyboardEvent UI state.
  setTimeout(() => {
    let footer_menu_size = (document.getElementById('msg_input').clientHeight) + 80; // for one line, client height is 31px
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
  
    await kazglobal.notes.ensure_valid_cache(); // should do this in `rewrite()` below.  and `get_note()` honestly
    // TODO but i can't because rewrite and get_note are not async.  hmmm

    let is_journal = pageIsJournal(kazglobal.notes.rewrite(current_uuid));

    // if we're in a journal and we're not on the current one, redirect to the current journal
    if (is_journal) {
      let today_uuid = await kazglobal.notes.get_or_create_current_journal();
      if (current_uuid !== today_uuid) {
        current_uuid = today_uuid;
        window.history.pushState({}, "", `/disc/${current_uuid}`);
      }
    }

    await kazglobal.notes.updateFile(current_uuid, (content) => {
      let lines = content.split("\n");
      const content_lines = lines.slice(0, lines.indexOf("--- METADATA ---"));
      const metadata_lines = lines.slice(lines.indexOf("--- METADATA ---"));
      const old_content = content_lines.join("\n");
      const metadata = metadata_lines.join("\n");

      const new_content = old_content + `\n- msg: ${msg.trim()}\n  - Date: ${getNow()}\n\n`;
      return new_content + metadata;
    });
  }
  await kazglobal.notes.ensure_valid_cache();
  await paintDisc(current_uuid, 'only main');
  await paintDiscRoutine();

  if (hasRemote()) {
    const sync_success = sync(displayState);
    if (! sync_success) {
      getSupervisorStatusPromise()
        .then((status) => { displayState(JSON.stringify(status)); })
        .catch((e) => { displayState("supervisor down", e); console.log(e); });
    }
  }
  return false;
};

export async function toggleMenu () {
  let menu_state = await toggleBooleanFile(MENU_TOGGLE_FILE, "false");
  kazglobal.notes.booleanFiles[MENU_TOGGLE_FILE] = menu_state;
  document.documentElement.style.setProperty("--menu_modal_display", menu_state === 'true' ? "flex" : "none");
}

async function paintDiscFooter(uuid) {
  setTimeout(() => {
    if (kazglobal.notes.get_note(uuid) === null) {
      return;
    }
    const well_formed = checkWellFormed(uuid, kazglobal.notes.get_note(uuid).content) ? 'well-formed' : 'not well-formed';
    document.getElementById('well_formed_display').innerHTML = well_formed;
  }, 100);

  let msg_form = "";
  let edit_button = "";
  if (uuid.startsWith(kazglobal.notes.local_repo_name())) {
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
      </div>
      <div id="footer_message_container">
        <div id='state_display'></div>
        <div id='well_formed_display'></div>
      </div>
    </div>`;
  await paintDiscRoutine();
}

async function renderDiscBody(uuid) {
  let rendered_note = htmlNote(uuid);
  return `<div class="msglist">` + rendered_note + `</div>`;
}

export async function gotoDisc(uuid) {
  window.history.pushState({},"", "/disc/" + uuid);
  paintDisc(uuid, /* paint both footer and main */ undefined);
  return false;
}

// EDIT

async function paintEdit(uuid) {
  document.title = `editing "${kazglobal.notes.get_note(uuid).title}" - Pipeline Notes`;
  let main = document.getElementsByTagName('main')[0];
  let footer = document.getElementsByTagName('footer')[0];
  [main.innerHTML, footer.innerHTML] = await renderEdit(uuid);

  let el = document.getElementsByClassName("editor_textarea")[0];
  el.scrollTop = el.scrollHeight;
}

export async function gotoEdit(uuid) {
  window.history.pushState({},"", "/edit/" + uuid);
  await paintEdit(uuid);
}

export async function submitEdit() {
  let textarea = document.getElementsByTagName('textarea')[0];
  let content = textarea.value;  // textareas are not dos newlined, http requests are.  i think?
  // TODO consider using .replace instead of .split and .join
  const uuid = getCurrentNoteUuid();
  await kazglobal.notes.writeFile(uuid, content);
  gotoDisc(uuid);
};

async function renderEdit(uuid) {
  console.log('rendering /edit/ for ', uuid);
  let content = await kazglobal.notes.readFile(uuid);
  if (content === null) {
    return `ERROR 2: couldn't find file '${uuid}'`;
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

// SEARCH

export function search(messages, text, is_case_sensitive=false) {
  console.log('searching');
  if (text === '' || text === null || text === undefined) {
    return messages;
  }

  console.time('search total');

  let case_insensitive = (a, b) => a.toLowerCase().includes(b.toLowerCase());
  let case_sensitive = (a, b) => a.includes(b);
  let includes = (is_case_sensitive) ? case_sensitive : case_insensitive;

  console.time('search gather msgs');
  let show_private_messages = kazglobal.notes.show_private_messages();
  if (show_private_messages === "true") {
    messages = messages.filter(m => includes(m.content, text));
  } else {
    messages = messages.filter(m => includes(m.content, text) && !m.content.includes('PRIVATE'));
  }
  console.timeEnd('search gather msgs');

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
    return `<h3>render all ${all_messages.length} results</h3><div class='msglist'>${all_messages.reverse().map((x) => htmlMsg(x, 'search')).join("")}</div>`;
  }
  page = (page === null ? 0 : parseInt(page));
  let messages = all_messages.slice(page * SEARCH_RESULTS_PER_PAGE, (page + 1) * SEARCH_RESULTS_PER_PAGE);
  return `<h3>${page * SEARCH_RESULTS_PER_PAGE} to ${(page) * SEARCH_RESULTS_PER_PAGE + messages.length} of ${all_messages.length} results</h3><div class='msglist'>${messages.reverse().map((x) => htmlMsg(x, 'search')).join("")}</div>`;
}

function paintSearchMain(urlParams) {
  let main = document.getElementsByTagName('main')[0];
  main.innerHTML = renderSearchMain(urlParams, kazglobal.search.results);
  main.scrollTop = main.scrollHeight;
}

export function searchPagination(delta) {
  if (delta === 'all') {
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('page', 'all');
    window.history.pushState({}, "", "/search/?" + urlParams.toString());
    paintSearchMain(urlParams);
    return;
  }

  // delta is an integer, probably +1 or -1
  const urlParams = new URLSearchParams(window.location.search);
  let page = urlParams.get('page');
  page = (page === null ? 0 : parseInt(page));
  page = clamp(page + delta, /*bottom*/0, /*top*/Math.floor(kazglobal.search.results.length / SEARCH_RESULTS_PER_PAGE)); // round down to get the number of pages
  urlParams.set('page', page);
  window.history.pushState({}, "", "/search/?" + urlParams.toString());
  paintSearchMain(urlParams);
}

function paintSearchPagination() {
  let pagination = document.getElementById('search-pagination');
  pagination.innerHTML = `
    ${MenuButton({icon: 'next', action: 'return searchPagination(1)'})}
    ${MenuButton({icon: 'prev', action: 'return searchPagination(-1)'})}
    ${MenuButton({icon: 'all', action: "return searchPagination('all')"})}
  `;
}

function runSearch() {
  console.assert(window.location.pathname.startsWith("/search/"));
  const urlParams = new URLSearchParams(window.location.search);
  const text = urlParams.get('q');
  const case_sensitive = urlParams.get('case') === 'true';
  document.title = `Search "${text}" - Pipeline Notes`;

  const has_text = !(text === null || text === undefined || text === '');
  // search footer should already be rendered
  kazglobal.notes.subscribe_to_messages_cacher(messages => {
    let search_results = search(messages, text, case_sensitive);
    kazglobal.search = kazglobal.search || {};
    kazglobal.search.results = search_results;
    paintSearchMain(urlParams);
    paintSearchPagination();
  });
  console.log('checking for text');
}

export async function searchAction(id) {
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

export async function gotoSearch() {
  console.log('goto /search/');
  let footer = document.getElementsByTagName('footer')[0];
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set('case', await readBooleanFile(SEARCH_CASE_SENSITIVE_FILE, "true"));
  window.history.pushState({}, "", "/search/?" + urlParams.toString());
  footer.innerHTML = await renderSearchFooter();
  document.getElementById('search_query')?.focus();
  runSearch();
  return false;
}

// COMPONENT TEXTFIELD

// used for first time setup and setup configuration
export async function handleTextField(event, id, file_name, rerender) {
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

export async function handleTextAction(event, source_id, action, everykey) {
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

// SETUP

const colorize_repo = (repo) => `<span style="color: #ffcc55; font-family: monospace">${repo}</span>`;

export async function renderSetup() {

  // TODO allow renaming local repo?
  let add_links = '<div style="margin: 10px">Please set a local repo name to continue.</div>';
  let local_repo_name_message = 'Local repo name is unset.';
  let local_repo_name = await cache.readFile(LOCAL_REPO_NAME_FILE);
  if (local_repo_name === null) {
    local_repo_name = '';
  }
  if (local_repo_name.length > 0) {
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
       ${TextAction({id: 'get_local_repo_name', label: lookupIcon('get repo'), value: '', action: 'restoreRepoAction'})}
       </div>
       <p>${local_repo_name_message}</p>
     ${splash}
     <a id='cert-button' href="/pipeline-cert.pem" download style="margin: 10px">download self-signed client certificate</a>
     `,
    add_links
  ];
}

export async function restoreRepoAction(id) {
  let text = document.getElementById(id).value;
  await restoreRepo(text);
  await gotoJournal();
}

export async function gotoSetup() {
  paintSimple(await renderSetup());
  window.history.pushState({}, "", "/setup");
}

// MENU

export async function gotoMenu() {
  paintSimple(await renderMenu());
  window.history.pushState({}, "", "/menu");
}

export async function gotoNewNote(id) {
  let text = document.getElementById(id).value;
  let uuid = await kazglobal.notes.newNote(text, getNow());
  await gotoDisc(uuid);
}

const tag_color = (x) => `<span style="color: var(--link_button_main_color)">${x}</span>`

export async function clearServiceWorkerCaches() {
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

export async function renderMenu() {
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
      ${MenuButton({icon: 'setup', action: 'gotoSetup()'})}
      ${await ToggleButton({id: 'show_private_toggle', file: SHOW_PRIVATE_FILE, label: lookupIcon('private'), rerender: 'renderMenu'})}
    </div>`
  ];
}

// ROUTINE

export async function gotoRoutine() {
  paintSimple(await renderRoutine());
  window.history.pushState({},"", "/routine");
}

async function routineContent() {
  const local_repo_name = kazglobal.notes.local_repo_name();
  const notes = kazglobal.notes.metadata_map;
  const routine_notes = notes.filter(note => note.title === "ROUTINE");

  let content = "no routine notes found";
  let is_local_routine = false;
  if (routine_notes.length > 0) {
    const most_recent_routine_note = routine_notes.sort((a, b) => dateComp(b, a))[0];
    is_local_routine = most_recent_routine_note.uuid.startsWith(local_repo_name + "/");

    let page = parseContent(most_recent_routine_note.content);
    page = rewrite(page, most_recent_routine_note.uuid);
    let current_journal = kazglobal.notes.maybe_current_journal();
    if (current_journal === null) {
      return "no journal found for today";
    }
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
  let msgs = await kazglobal.notes.get_messages_around(uuid);
  return msgs.flatMap(x => x.msg.parts.filter(p => p instanceof Tag));  // get all tags from every message
}

// MAIN

export async function gotoJournal() {
  let uuid = await kazglobal.notes.get_or_create_current_journal();
  await gotoDisc(uuid);
}

window.addEventListener("popstate", (event) => {
  console.log(
    `location: ${document.location}, state: ${JSON.stringify(event.state)}`,
  );
  handleRouting();
});

// may return null iff not /edit/ or /disc/
export function getCurrentNoteUuid() {
  // console.log("getting note uuid from path", window.location.pathname);

  if (window.location.pathname.startsWith('/disc/')) {
    let uuid = decodeURI(window.location.pathname.slice("/disc/".length));
    return uuid;
  } else if (window.location.pathname.startsWith('/edit/')) {
    let uuid = decodeURI(window.location.pathname.slice("/edit/".length));
    return uuid;
  }
  return null;
}

export async function handleRouting() {
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

export async function run() {
  console.log('attempting to register service worker');
  registerServiceWorker();

  const reloadNecessary = () => {
    alert("Database is outdated, please reload the page.");
    // document.location.reload();
    document.getElementsByTagName("body")[0].innerHTML = `Database is outdated, please <button class='menu-button' id='reload-button' onclick="window.location.reload(); return false;">reload the page</button>.`;
  }
  
  await initFlatDB(reloadNecessary);
  await initState(reloadNecessary);

  await initializeKazGlobal();
  console.log('today is', getNow());
  console.log('global is', kazglobal);  

  await handleRouting();
}
