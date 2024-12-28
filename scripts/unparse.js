import { parseContent, TreeNode, EmptyLine } from './parse.js';
import { rewrite, Msg, Line } from './rewrite.js';

export function unparseContent(page) {
  let content = [];
  let first = true;
  for (let section of page) {
    let section_content = [];
    if (! first) {
      if (section.title === null) {
        section_content.push("---");
      } else {
        section_content.push(`--- ${section.title} ---`);
      }
    }
    if (['METADATA', 'HTML'].includes(section.title)) {
      section_content.push(...section.lines);
      content.push(section_content.join("\n"));
      if (section.title === 'HTML') {
        content.push('\n');
      }
      continue;
    }
    if (! first) {
      section_content.push("\n");
    }
    first = false;
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
  if (msg.blocks.length !== 0) {
    let trail = msg.gobbled_newline ? "\n".repeat(msg.gobbled_newline) : "";
    return ["- " + msg.content, '\n  - Date: ' + msg.compat_date(), "\n\n", unparseMessageBlocks(msg), trail].join("");
  } else {
    let trail = msg.gobbled_newline ? "\n".repeat(msg.gobbled_newline) : "";
    return ["- " + msg.content, '\n  - Date: ' + msg.compat_date(), "\n", trail].join("");
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
  let result = indent + unparseLineContent(thisNode.value) + "\n" + thisNode.children.map(x => unparseTreeNode(x, true)).join("");
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

function parseRef(ref) {
  let s = ref.split('#');  // a ref looks like: "uuid#datetime_id" 
  // EXAMPLE bigmac-js/f726c89e-7473-4079-bd3f-0e7c57b871f9.note#Sun Jun 02 2024 20:45:46 GMT-0700 (Pacific Daylight Time)
  console.assert(s.length == 2);
  let [uuid, datetime_id] = s;
  return {uuid, datetime_id};
}
