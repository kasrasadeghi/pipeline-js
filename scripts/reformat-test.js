
import { readFileSync, writeFileSync } from "node:fs";

import { rewrite } from "./rewrite.js";
import { unparseContent } from "./unparse.js";
import { parseContent } from "./parse.js";

let content = readFileSync(`./reformat-test.note`, { encoding: 'utf8', flag: 'r' });
let page = rewrite(parseContent(content), "./reformat-test.note");
let result = unparseContent(page);
console.log('result', result);
let page2 = rewrite(parseContent(result), "./reformat-test.note");

console.log('page2', page2.length);
console.assert(page2[1].lines.filter(x => x.startsWith('Date: '))[0].endWith(")"));
console.log("test passed");