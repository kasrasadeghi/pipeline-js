import { getGlobal } from '/global.js';
import { getCurrentNoteUuid, removeFromClipboard, unparseMessageBlocks, shortcircuitLink, retrieveMsg, clickInternalLink, checkWellFormed, preventDivs, Deleted, unparseContent, search, renderSearchMain, getClipboardMessages } from '/indexed-fs.js';
import { timezoneCompatibility } from '/date-util.js';
import { getNow } from '/state.js';
import { Msg, Line, Tag, Link } from '/rewrite.js';
import { EmptyLine, TreeNode } from '/parse.js';
import { parseContent, parseSection, splitLines } from '/parse.js';
import { rewrite, rewriteBlock, rewriteLine } from '/rewrite.js';
import { parseRef } from '/ref.js';

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

function sanitizeHTML(html) {
  // Create a temporary div to parse the HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Remove all style attributes and CSS classes
  const allElements = temp.querySelectorAll('*');
  allElements.forEach(el => {
    el.removeAttribute('style');
    el.removeAttribute('class');
    el.removeAttribute('id');
  });
  
  console.log('sanitizing html', temp);

  // Convert lists to dash format based on indentation level
  const lists = temp.querySelectorAll('ul, ol');
  lists.forEach(list => {
    const level = getIndentationLevel(list);
    const indentSpaces = '  '.repeat(level); // 2 spaces per level
    
    // Convert list items to dash format
    const listItems = list.querySelectorAll('li');
    const lines = [];
    listItems.forEach(li => {
      const text = li.textContent.trim();
      if (text) {
        lines.push(indentSpaces + '- ' + text);
      }
    });
    
    // Replace the list with a p tag containing the dash-formatted text with <br> tags
    // This ensures each list item appears on a new line in contenteditable divs
    // Using <p> since it's in the allowedTags list and won't be removed
    const replacementP = document.createElement('p');
    replacementP.innerHTML = lines.join('<br>') + '<br>';
    list.parentNode.replaceChild(replacementP, list);
  });
  
  // Replace <a> tags with their href URL (just the URL, not the link)
  // Do this before removing disallowed elements so we can extract the href
  const links = temp.querySelectorAll('a');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      const textNode = document.createTextNode(href);
      link.parentNode.replaceChild(textNode, link);
    } else {
      // If no href, just unwrap the link and keep the text content
      const textNode = document.createTextNode(link.textContent);
      link.parentNode.replaceChild(textNode, link);
    }
  });
  
  // Keep only allowed HTML tags and their content
  const allowedTags = ['p', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const walker = document.createTreeWalker(
    temp,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );
  
  const elementsToRemove = [];
  let node;
  while (node = walker.nextNode()) {
    if (!allowedTags.includes(node.tagName.toLowerCase())) {
      elementsToRemove.push(node);
    }
  }
  
  // Remove disallowed elements
  elementsToRemove.forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  });
  
  return temp.innerHTML;
}

function getIndentationLevel(element) {
  let level = 0;
  let parent = element.parentNode;
  
  while (parent && parent !== element.ownerDocument.body) {
    if (parent.tagName && (parent.tagName.toLowerCase() === 'ul' || parent.tagName.toLowerCase() === 'ol')) {
      level++;
    }
    parent = parent.parentNode;
  }
  
  return level;
}

function convertUrlsToLinks(text) {
  // URL regex pattern - matches http://, https://, or www. URLs
  const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  return text.replace(urlPattern, (url) => {
    // Ensure URLs starting with www. get https:// prefix
    const href = url.startsWith('http') ? url : `https://${url}`;
    return `<a href="${href}">${url}</a>`;
  });
}

export function htmlLine(line, mode) {
  if (line instanceof Line) {
    let result = line.parts.map(x => {
      if (x instanceof Tag) {
        return "<emph class='tag'>" + x.tag + "</emph>";
      }
      if (x instanceof Link) {
        if (x.type === 'shortcut') {
          if (mode === 'clipboard') {
            return `<span class="shortcut">${x.display}</span>`;
          }
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
          console.assert(!x.display.startsWith("/disc/"), x.display, 'should not start with /disc/ in ');
          let found_msg = retrieveMsg(ref);
          if (found_msg.length > 0) {
            ref_snippet = htmlLine(found_msg[0].msg);
          }

          if (shorter_datetime === 'datetime error') {
            // invalid datetime value
            return x;
          }
          if (mode === 'clipboard') {
            if (found_msg.length > 0) {
              ref_snippet = htmlLine(found_msg[0].msg, 'clipboard');
            }
            return `<div class="ref_snippet">
              <span class="ref_snippet_datetime">${shorter_datetime}</span>
              ${ref_snippet}
            </div>`;
          }
          return `<div class="ref_snippet">
            <button onclick="return expandRef(this, '${x.display}')">get</button>
            <a onclick="clickInternalLink('${x.url}'); return false;" href="${x.url}">${shorter_datetime}</a>
            ${ref_snippet}
          </div>`;
        }
        if (x.type === 'internal_search') {
          
          // TODO add time of search to search result?
          // let shorter_datetime = renderDatetime(new Date(ref.datetime_id));
          if (mode === 'clipboard') {
            return `<div style="display:inline">
              <span class="clipboard_link">${x.display}</span>
            </div>`;
          }
          return `<div style="display:inline">
            <button onclick="return expandSearch(this, '${x.display}')">get</button>
            <a onclick="clickInternalLink('${x.url}'); return false;" href="${x.url}">${x.display}</a>
          </div>`;
        }
        if (mode === 'clipboard') {
          return `<span class="clipboard_link">${x.display}</span>`;
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

export function htmlClipboard() {
  return `<div id="msg_clipboard">${htmlClipboardContent()}</div>`;
}

export function htmlClipboardContent() {
  return getClipboardMessages().map(msg_id => htmlClipboardMsg(msg_id)).join("");
}

export function htmlClipboardMsg(msg_id) {
  // msg_id looks like "uuid#datetime_id"
  let ref = parseRef(msg_id);
  let msg_item = retrieveMsg(ref)[0];
  if (msg_item === undefined) {
    return "";
  }
  return `<div class="clipboard_msg_row">
    <button class="clipboard_msg_remove" onclick="return removeFromClipboard('${msg_id}')">x</button>
    <a href="javascript:void(0)" class="clipboard_msg" onclick="return gotoDisc('${ref.id()}')">
      ${htmlLine(msg_item.msg, 'clipboard')}
    </a>
  </div>`;
}

export function htmlMsg(item, mode, origin_content) {
  // TODO i think i should delete the origin_content parameter, need to add some visual tests to make sure search and individual-message editing still work.
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
  const gather_button = `<a class="gather_msg" onclick="return gatherMessage('${item.ref_id()}')" href="javascript:void(0)">gather</a>`;


  return (`
    <div class='msg' id='${item.date}'>
      <div class="msg_menu">${msg_timestamp_link} ${item.origin.split('/')[0]} ${gather_button} ${edit_link}</div>
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
  console.log('editMessage called:', { item_origin_uuid, msg_id });
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

    // Add paste event handler to sanitize HTML content
    msg_content.addEventListener('paste', function(event) {
      console.log('paste event fired on msg_content');
      event.preventDefault();
      const clipboardData = event.clipboardData || window.clipboardData;
      let html = clipboardData.getData('text/html');
      let plainText = clipboardData.getData('text/plain');
      
      console.log('paste data:', { html, plainText });
      
      if (html && html.trim()) {
        console.log('html', html);
        // If HTML is available, sanitize it
        const sanitized = sanitizeHTML(html);
        console.log('sanitized:', sanitized);
        // Use Selection API instead of deprecated execCommand
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = sanitized;
          const fragment = document.createDocumentFragment();
          while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
          }
          range.insertNode(fragment);
          selection.collapseToEnd();
        } else {
          // Fallback to execCommand
          document.execCommand('insertHTML', false, sanitized);
        }
      } else if (plainText && plainText.trim()) {
        console.log('plainText:', plainText);
        // If only plain text is available, convert URLs to links and insert
        const textWithLinks = convertUrlsToLinks(plainText);
        console.log('textWithLinks:', textWithLinks);
        // Use Selection API instead of deprecated execCommand
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = textWithLinks;
          const fragment = document.createDocumentFragment();
          while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
          }
          range.insertNode(fragment);
          selection.collapseToEnd();
        } else {
          // Fallback to execCommand
          document.execCommand('insertHTML', false, textWithLinks);
        }
      } else {
        console.log('No paste data found');
      }
    });

    msg_block_content.innerHTML = htmlEditableMsgBlockContent(msg);
    msg_block_content.contentEditable = true;

    // Add paste event handler to message blocks as well
    msg_block_content.addEventListener('paste', function(event) {
      console.log('paste event fired on msg_block_content');
      event.preventDefault();
      const clipboardData = event.clipboardData || window.clipboardData;
      let html = clipboardData.getData('text/html');
      let plainText = clipboardData.getData('text/plain');
      
      console.log('paste data:', { html, plainText });
      
      if (html && html.trim()) {
        console.log('html', html);
        // If HTML is available, sanitize it
        const sanitized = sanitizeHTML(html);
        console.log('sanitized:', sanitized);
        // Use Selection API instead of deprecated execCommand
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = sanitized;
          const fragment = document.createDocumentFragment();
          while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
          }
          range.insertNode(fragment);
          selection.collapseToEnd();
        } else {
          // Fallback to execCommand
          document.execCommand('insertHTML', false, sanitized);
        }
      } else if (plainText && plainText.trim()) {
        console.log('plainText:', plainText);
        // If only plain text is available, convert URLs to links and insert
        const textWithLinks = convertUrlsToLinks(plainText);
        console.log('textWithLinks:', textWithLinks);
        // Use Selection API instead of deprecated execCommand
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = textWithLinks;
          const fragment = document.createDocumentFragment();
          while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
          }
          range.insertNode(fragment);
          selection.collapseToEnd();
        } else {
          // Fallback to execCommand
          document.execCommand('insertHTML', false, textWithLinks);
        }
      } else {
        console.log('No paste data found');
      }
    });

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
    console.log('Submitting edited message:', { item_origin_uuid, msg_id });
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
      let lines = splitLines(msg_block_content.innerText.trim());  // innerText is unix newlines, only http request are dos newlines
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
  let found_msg = retrieveMsg(parseRef(url));
  let result = htmlMsg(found_msg[0]);
  if (found_msg.length > 0) {
    console.log(found_msg);
    insertHtmlBeforeMessage(obj, result, /*name=*/"ref" + url);
  } else {
    console.log(`ERROR 4: couldn't find message at ${url}`);
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