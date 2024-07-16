import { EmptyLine, TreeNode } from "/parse.js";

export function rewrite(page, note) {
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
  while (new_blocks.back() instanceof EmptyLine) {
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

export class Msg {
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

function rewriteBlock(block, note) {
  if (block.length === 1 && block[0] instanceof TreeNode) {
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
  }

  if (block instanceof Array) {
    return block.map((x) => typeof x === 'string' ? rewriteLine(x) : x); // might be a TreeNode
  }

  // TODO the rest of block rewrite
  // console.log('rewrite block array', block);

  return block;
}

export class Link {
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

export class Line {
  content;
  constructor(content, parsed) {
    this.content = content;
    this.parts = parsed;
  }

  toString() {
    return `Line(${this.content})`;
  }
}

function rewriteLine(line) {
  let original_line = line;
  if (! (line.includes(": ") || line.includes("http://") || line.includes("https://"))) {
    return new Line(original_line, tagParse(line));
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
  return new Line(original_line, acc);
}

// TAG

export class Tag {
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
