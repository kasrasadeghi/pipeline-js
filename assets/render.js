import { getGlobal } from '/global.js';
import { getCurrentNoteUuid, unparseMessageBlocks, shortcircuitLink, retrieveMsg, clickInternalLink, checkWellFormed, preventDivs, Deleted, unparseContent, search, renderSearchMain } from '/indexed-fs.js';
import { timezoneCompatibility } from '/date-util.js';
import { getNow } from '/state.js';
import { Msg, Line, Tag, Link } from '/rewrite.js';
import { EmptyLine, TreeNode } from '/parse.js';
import { parseContent, parseSection } from '/parse.js';
import { rewrite, rewriteBlock, rewriteLine } from '/rewrite.js';
import { Elem, DivElem, SpanElem, LinkElem, ButtonElem, ParagraphElem, ListItemElem, UnorderedListElem } from '/elem.js';

// date timestamp, like hh:mm:ss in 24-hour clock
const timestamp_format = new Intl.DateTimeFormat('en-us', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// date timestamp with day, like Jan 15, hh:mm:ss in 24-hour clock
const timestamp_day_format = new Intl.DateTimeFormat('en-us', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// date timestamp with day and year, like Jan 15, 2024, hh:mm:ss in 24-hour clock
const timestamp_year_format = new Intl.DateTimeFormat('en-us', { year: "numeric", month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function renderDatetime(date) {
  // check if date is invalid
  if (isNaN(date)) {
    return 'invalid date';
  }

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

  return time_format
    .format(date).replaceAll(",", "");  // "Wed, Jan 15, hh:mm:ss" -> "Wed Jan 15 hh:mm:ss"
}

function htmlTreeNode(thisNode) {
  return `<div class="treenode indent${thisNode.indent}">
  ${thisNode.value}
  <ul class="treenode-list">
  ${thisNode.children.map(x => "<li>" + htmlTreeNode(x, true) + "</li>").join("")}
  </ul>
  </div>`;
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

export function parseRef(ref) {
  let s = ref.split('#');  // a ref looks like: "uuid#datetime_id" 
  // EXAMPLE bigmac-js/f726c89e-7473-4079-bd3f-0e7c57b871f9.note#Sun Jun 02 2024 20:45:46 GMT-0700 (Pacific Daylight Time)
  console.assert(s.length == 2);
  if (s.length !== 2) {
    return {uuid: '', datetime_id: ''};
  }
  let [uuid, datetime_id] = s;
  return {uuid, datetime_id};
}

function htmlBlockPart(part) {
  if (part instanceof Line) {
    return htmlLine(part);
  } else if (part instanceof TreeNode) {
    return htmlTreeNode(part);
  }
  console.assert(false, part, 'unexpected block part type');
}

function htmlEditableMsgBlockContent(msg) {
  return unparseMessageBlocks(msg).replace(/\n/g, "<br>");
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

export function htmlNote(uuid) {
  console.log('rendering note for', uuid);
  let messages = getGlobal().notes.get_messages_around(uuid);
  messages.reverse();
  // let messages = [];
  let content = getGlobal().notes.get_note(uuid).content;
  let rendered_messages = messages.map(msg => htmlMsg(msg, /*mode*/undefined, content));
  return rendered_messages.join("");
}

export function htmlLine(line) {
  if (line instanceof Line) {
    let result = line.parts.map(x => {
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
          if (shorter_datetime === 'invalid date') {
            shorter_datetime = ref.datetime_id;
          }

          let ref_snippet = '';
          let found_msg = retrieveMsg(x.display);
          console.log('found_msg', found_msg);
          if (found_msg.length > 0) {
            ref_snippet = htmlLine(found_msg[0].msg);
          }

          if (shorter_datetime === 'datetime error') {
            // invalid datetime value
            return x;
          }
          return `<div class="ref_snippet">
            <button onclick="return expandRef(this, '${x.display}')">get</button>
            <a onclick="return clickInternalLink('${x.url}')" href="${x.url}">${shorter_datetime}</a>
            ${ref_snippet}
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
      if (typeof x === 'string') {
        return `<span class="string_line_part">${x}</span>`;
      }
      return x;
    }).join("");

    return result;
  }

  // TODO actually render these lines by parsing them.  for some reason they're not parsed.
  // console.log('huh', line);
  return line;
}

export function htmlMsg(item, mode, origin_content) {
  let date = Date.parse(timezoneCompatibility(item.date));
  
  let timestamp_content = renderDatetime(date);
  let href_id = `/disc/${item.origin}#${item.date}`;
  let msg_timestamp_link = shortcircuitLink(href_id, timestamp_content, 'msg_timestamp');

  let show_private_messages = getGlobal().notes.show_private_messages();
  if (show_private_messages === "false") {
    if (item.content.includes("PRIVATE")) {
      return "";
    }
  }

  let line = htmlLine(item.msg);
  let style_option = item.origin !== getGlobal().notes.maybe_current_journal() ? " style='background: #5f193f'": "";

  let block_content = htmlMsgBlockContent(item, origin_content);
  let has_block_content = '';
  if (block_content !== '') {
    has_block_content = 'withcontent';
  }

  let edit_link = '';
  let editable = '';
  // can only edit messages on the current device and on the current note
  if (origin_content !== undefined && item.origin === getCurrentNoteUuid() && item.origin.split('/')[0] === kazglobal.notes.local_repo_name()) {
    if (!checkWellFormed(item.origin)) {
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

function htmlMsgBlockContent(msg, origin_content) {
  let block_content = msg.blocks.map(block => htmlMsgBlock(block, origin_content)).join("");
  block_content = trimTrailingRenderedBreak(block_content);
  return block_content;
}

export async function editMessage(item_origin_uuid, msg_id) {
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
  if (item_origin_uuid.split('/')[0] !== getCurrentNoteUuid().split('/')[0]) {
    console.log('not from local repo');
    return;
  }

  let well_formed = checkWellFormed(item_origin_uuid);
  if (! well_formed) {
    console.log('not well formed');
    return;
  }

  // we need a mutable copy of the page in order to modify it and unparse it later.
  let parsed = parseContent(getGlobal().notes.get_note(item_origin_uuid).content);
  let page = rewrite(parsed, item_origin_uuid);

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
    await getGlobal().notes.writeFile(item_origin_uuid, new_content);
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
}

function insertHtmlBeforeMessage(obj, html_content, name) {
  console.log(obj);
  let parent = obj.parentElement;
  while (! parent.classList.contains('msg')) {
    parent = parent.parentElement;
  }

  // TODO persist quotes to cache so they work on refresh
  // TODO UI to remove/toggle quotes
  console.log('insert into', parent, parent.kaz_quotes);
  if (parent.previousElementSibling && parent.previousElementSibling.classList && parent.previousElementSibling.classList.contains('quotes')) {
    parent.kaz_quotes[name] = html_content;
    let rendered_quotes = "";
    for (let key in parent.kaz_quotes) {
      rendered_quotes += parent.kaz_quotes[key];
    }
    parent.previousElementSibling.innerHTML = rendered_quotes;
    // TODO make sure to replace the element with the same id if it exists
  } else {
    parent.insertAdjacentHTML('beforebegin', "<div class='quotes'>" + html_content + "</div>");
    parent.kaz_quotes = {[name]: html_content};
  }
  parent.scrollIntoView();
}

export async function expandRef(obj, url) {
  let found_msg = retrieveMsg(url);
  let result = htmlMsg(found_msg[0]);
  if (found_msg.length > 0) {
    console.log(found_msg);
    insertHtmlBeforeMessage(obj, result, /*name=*/"ref" + url);
  } else {
    console.log(`ERROR 4: couldn't find ${url_ref.datetime_id} in ${url_ref.uuid}`);
    // TODO error messaging
  }
}

export async function expandSearch(obj, search_query) {
  let urlParams = new URLSearchParams(search_query);
  const text = urlParams.get('q');
  const case_sensitive = urlParams.get('case') === 'true';

  getGlobal().notes.subscribe_to_messages_cacher(messages => {
    let search_results = search(messages, text, case_sensitive);
    let painted_search_results = renderSearchMain(urlParams, search_results);
    insertHtmlBeforeMessage(obj, painted_search_results, 'search');
    obj.scrollIntoView();
  });
}

// ============================================================================
// ELEMENT-BASED RENDERING FUNCTIONS (using Elem class)
// ============================================================================
// For some reason, this rendering strategy is much slower.
// On a particularly complicated day, this takes 65ms rather than 45ms.

function elemTreeNode(thisNode) {
  const div = new DivElem(`treenode indent${thisNode.indent}`);
  const span = new SpanElem().setText(thisNode.value);
  const ul = new UnorderedListElem('treenode-list');
  
  thisNode.children.forEach(child => {
    const li = new ListItemElem();
    li.addChild(elemTreeNode(child));
    ul.addChild(li);
  });
  
  div.addChildren([span, ul]);
  return div;
}

function elemBlockPart(part) {
  if (part instanceof Line) {
    return elemLine(part);
  } else if (part instanceof TreeNode) {
    return elemTreeNode(part);
  }
  console.assert(false, part, 'unexpected block part type');
}

function elemEditableMsgBlockContent(msg) {
  const content = unparseMessageBlocks(msg).replace(/\n/g, "<br>");
  return new SpanElem().setHTML(content);
}

function elemMsgBlock(block, content) {
  if (block instanceof Deleted) {
    return new SpanElem(); // Empty element
  }
  if (block instanceof Msg) {
    return elemMsg(block, /*mode*/undefined, content);
  }
  if (block instanceof EmptyLine) {
    return new SpanElem().setHTML("<br/>");
  }
  if (block instanceof Array) {
    if (block[0] == 'QUOTE') {
      const blockquote = new Elem('blockquote');
      block.slice(1).forEach(x => {
        const p = new ParagraphElem();
        p.addChild(elemLine(x));
        blockquote.addChild(p);
      });
      return blockquote;
    }
    if (block.length === 1 && block[0] instanceof TreeNode) {
      return elemTreeNode(block[0]);
    }
    const p = new ParagraphElem('msgblock');
    block.forEach(part => {
      p.addChild(elemBlockPart(part));
      if (part !== block[block.length - 1]) {
        p.addChild(new SpanElem().setHTML("<br>"));
      }
    });
    return p;
  }
  if (block instanceof TreeNode) {
    return elemTreeNode(block);
  }
  console.assert(false, block, 'unexpected block type');
}

export function elemNote(uuid) {
  console.log('rendering note for', uuid);
  let messages = getGlobal().notes.get_messages_around(uuid);
  messages.reverse();
  let content = getGlobal().notes.get_note(uuid).content;
  
  const fragment = document.createDocumentFragment();
  const msgElements = messages.map(msg => {
    const msgElem = elemMsg(msg, /*mode*/undefined, content);
    return msgElem.toElement();
  });
  fragment.append(...msgElements);
  
  return fragment;
}

export function elemLine(line) {
  if (line instanceof Line) {
    const span = new SpanElem();
    
    line.parts.forEach(part => {
      if (part instanceof Tag) {
        const emph = new Elem('emph', 'tag').setText(part.tag);
        span.addChild(emph);
      } else if (part instanceof Link) {
        if (part.type === 'shortcut') {
          const link = new LinkElem(part.url, part.display, 'shortcut');
          link.onClick(() => {
            window.history.pushState({}, '', part.url);
            handleRouting();
            return false;
          });
          span.addChild(link);
        } else if (part.type === 'internal_ref') {
          let ref = parseRef(part.display);
          if (ref.uuid === '') {
            span.addChild(new SpanElem().setText(part.display));
            return;
          }

          let shorter_datetime = renderDatetime(new Date(ref.datetime_id));
          if (shorter_datetime === 'invalid date') {
            shorter_datetime = ref.datetime_id;
          }

          let ref_snippet = '';
          let found_msg = retrieveMsg(part.display);
          console.log('found_msg', found_msg);
          if (found_msg.length > 0) {
            const snippetElem = elemLine(found_msg[0].msg);
            ref_snippet = snippetElem.toElement().outerHTML;
          }

          if (shorter_datetime === 'datetime error') {
            span.addChild(new SpanElem().setText(part.display));
            return;
          }

          const refDiv = new DivElem('ref_snippet');
          const getBtn = new ButtonElem('get').onClick(() => expandRef(getBtn.toElement(), part.display));
          const linkBtn = new LinkElem(part.url, shorter_datetime).onClick(() => {
            window.history.pushState({}, '', part.url);
            handleRouting();
            return false;
          });
          
          refDiv.addChild(getBtn);
          refDiv.addChild(linkBtn);
          if (ref_snippet) {
            refDiv.addChild(new SpanElem().setHTML(ref_snippet));
          }
          
          span.addChild(refDiv);
        } else if (part.type === 'internal_search') {
          const searchDiv = new DivElem().setStyle('display', 'inline');
          const getBtn = new ButtonElem('get').onClick(() => expandSearch(getBtn.toElement(), part.display));
          const linkBtn = new LinkElem(part.url, part.display).onClick(() => {
            window.history.pushState({}, '', part.url);
            handleRouting();
            return false;
          });
          
          searchDiv.addChild(getBtn);
          searchDiv.addChild(linkBtn);
          span.addChild(searchDiv);
        } else {
          const link = new LinkElem(part.url, part.display);
          span.addChild(link);
        }
      } else if (typeof part === 'string') {
        const stringSpan = new SpanElem('string_line_part').setText(part);
        span.addChild(stringSpan);
      } else {
        span.addChild(new SpanElem().setText(part.toString()));
      }
    });

    return span;
  }

  // TODO actually render these lines by parsing them.  for some reason they're not parsed.
  return new SpanElem().setText(line.toString());
}

export function elemMsg(item, mode, origin_content) {
  let date = Date.parse(timezoneCompatibility(item.date));
  
  let timestamp_content = renderDatetime(date);
  let href_id = `/disc/${item.origin}#${item.date}`;

  let show_private_messages = getGlobal().notes.show_private_messages();
  if (show_private_messages === "false") {
    if (item.content.includes("PRIVATE")) {
      return new DivElem(); // Empty element
    }
  }

  const msgDiv = new DivElem('msg').setAttribute('id', item.date);
  
  // Message menu
  const msgMenu = new DivElem('msg_menu');
  const timestampLink = new LinkElem(href_id, timestamp_content, 'msg_timestamp').onClick(() => {
    window.history.pushState({}, '', href_id);
    handleRouting();
    return false;
  });
  const originSpan = new SpanElem().setText(` ${item.origin.split('/')[0]}`);
  
  msgMenu.addChild(timestampLink);
  msgMenu.addChild(originSpan);

  // Message content
  const msgContent = new DivElem('msg_content');
  const line = elemLine(item.msg);
  msgContent.addChild(line);
  
  let style_option = item.origin !== getGlobal().notes.maybe_current_journal() ? " style='background: #5f193f'" : "";
  if (style_option) {
    msgContent.setStyle('background', '#5f193f');
  }

  // Message blocks
  const block_content = elemMsgBlockContent(item, origin_content);
  const has_block_content = block_content.toElement().innerHTML !== '' ? 'withcontent' : '';
  
  const msgBlocks = new DivElem(`msg_blocks ${has_block_content}`);
  msgBlocks.addChild(block_content);
  
  // Edit functionality
  let edit_link = '';
  let editable = '';
  if (origin_content !== undefined && item.origin === getCurrentNoteUuid() && item.origin.split('/')[0] === kazglobal.notes.local_repo_name()) {
    if (!checkWellFormed(item.origin)) {
      console.warn(item.origin, "should be well-formed");
    } else {
      let url = new URL(window.location.href);
      let editmsg = url.searchParams.get('editmsg');
      
      let style_display = 'inline';
      if (editmsg !== null) {
        style_display = 'none';
      }

      let edit_state = 'edit';
      if (editmsg === item.date) {
        edit_state = 'submit';
        style_display = 'inline';
        const editableLine = new SpanElem().setText(item.content.slice("msg: ".length));
        msgContent.addChild(editableLine);
        msgContent.setAttribute('contenteditable', 'true');

        const editableBlockContent = elemEditableMsgBlockContent(item);
        msgBlocks.addChild(editableBlockContent);
        msgBlocks.setAttribute('contenteditable', 'true');
        editable = "contenteditable='true'";
      }

      const editLink = new LinkElem('javascript:void(0)', edit_state, 'edit_msg')
        .setStyle('display', style_display)
        .onClick(() => editMessage(item.origin, item.date));
      
      msgMenu.addChild(editLink);
    }
  }

  if (editable) {
    msgContent.setAttribute('contenteditable', 'true');
    msgBlocks.setAttribute('contenteditable', 'true');
    msgBlocks.on('keydown', (e) => preventDivs(e));
  }

  msgDiv.addChild(msgMenu);
  msgDiv.addChild(msgContent);
  msgDiv.addChild(msgBlocks);
  
  return msgDiv;
}

function elemMsgBlockContent(msg, origin_content) {
  const fragment = document.createDocumentFragment();
  const blockElements = msg.blocks.map(block => {
    const blockElem = elemMsgBlock(block, origin_content);
    return blockElem.toElement();
  });
  fragment.append(...blockElements);
  
  // Trim trailing breaks
  const tempDiv = document.createElement('div');
  tempDiv.append(fragment);
  let content = tempDiv.innerHTML;
  if (content.endsWith("<br/>")) {
    content = content.slice(0, -("<br/>".length));
  }
  if (content.endsWith("<br>")) {
    content = content.slice(0, -("<br>".length));
  }
  
  const resultDiv = new DivElem();
  resultDiv.setHTML(content);
  return resultDiv;
}
