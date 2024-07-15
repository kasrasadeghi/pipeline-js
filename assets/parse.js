
export function parseContent(content) {
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
      sections.back().lines.push(L);
    }
  }

  for (let S of sections) {
    if (! ['METADATA', 'HTML'].includes(S.title)) {
      S.blocks = parseSection(S.lines);
    }
  }
  return sections;
}

export class EmptyLine {
  constructor() {}
  toJSON() {
    return 'EmptyLine{}';
  }
}

export function parseSection(lines) {
  let blocks = [];
  for (let L of lines) {
    if (L === '') {
      blocks.push(new EmptyLine())
    } else {
      // TODO what?  if there are no blocks or if the last block is a newline, add another one?
      if (blocks.length === 0 || blocks.back() instanceof EmptyLine) {
        blocks.push([]);
      }
      blocks.back().push(L)
    }
  }
  // console.log('block pre tree', blocks);
  // return blocks;
  return blocks.map(parseTree);
}

export class TreeNode {
  constructor(obj) {
    this.children = [];
    this.indent = obj.indent;
    this.value = obj.value;
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
    while (stack.length !== 0 && stack.back().indent >= indent) {
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
    if (stack.back().indent + 1 !== indent) {
      return block; // failure, children must be one indent deeper than their parent
    }
    stack.back().children.push(node);
    stack.push(node); // node is the new top of the stack, also added to prior top of stack
  }

  if (! found_children) {
    return block; // found no children, so there was no tree to parse
  }

  return roots;
}
