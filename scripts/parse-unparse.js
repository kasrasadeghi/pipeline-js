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

export async function parseUnparseNote(note, note_dir) {
  console.log('fixing', note);
  let content = readFileSync(`${note_dir}/${note}`, { encoding: 'utf8', flag: 'r' });
  let page = rewrite(parseContent(content), note);
  let result = unparseContent(page);
  writeFileSync(`${note_dir}/${note}`, result, { encoding: 'utf8', flag: 'w' });
}

async function main() {
  let notes = [];
  `Usage: ${Bun.argv[0]} [note1] [note2] ...`;
  if (Bun.argv.length > 2) {
    notes = Bun.argv.slice(2);
  } else {
    notes = await notesList();
  }

  console.log('notes', notes);
  for (let note of notes) {
    try {
      await parseUnparseNote(note, NOTES_DIR);
    } catch (e) {
      console.log(e);
      exit(1);
    }
  }
}

await main();