import { getGlobal } from '/global.js';
import { readBooleanFile } from '/boolean-state.js';
import { lookupIcon, MenuButton, ToggleButton } from '/components.js';

// calendar format, just the weekday
const weekday_format = new Intl.DateTimeFormat('en-us', { weekday: 'short', timeZone: 'UTC' });

// calendar header format, just the month and year
const calendar_header_format = new Intl.DateTimeFormat('en-us', { timeZone: 'UTC', month: 'long', year: 'numeric' });

const LIST_NOTES_TOGGLE_FILE = 'list notes toggle state';

// LIST

export async function gotoList() {
  window.history.pushState({}, "", "/list");
  await paintList();
  let main = document.getElementsByTagName('main')[0];
  main.scrollTop = 0;
}

const date_into_ymd = (date) => {
  let day = `${date.getDate()}`.padStart(2, '0');
  let month = `${date.getMonth() + 1}`.padStart(2, '0');
  let year = date.getFullYear();
  let key = `${year}-${month}-${day}`;
  return key;
};

const utcdate_into_ymd = (date) => {
  let day = `${date.getUTCDate()}`.padStart(2, '0');
  let month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  let year = date.getUTCFullYear();
  let key = `${year}-${month}-${day}`;
  return key;
};

const utcdate_to_weekday = (date) => {
  let day_of_week = date.getUTCDay(); // because days parsed from yyyy-mm-dd format will be in utc
  return day_of_week;
}

const compute_seasonal_color = (date_obj) => {
  let color = "black";
  let month = date_obj.getUTCMonth();

  const make = (r, g, b) => {  // each is a pair of [base, random factor]
    return {
      r: r[0] + Math.random() * r[1], 
      g: g[0] + Math.random() * g[1], 
      b: b[0] + Math.random() * b[1],
    };
  }

  let offset = (month % 3) * 30 + date_obj.getDate();

  let winter = make([70, offset], [70, offset], [160, 55]); // blue-purple
  let spring = make([170, 40], [70, 25], [100, 55]);  // pink
  let summer = make([50, 70], [150, 40], [50, 70]);  // green
  let fall = make([90 + offset, 50], [120, 50], [30, 10]);  // red-orange-yellow-green

  if (0 <= month && month < 3) {
    // blue-ish
    color = "rgb(" + winter.r + ", " + winter.g + ", " + winter.b + ")";
  } else if (3 <= month && month < 6) {
    // pink-ish
    color = "rgb(" + spring.r + ", " + spring.g + ", " + spring.b + ")";
  } else if (6 <= month && month < 9) {
    // green-ish
    color = "rgb(" + summer.r + ", " + summer.g + ", " + summer.b + ")";
  } else { // 9 <= month && month < 12
    // orange-ish
    color = "rgb(" + fall.r + ", " + fall.g + ", " + fall.b + ")";
  }
  return color;
}

export async function paintList() {
  document.title = "List - Pipeline Notes";
  // calendar view

  // draw boxes in a 7 wide grid like a calendar
  // each box is a day
  // each day has a number of notes

  // non-journal notes might be a bit more complicated, as they might have notes on separate days

  // gather notes to days
  console.time('paintList get days');
  let notes_by_day = getGlobal().notes.metadata_map.reduce((acc, note) => {
    let date = new Date(timezoneCompatibility(note.date));
    let key = date_into_ymd(date);
    if (acc[key] === undefined) {
      acc[key] = [];
    }
    acc[key].push(note);
    return acc;
  }, {});
  console.timeEnd('paintList get days');

  console.time('paintList sort days');
  let days = Object.entries(notes_by_day).sort();
  console.timeEnd('paintList sort days');

  console.time('paintList fill in days');
  if (days.length > 0) {
    let last = days[days.length - 1];
    let first = days[0];
    let first_date = new Date(first[0]);
    let last_date = new Date(last[0]);

    // put [] in days that have no notes between first and last
    
    while (first_date < last_date) {
      let key = utcdate_into_ymd(first_date);
      if (notes_by_day[key] === undefined) {
        notes_by_day[key] = [];  // populate empty days with empty lists
      }
      first_date.setDate(first_date.getDate() + 1); // increment days, even looping over months and years.  thanks javascript
    }

    last_date = new Date(last[0]);
    while (true) {
      last_date.setDate(last_date.getDate() + 1);  // go forward to the last saturday
      let key = utcdate_into_ymd(last_date);
      if (notes_by_day[key] === undefined) {
        notes_by_day[key] = [];  // populate empty days with empty lists
      }
      if (utcdate_to_weekday(last_date) === 6) {
        break;
      }
    }

    first_date = new Date(first[0]);
    while (true) {
      first_date.setDate(first_date.getDate() - 1);  // go back to the first sunday
      let key = utcdate_into_ymd(first_date);
      if (notes_by_day[key] === undefined) {
        notes_by_day[key] = [];  // populate empty days with empty lists
      }
      if (utcdate_to_weekday(first_date) === 0) {
        break;
      }
    }
  }
  console.timeEnd('paintList fill in days');

  console.time('paintList compute day features');
  let local_repo_name = getGlobal().notes.local_repo_name();
  let grid = Object.entries(notes_by_day).sort().reverse().map(([date, notes]) => {
    let date_obj = new Date(date);
    let color = compute_seasonal_color(date_obj);
    let weekday_name = weekday_format.format(date_obj);
    return {date, notes, color, weekday_name};
  });
  console.timeEnd('paintList compute day features');

  // split into chunks of 7
  
  let acc = [];
  const week_length = 7;
  for (let i = 0; i < grid.length; i += week_length) {
    acc.push(grid.slice(i, i + week_length));
  }

  let render_notes = await readBooleanFile(LIST_NOTES_TOGGLE_FILE, "false");

  console.time('paintList render weeks');
  let weeks = acc
    // .slice(0, 1)
    .map((week) => {
      let year_months_in_week = {};
      let week_notes = [];
      let days = week.reverse().map(({date, notes, color, weekday_name}) => {
        let date_obj = new Date(date);
        year_months_in_week[calendar_header_format.format(date_obj)] = true;
        const is_journal = note => note.metadata.Tags && note.metadata.Tags.includes('Journal');
        let journals = notes.filter(n => is_journal(n));
        let not_journals = notes.filter(n => !is_journal(n));
        if (not_journals.length > 0) {
          week_notes.push({date, notes: not_journals});
        }
        let link_el = document.createElement('div');
        link_el.classList.add('calendar', 'links');
        link_el.innerHTML = weekday_name;
        if (journals.length > 0) {
          let has_local_journal = journals.some(n => n.uuid.startsWith(local_repo_name));
          let note = (has_local_journal) ? journals.find(n => n.uuid.startsWith(local_repo_name)) : journals[0];

          let title = note.title;
          if (note.title.split(" ").length === 3) {
            // January 12th, 2024 -> 12
            let [month, day, year] = note.title.split(" ");
            
            title = day.slice(0, day.length - 3);
          }
          
          let journal_link = `<a href="/disc/${note.uuid}">${title}</a>`
          link_el.innerHTML = `${weekday_name} ${journal_link}`;
        }
        let day_el = document.createElement('div');
        day_el.classList.add('calendar', 'day');
        day_el.style.backgroundColor = color;
        day_el.append(link_el);
        return day_el;;
      });
      let notes = [];
      if (render_notes === "true") {
        const notelist = (notes) => notes.map(note => {
          // `<li class='calendar note'><a href="/disc/${note.uuid}">${note.title}</a></li>`
          let li_el = document.createElement('li');
          li_el.classList.add('calendar', 'note');
          let a_el = document.createElement('a');
          a_el.href = `/disc/${note.uuid}`;
          a_el.innerHTML = note.title;
          li_el.appendChild(a_el);
          return li_el;
        });
        let all_notes = week_notes.map(({date, notes}) => {
          // `<ul class="calendar notelist">${date}` + notelist(notes) + `</ul>`
          let ul_el = document.createElement('ul');
          ul_el.classList.add('calendar', 'notelist');
          let date_el = document.createElement('div');
          date_el.innerHTML = date;
          ul_el.appendChild(date_el);
          ul_el.append(...notelist(notes));
          return ul_el;
        });
        // notes = `<div class='calendar noteset'>` + all_notes + "</div>";
        let notes_el = document.createElement('div');
        notes_el.classList.add('calendar', 'noteset');
        notes_el.append(...all_notes);
        notes.push(notes_el);
      }

      let year_months = Object.keys(year_months_in_week).map(x => {
        // `<div class='calendar year-month'>${x}</div>`
        let el = document.createElement('div');
        el.classList.add('calendar', 'year-month');
        el.innerHTML = x;
        return el;
      });
      let week_header = document.createElement('div');
      week_header.classList.add('calendar', 'week-header');
      week_header.append(...year_months);

      let week_el = document.createElement('div');
      week_el.classList.add('calendar', 'week');
      week_el.append(week_header);

      let weekdays = document.createElement('div');
      weekdays.classList.add('weekdays');
      weekdays.append(...days);

      week_el.append(weekdays);

      week_el.append(...notes);

      // return `<div class='calendar week'><div class='calendar week-header'>${year_months.join(" ")}</div><div class='weekdays'>` + days.join("") + `</div>${notes}</div>`;
      return week_el;
    });
  console.timeEnd('paintList render weeks');
  
  // elements seem faster than strings and innerHtml
  let main = document.getElementsByTagName('main')[0];
  main.replaceChildren(...weeks);
  // let rows = getGlobal().notes.metadata_map.sort((a, b) => dateComp(b, a)).map(x => `<tr><td>${x.uuid.split('/')[0]}</td><td><a href="/disc/${x.uuid}">${x.title}</a></td></tr>`).join("\n");
  // let table = "<table><tr><th>repo</th><th>title</th></tr>" + rows + "</table>";
  let footer = document.getElementsByTagName('footer')[0];
  footer.innerHTML = `
    ${MenuButton({icon: 'journal', action: 'gotoJournal()'})}
    ${MenuButton({icon: 'menu', action: 'gotoMenu()'})}
    ${await ToggleButton({id: 'list_notes_toggle', file: LIST_NOTES_TOGGLE_FILE, query_param: 'show_notes', label: lookupIcon('notes'), rerender: 'paintList'})}
    `;
}