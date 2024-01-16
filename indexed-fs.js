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

let global = {today_uuid: null};
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

async function handle_msg(event) {
  console.log(event);
  event.preventDefault();

  let msg_input = document.getElementById('msg_input');
  handlers.msg(msg_input.value);
  return false;
}

async function run() {
  await global_notes.init();
  let main = document.getElementsByTagName('main')[0];
  console.log('today is', today());
  let notes = await getNotesWithTitle(today());
  console.log('notes', notes);
  if (notes.length === 0) {
    let uuid = await newNote(today());
    notes = [uuid];
  }

  // we can only handle messages once we know what today_uuid is
  global.today_uuid = notes[0];
  console.log('rendering', global.today_uuid);
  handlers.msg = async (msg) => {
    let msg_input = document.getElementById('msg_input');
    msg_input.value = '';
    console.log('msg', msg);

    let content = await global_notes.readFile(global.today_uuid);
    let lines = content.split("\n");
    const content_lines = lines.slice(0, lines.indexOf("--- METADATA ---"));
    const metadata_lines = lines.slice(lines.indexOf("--- METADATA ---"));
    const old_content = content_lines.join("\n");
    const metadata = metadata_lines.join("\n");

    const new_content = old_content + `\n- msg: ${msg}` + '\n' + `  - Date: ${new Date}` + '\n\n';
    await global_notes.writeFile(global.today_uuid, new_content + metadata);
    main.innerHTML = '<pre>' + await global_notes.readFile(global.today_uuid); + '</pre>';
  };


  main.innerHTML = '<pre>' + await global_notes.readFile(global.today_uuid); + '</pre>';
  // const exists = await global_notes.noteExists("uuid-12345");
  // console.log(content, exists);
}

