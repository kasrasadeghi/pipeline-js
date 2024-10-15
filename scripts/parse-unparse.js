// this should run on bun.js and fix the notes

import { readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";

import { rewrite } from "./rewrite.js";
import { unparseContent } from "./unparse.js";
import { parseContent } from "./parse.js";
import { exit } from "node:process";

const NOTES_DIR = `${process.env.HOME}/notes`;

async function notesList() {
  let notes = await readdir(NOTES_DIR, { recursive: true });
  notes = notes.filter(x => x.endsWith('.note'));
  return notes;
}

async function main() {

  let notes = [];
  if (Bun.argv.length > 2) {
    notes = Bun.argv.slice(2);
  } else {
    notes = await notesList();
  }

  console.log('notes', notes);
  for (let note of notes) {
    try {
      console.log('fixing', note);
      let content = readFileSync(`${NOTES_DIR}/${note}`, { encoding: 'utf8', flag: 'r' });
      console.log('read');
      let page = rewrite(parseContent(content), note);
      console.log('rewritten');
      // console.log('page', page);
      let result = unparseContent(page);
      console.log('unparsed');
      writeFileSync(`${NOTES_DIR}/${note}`, result, { encoding: 'utf8', flag: 'w' });
      console.log('written');
    } catch (e) {
      console.log(e);
      exit(1);
    }
  }
}

main();