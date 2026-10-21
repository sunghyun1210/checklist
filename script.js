const STORAGE_KEY = 'checklist-v2'; // the old per-day/week/month data is not used any more
const CATEGORY_KEY = 'checklist-v2-categories';
const FOLD_KEY = 'checklist-v2-folded'; // which sidebar groups are folded (a convenience, not task data)
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Category colors: c = text and dot, s = soft background
const PALETTE = [
  { c: '#4f7fd1', s: '#e4ecfa' },
  { c: '#8b6fc8', s: '#ece6f8' },
  { c: '#c0894a', s: '#f6ebdc' },
  { c: '#3f9a8c', s: '#dff0ed' },
  { c: '#cc6b86', s: '#f8e4ea' },
  { c: '#6a9a4f', s: '#e7f0df' },
  { c: '#d1763f', s: '#f9e7db' },
  { c: '#6b7f99', s: '#e6ebf1' },
];

const $ = (id) => document.getElementById(id);

// Each item: { id, text, category, minutes, due, done, doneDate }
// due and doneDate are 'YYYY-MM-DD' strings (doneDate is '' until the item is checked)
let items = loadItems();
let savedCategories = loadCategories(); // names made with "+ Add category"; they stay even without tasks
let view = 'checklist'; // 'checklist' | 'calendar'
let subList = 'all'; // checklist: 'all' shows finished items too, 'todo' hides them
let calMode = 'month'; // calendar: 'month' | 'week'
// sidebar filter: '' = everything (Inbox), 'cat:' + lowercase category name,
// or 'smart:today' | 'smart:next' | 'smart:overdue' | 'smart:completed'
let filter = '';
let query = ''; // text typed in the search box (lowercase)
let calDate = new Date(); // any day inside the month / week shown in the calendar
let miniMonth = new Date(); // month shown in the small calendar in the sidebar
let undoStack = []; // older versions of `items` (as JSON text), newest last
let redoStack = []; // versions that were undone

// ---------- Storage ----------

function loadItems() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(data) ? data.map(cleanItem) : [];
  } catch (e) {
    return []; // broken or missing data: start fresh
  }
}

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function loadCategories() {
  try {
    const data = JSON.parse(localStorage.getItem(CATEGORY_KEY));
    return Array.isArray(data) ? data.filter((n) => typeof n === 'string' && n) : [];
  } catch (e) {
    return [];
  }
}

function saveCategories() {
  localStorage.setItem(CATEGORY_KEY, JSON.stringify(savedCategories));
}

// Everything undo has to bring back: the tasks and the list of saved categories
function snapshot() {
  return JSON.stringify({ items: items, categories: savedCategories });
}

// Every change to the tasks or categories goes through here:
// run it, remember the old version for undo, save, redraw
function change(fn) {
  const before = snapshot();
  fn();
  if (snapshot() !== before) {
    undoStack.push(before);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = []; // a new change ends the redo history
  }
  saveItems();
  saveCategories();
  render();
}

// Move one step from one stack to the other (undo: undoStack -> redoStack, redo: the opposite)
function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  const data = JSON.parse(from.pop());
  items = data.items.map(cleanItem);
  savedCategories = data.categories;
  saveItems();
  saveCategories();
  render();
}

function undo() {
  restore(undoStack, redoStack);
}

function redo() {
  restore(redoStack, undoStack);
}

// Make sure every field exists and has the right type
function cleanItem(it) {
  return {
    id: String(it.id || newId()),
    text: String(it.text || ''),
    category: typeof it.category === 'string' ? it.category : '',
    minutes: Number(it.minutes) || 0,
    due: /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? it.due : todayKey(),
    done: !!it.done,
    doneDate: it.done && typeof it.doneDate === 'string' ? it.doneDate : '',
  };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ---------- Dates ----------

function pad(n) {
  return String(n).padStart(2, '0');
}

// Date -> '2026-10-25' (built by hand, because toISOString() uses UTC and can be a day off)
function dateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayKey() {
  return dateKey(new Date());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function shortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Short label for a row: Today, Tmrw, Oct 25
function dateLabel(key) {
  const today = fromKey(todayKey());
  if (key === dateKey(today)) return 'Today';
  if (key === dateKey(addDays(today, 1))) return 'Tmrw';
  return shortDate(fromKey(key));
}

// Heading of a date group: Today, Tomorrow, Sun, Oct 25
function groupTitle(key) {
  const today = fromKey(todayKey());
  if (key === dateKey(today)) return 'Today';
  if (key === dateKey(addDays(today, 1))) return 'Tomorrow';
  return fromKey(key).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Heading in the Completed list: Today, Yesterday, Mon, Oct 19 ('' = finished before dates were saved)
function doneTitle(key) {
  if (!key) return 'Earlier';
  const today = fromKey(todayKey());
  if (key === dateKey(today)) return 'Today';
  if (key === dateKey(addDays(today, -1))) return 'Yesterday';
  return fromKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- Typing shortcuts: @category, t25, d10/25 ----------

// The part after "d": 10/25, +3, tom, today, mon ... sun  ->  '2026-10-25' ('' if invalid)
function dueFromCode(code) {
  const now = fromKey(todayKey());
  code = code.toLowerCase();

  if (code === 'today') return dateKey(now);
  if (code === 'tom') return dateKey(addDays(now, 1));
  if (code[0] === '+') return dateKey(addDays(now, Number(code.slice(1))));

  const dayIndex = DAYS.indexOf(code);
  if (dayIndex !== -1) {
    const diff = (dayIndex - now.getDay() + 7) % 7 || 7; // the next such weekday, never today
    return dateKey(addDays(now, diff));
  }

  const [m, d] = code.split('/').map(Number);
  const date = new Date(now.getFullYear(), m - 1, d);
  if (date.getMonth() !== m - 1) return ''; // something like 2/31 rolled over to another month
  return dateKey(date);
}

// "@AIE510 quiz 3 t25 d10/25" -> { category: 'AIE510', text: 'quiz 3', minutes: 25, due: '2026-10-25' }
function parseInput(raw) {
  let cat = '';
  let minutes = 0;
  let due = '';

  let text = raw.replace(/(^|\s)@(\S+)/, (_, space, name) => {
    cat = name; // only the first @word counts
    return space;
  });

  // "t25" as its own word means 25 minutes
  text = text.replace(/(^|\s)t(\d+)(?=\s|$)/i, (_, space, number) => {
    minutes = Number(number);
    return space;
  });

  // "d10/25", "d+3", "dtom", "dmon" as their own word set the due date
  const dueWord = /(^|\s)d(\+\d+|\d{1,2}\/\d{1,2}|today|tom|sun|mon|tue|wed|thu|fri|sat)(?=\s|$)/i;
  text = text.replace(dueWord, (match, space, code) => {
    due = dueFromCode(code);
    return due ? space : match; // an invalid date stays as normal text
  });

  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^"(.*)"$/, '$1'); // the placeholder shows the task in quotes
  return { category: cat, text: text.trim(), minutes: minutes, due: due };
}

// 25 -> "25m", 75 -> "1h 15m", 120 -> "2h"
function formatMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return m + 'm';
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}

// '2026-10-25' -> ' d10/25' (only for this year, because the shortcut has no year)
function dateToken(key) {
  const d = fromKey(key);
  if (d.getFullYear() !== new Date().getFullYear()) return '';
  return ' d' + (d.getMonth() + 1) + '/' + d.getDate();
}

// ---------- Categories and the sidebar filter ----------

// Saved categories first, then the ones that only exist because a task uses them.
// (@aie510 and @AIE510 count as the same one)
function categoryNames() {
  const names = [];
  const addName = (name) => {
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
  };
  savedCategories.forEach(addName);
  items.forEach((item) => addName(item.category));
  return names;
}

// Reuse the spelling already in use if there is one
function canonicalCategory(name) {
  return categoryNames().find((n) => n.toLowerCase() === name.toLowerCase()) || name;
}

// The same name always gets the same color, even when other categories come and go
function colorize(node, name) {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = PALETTE[hash % PALETTE.length];
  node.style.setProperty('--c', color.c);
  node.style.setProperty('--s', color.s);
}

const SMART_TITLES = {
  today: 'Today',
  next: 'Next 7 days',
  overdue: 'Overdue',
  completed: 'Completed',
};

// Smart lists: Today = due today, Next 7 days = unfinished from tomorrow on,
// Overdue = unfinished and past due, Completed = finished
function matchesSmart(kind, item) {
  const today = fromKey(todayKey());
  const key = dateKey(today);
  if (kind === 'today') return item.due === key;
  if (kind === 'next') return !item.done && item.due > key && item.due <= dateKey(addDays(today, 7));
  if (kind === 'overdue') return !item.done && item.due < key;
  return item.done; // completed
}

function matchesFilter(item) {
  if (!filter) return true;
  if (filter.startsWith('smart:')) return matchesSmart(filter.slice(6), item);
  return 'cat:' + item.category.toLowerCase() === filter;
}

function matchesQuery(item) {
  return item.text.toLowerCase().includes(query);
}

// What the person is looking at: the sidebar filter and the search box together
function isVisible(item) {
  return matchesFilter(item) && matchesQuery(item);
}

function filteredItems() {
  return items.filter(isVisible);
}

// ---------- Rendering ----------

// Small helper: create an element with a class and text
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text; // textContent keeps user input safe from HTML injection
  return e;
}

function render() {
  $('today-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  document.querySelectorAll('#main-tabs button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.view === view);
  });

  const calendar = view === 'calendar';
  $('checklist-view').hidden = calendar;
  $('calendar-view').hidden = !calendar;

  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;

  renderSidebar();
  renderMiniCalendar();
  renderHead();
  if (calendar) {
    renderCalendar();
  } else {
    renderChecklist();
  }
}

function renderSidebar() {
  const names = categoryNames();

  // The selected category may be gone (its items were deleted): back to everything
  if (filter.startsWith('cat:') && !names.some((n) => 'cat:' + n.toLowerCase() === filter)) {
    filter = '';
  }

  const left = (test) => items.filter((it) => !it.done && test(it)).length;

  $('inbox-count').textContent = left(() => true) || '';
  $('inbox').classList.toggle('active', filter === '');

  // Smart lists: highlight the selected one and show the numbers
  document.querySelectorAll('#group-inbox [data-filter^="smart:"]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  document.querySelectorAll('[data-smart]').forEach((count) => {
    const kind = count.dataset.smart;
    const n = items.filter((it) => (kind === 'completed' ? it.done : !it.done) && matchesSmart(kind, it)).length;
    count.textContent = n || '';
  });

  const list = $('category-list');
  list.innerHTML = '';
  names.forEach((name) => {
    const key = 'cat:' + name.toLowerCase();
    const btn = el('button', 'side-item');
    btn.type = 'button';
    btn.dataset.filter = key;
    btn.dataset.name = name;
    btn.classList.toggle('active', filter === key);
    colorize(btn, name);

    const handle = el('span', 'cat-handle', '≡'); // drag to reorder
    handle.setAttribute('aria-label', 'Drag to reorder');
    btn.append(
      handle,
      el('span', 'dot'),
      el('span', '', name),
      el('span', 'side-count', left((it) => it.category.toLowerCase() === name.toLowerCase()) || '')
    );

    // Pencil (shows on hover): rename
    const edit = el('span', 'cat-edit');
    edit.setAttribute('aria-label', 'Rename category');
    edit.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/>' +
      '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    btn.append(edit);

    // A saved category with no tasks at all can be removed again
    const used = items.some((it) => it.category.toLowerCase() === name.toLowerCase());
    if (!used) {
      const remove = el('span', 'remove-cat', '×');
      remove.dataset.name = name;
      remove.setAttribute('aria-label', 'Remove category');
      btn.append(remove);
      btn.classList.add('has-remove');
    }
    list.append(btn);
  });
}

// Small month in the sidebar: a dot under every day that has tasks
function renderMiniCalendar() {
  const first = new Date(miniMonth.getFullYear(), miniMonth.getMonth(), 1);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const start = addDays(first, -first.getDay());
  $('mini-title').textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const grid = $('mini-grid');
  grid.innerHTML = '';
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((letter) => grid.append(el('span', '', letter)));

  const withTasks = new Set(items.map((it) => it.due));
  const today = todayKey();
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i);
    const key = dateKey(day);
    const classes = [];
    if (day.getMonth() !== first.getMonth()) classes.push('other');
    if (key === today) classes.push('today');
    if (withTasks.has(key)) classes.push('has');

    const btn = el('button', classes.join(' '), String(day.getDate()));
    btn.type = 'button';
    btn.dataset.day = key;
    grid.append(btn);
  }
}

// Sub toolbar: the tabs depend on the main tab; the four numbers always count everything.
// Late items are not counted in "Due today" / "This week" (they have their own number),
// and "Done" is only what was finished today, so it starts from 0 again every day.
function renderHead() {
  const options =
    view === 'checklist'
      ? [['all', 'All'], ['todo', 'To do']]
      : [['week', 'Weekly'], ['month', 'Monthly']];
  const current = view === 'checklist' ? subList : calMode;

  const tabs = $('sub-tabs');
  tabs.innerHTML = '';

  // These lists only contain unfinished (or only finished) tasks, so All / To do would do nothing
  tabs.hidden = view === 'checklist' && ['smart:next', 'smart:overdue', 'smart:completed'].includes(filter);
  options.forEach(([key, label]) => {
    const btn = el('button', current === key ? 'on' : '', label);
    btn.type = 'button';
    btn.dataset.sub = key;
    tabs.append(btn);
  });

  const mine = items; // always everything: the numbers do not change with the sidebar filter or search
  const open = mine.filter((it) => !it.done);
  const today = fromKey(todayKey());
  const weekEnd = dateKey(addDays(today, 6 - today.getDay())); // the week ends on Saturday

  $('sum-today').textContent = open.filter((it) => it.due === dateKey(today)).length;
  $('sum-week').textContent = open.filter((it) => it.due >= dateKey(today) && it.due <= weekEnd).length;
  $('sum-late').textContent = open.filter((it) => it.due < dateKey(today)).length;
  $('sum-done').textContent = mine.filter((it) => it.doneDate === dateKey(today)).length;
}

function renderChecklist() {
  let title = 'All tasks';
  if (filter.startsWith('smart:')) {
    title = SMART_TITLES[filter.slice(6)];
  } else if (filter) {
    title = categoryNames().find((n) => 'cat:' + n.toLowerCase() === filter);
  }
  $('view-title').textContent = query ? title + ' · “' + query + '”' : title;

  const completedList = filter === 'smart:completed'; // always shows finished items
  const shown = filteredItems().filter((it) => subList === 'all' || completedList || !it.done);
  const today = todayKey();
  const groups = [];

  if (completedList) {
    // Finished items, newest first, grouped by the day they were finished
    [...new Set(shown.map((it) => it.doneDate))].sort().reverse().forEach((day) => {
      groups.push({ title: doneTitle(day), items: shown.filter((it) => it.doneDate === day) });
    });
  } else {
    // Unfinished items that are past due go into one Overdue group on top
    const overdue = shown.filter((it) => !it.done && it.due < today);
    if (overdue.length) groups.push({ title: 'Overdue', items: overdue, late: true });

    // Everything else is grouped by date, unfinished first and finished (faded) at the bottom
    const rest = shown.filter((it) => !overdue.includes(it));
    [...new Set(rest.map((it) => it.due))].sort().forEach((due) => {
      groups.push({
        title: groupTitle(due),
        date: due,
        items: rest.filter((it) => it.due === due).sort((a, b) => a.done - b.done), // stable sort
      });
    });
  }

  const box = $('groups');
  box.innerHTML = '';
  groups.forEach((group) => {
    const section = el('section', 'group');
    if (group.date) section.dataset.date = group.date; // so the small calendar can scroll here
    const heading = el('h3', group.late ? 'overdue' : '', group.title);
    if (group.late) {
      const move = el('button', 'move-all', 'Move all to today');
      move.type = 'button';
      heading.append(move);
    }
    const ul = document.createElement('ul');
    group.items.forEach((item) => ul.append(makeRow(item)));
    section.append(heading, ul);
    box.append(section);
  });

  // Footer: remaining count and time (hidden when there is nothing to show)
  const remaining = shown.filter((it) => !it.done);
  const minutesLeft = remaining.reduce((sum, it) => sum + it.minutes, 0);
  let text = remaining.length + (remaining.length === 1 ? ' item left' : ' items left');
  if (minutesLeft) text += ' · ' + formatMinutes(minutesLeft);
  $('count').textContent = text;
  $('footer').hidden = shown.length === 0;
  $('clear-done').hidden = !shown.some((it) => it.done); // nothing finished is shown: nothing to clear
}

function makeRow(item) {
  const li = el('li', 'row');
  li.dataset.id = item.id;
  li.classList.toggle('done', item.done);

  // Only unfinished items can be dragged
  if (!item.done) {
    const handle = el('span', 'handle', '≡');
    handle.setAttribute('aria-label', 'Drag to reorder');
    li.append(handle);
  }

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = item.done;
  li.append(checkbox, el('span', 'text', item.text));

  // The small labels live in one box, so a phone can move them to a second line.
  // Category label: not shown when a category is already selected in the sidebar.
  const meta = el('span', 'meta');
  if (item.category && !filter.startsWith('cat:')) {
    const tag = el('span', 'pill cat', item.category);
    colorize(tag, item.category);
    meta.append(tag);
  }
  if (item.minutes) meta.append(el('span', 'pill', formatMinutes(item.minutes)));

  const late = !item.done && item.due < todayKey();
  meta.append(el('span', late ? 'pill late' : 'pill', dateLabel(item.due)));
  li.append(meta);

  const del = el('button', 'delete', '×');
  del.type = 'button';
  del.setAttribute('aria-label', 'Delete');
  li.append(del);
  return li;
}

// ---------- Calendar ----------

// "Oct 18 - 24, 2026" (or "Oct 26 - Nov 1, 2026" when the week crosses a month)
function weekTitle(start) {
  const end = addDays(start, 6);
  const endText = start.getMonth() === end.getMonth() ? end.getDate() : shortDate(end);
  return shortDate(start) + ' – ' + endText + ', ' + end.getFullYear();
}

// A task shown inside a day, in its category color
function makeEvent(item, showTime) {
  const ev = el('div', item.done ? 'ev done' : 'ev', item.text);
  if (item.category) colorize(ev, item.category);
  if (showTime && item.minutes) ev.append(el('em', '', formatMinutes(item.minutes)));
  return ev;
}

// Unfinished first, finished at the end
function itemsOn(key) {
  return filteredItems().filter((it) => it.due === key).sort((a, b) => a.done - b.done);
}

function renderCalendar() {
  const week = calMode === 'week';
  $('cal-month').hidden = week;
  $('cal-week').hidden = !week;

  const today = todayKey();

  if (week) {
    const start = addDays(calDate, -calDate.getDay()); // weeks start on Sunday
    $('cal-title').textContent = weekTitle(start);

    const grid = $('cal-week');
    grid.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const key = dateKey(day);
      const col = el('div', key === today ? 'col today' : 'col');
      col.dataset.date = key;

      const header = el('header');
      header.append(el('small', '', DAYS[i].toUpperCase()), el('b', '', String(day.getDate())));
      col.append(header);

      const dayItems = itemsOn(key);
      dayItems.forEach((it) => col.append(makeEvent(it, true)));
      if (!dayItems.length) col.append(el('div', 'empty', '·'));
      grid.append(col);
    }
    return;
  }

  // Month: only the weeks that belong to this month, so the tiles can be as tall as possible
  const first = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
  const daysInMonth = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const start = addDays(first, -first.getDay());
  $('cal-title').textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const grid = $('cal-month');
  grid.innerHTML = '';
  grid.style.gridTemplateRows = 'auto repeat(' + weeks + ', minmax(0, 1fr))';
  DAYS.forEach((name) => grid.append(el('div', 'weekday', name.toUpperCase())));

  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i);
    const key = dateKey(day);
    const cell = el('div', 'cell');
    cell.dataset.date = key;
    if (day.getMonth() !== first.getMonth()) cell.classList.add('other');
    if (key === today) cell.classList.add('today');
    cell.append(el('span', 'day', String(day.getDate())));

    // At most 3 tasks per day, the rest is "+N more" (the Weekly view shows everything)
    const dayItems = itemsOn(key);
    dayItems.slice(0, 3).forEach((it) => cell.append(makeEvent(it, false)));
    if (dayItems.length > 3) cell.append(el('div', 'more', '+' + (dayItems.length - 3) + ' more'));
    grid.append(cell);
  }
}

// ---------- New task popup ----------

const dialog = $('task-dialog');
const form = $('add-form');
const input = $('new-item');

// date: optional 'YYYY-MM-DD' to start with (default is today)
function openTaskDialog(date) {
  const names = categoryNames();
  const select = $('chip-category');
  select.innerHTML = '';
  select.append(new Option('Category', ''));
  names.forEach((name) => select.append(new Option(name, name)));
  select.value = names.find((n) => 'cat:' + n.toLowerCase() === filter) || '';

  $('chip-date').value = date || todayKey();
  $('chip-minutes').value = '0';
  input.value = '';
  showPreview();
  dialog.showModal();
  input.focus();
}

// Under the text box: small labels for the @category, t25 and d10/25 that were recognized
function showPreview() {
  const parsed = parseInput(input.value);
  const box = $('preview');
  box.innerHTML = '';

  if (parsed.category) {
    const pill = el('span', 'pill cat', '@' + parsed.category);
    colorize(pill, parsed.category);
    box.append(pill);
  }
  if (parsed.minutes) box.append(el('span', 'pill', formatMinutes(parsed.minutes)));
  if (parsed.due) box.append(el('span', 'pill', dateLabel(parsed.due)));
}

input.addEventListener('input', showPreview);

$('new-task').addEventListener('click', () => openTaskDialog());

// Shift+A opens the popup from anywhere (not while typing, and not when a popup is already open)
document.addEventListener('keydown', (e) => {
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'a') return;
  if (e.target.closest && e.target.closest('input:not([type="checkbox"]), textarea, select')) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault(); // so the letter is not typed into the box that is about to get focus
  openTaskDialog();
});

// Click on the dark area around a popup closes it (Esc works by default)
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
});

form.addEventListener('submit', (e) => {
  e.preventDefault(); // stop the page from reloading
  const parsed = parseInput(input.value);
  if (!parsed.text) return; // ignore empty input

  // Things typed in the text win over the buttons below it
  const cat = parsed.category || $('chip-category').value;
  change(() => {
    items.push({
      id: newId(),
      text: parsed.text,
      category: cat ? canonicalCategory(cat) : '',
      minutes: parsed.minutes || Number($('chip-minutes').value),
      due: parsed.due || $('chip-date').value || todayKey(),
      done: false,
      doneDate: '',
    });
  });
  dialog.close();
});

// ---------- Settings: backup and reset ----------

const settings = $('settings-dialog');

$('open-settings').addEventListener('click', () => settings.showModal());
$('close-settings').addEventListener('click', () => settings.close());

// Download all items as a JSON file
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'checklist-backup.json';
  link.click();
  URL.revokeObjectURL(link.href);
});

// Pick a backup file and replace the current items with it
$('import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so the same file can be picked again
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error('not a list');
    if (!confirm('Replace all current tasks with this backup?')) return;
    change(() => {
      items = data.filter((it) => it && typeof it.text === 'string').map(cleanItem);
    });
    settings.close();
  } catch (err) {
    alert('That file is not a valid backup.');
  }
});

$('clear-all').addEventListener('click', () => {
  if (!confirm('Delete all tasks? This cannot be undone.')) return;
  change(() => {
    items = [];
    savedCategories = [];
  });
  settings.close();
});

// ---------- List events ----------

const groupsBox = $('groups');

// One listener for all checkboxes and delete buttons
groupsBox.addEventListener('click', (e) => {
  // "Move all to today" in the Overdue heading
  if (e.target.matches('.move-all')) {
    change(() => {
      items.forEach((it) => {
        if (!it.done && it.due < todayKey() && isVisible(it)) it.due = todayKey();
      });
    });
    return;
  }

  const li = e.target.closest('li');
  if (!li) return;
  const item = items.find((it) => it.id === li.dataset.id);

  if (e.target.matches('input[type="checkbox"]')) {
    const checked = e.target.checked;
    change(() => {
      item.done = checked;
      item.doneDate = checked ? todayKey() : '';
    });
  } else if (e.target.matches('.delete')) {
    change(() => {
      items = items.filter((it) => it !== item);
    });
  }
});

// Double-click an item's text to edit it in place
groupsBox.addEventListener('dblclick', (e) => {
  if (!e.target.matches('.text')) return;
  const item = items.find((it) => it.id === e.target.closest('li').dataset.id);

  // Show the item the way it was typed, so @category, t25 and d10/25 can be edited too
  const edit = el('input', 'edit');
  edit.type = 'text';
  edit.value =
    (item.category ? '@' + item.category + ' ' : '') +
    item.text +
    (item.minutes ? ' t' + item.minutes : '') +
    dateToken(item.due);
  e.target.replaceWith(edit);
  edit.focus();
  edit.select();

  let finished = false; // render() removes the input, which fires blur again
  function finish(save) {
    if (finished) return;
    finished = true;
    const parsed = parseInput(edit.value);
    if (save && parsed.text) { // empty text: keep the old item
      change(() => {
        item.text = parsed.text;
        item.category = parsed.category ? canonicalCategory(parsed.category) : '';
        item.minutes = parsed.minutes;
        if (parsed.due) item.due = parsed.due;
      });
    } else {
      render();
    }
  }

  edit.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') finish(true);
    if (ev.key === 'Escape') finish(false);
  });
  edit.addEventListener('blur', () => finish(true));
});

// Drag to reorder (tasks and categories use the same code).
// With a mouse you can grab the row anywhere; on a phone only the ≡ handle works,
// because a finger on the row has to scroll the page.
// The grabbed row follows the pointer, the other rows slide out of the way, and on release
// the row slides into its place before the new order is saved.
//   container   the element that holds the rows
//   rowSelector which elements are the rows
//   onDrop(list) is called with the list element after a drag, to save the new order
const SLIDE_MS = 160;
let dragLocked = false; // true while a dropped row is still sliding into place

function enableDrag(container, rowSelector, onDrop) {
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || dragLocked) return;
    const row = e.target.closest(rowSelector);
    if (!row || !container.contains(row)) return;

    const onHandle = e.target.closest('.handle, .cat-handle');
    if (!onHandle) {
      if (e.pointerType === 'touch') return; // a finger scrolls; it uses the handle
      // Checkboxes, delete buttons and text boxes keep their normal behavior
      if (e.target.closest('input, textarea, select, .delete, .remove-cat, .cat-edit')) return;
    }

    const list = row.parentElement;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let grabY = startY; // where the pointer was when the drag really started
    let startTop = 0; // where the row was on screen at that moment

    function begin(y) {
      dragging = true;
      grabY = y;
      startTop = row.getBoundingClientRect().top;
      row.classList.add('dragging');
      document.body.classList.add('drag-active'); // no text selection, grabbing cursor
      window.getSelection().removeAllRanges();
    }

    // Keep the grabbed row under the pointer, whatever its place in the list is
    function follow(y) {
      row.style.transform = 'none';
      const natural = row.getBoundingClientRect().top;
      row.style.transform = 'translateY(' + (startTop + (y - grabY) - natural) + 'px)';
    }

    // Put the grabbed row before / after `target`; the other rows slide to their new places
    function moveRow(target, below) {
      const others = [...list.children].filter((c) => c !== row);
      const before = others.map((c) => c.getBoundingClientRect().top); // where they are now (even mid-slide)
      others.forEach((c) => {
        c.style.transition = 'none';
        c.style.transform = '';
      });

      list.insertBefore(row, below ? target.nextSibling : target);

      others.forEach((c, i) => {
        const delta = before[i] - c.getBoundingClientRect().top;
        if (!delta) return;
        c.style.transform = 'translateY(' + delta + 'px)'; // start where it was...
        c.getBoundingClientRect(); // (let the browser apply that first)
        c.style.transition = 'transform ' + SLIDE_MS + 'ms ease';
        c.style.transform = ''; // ...and slide to the new place
      });
    }

    if (onHandle) {
      e.preventDefault();
      begin(startY); // the handle starts right away
    }

    // The listeners are on document because moving the row in the DOM cancels pointer capture.
    function move(ev) {
      // Anywhere else: it is only a drag after the mouse moved a few pixels (so clicks still work)
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        begin(ev.clientY);
      }

      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = over && over.closest(rowSelector);
      if (target && target !== row && target.parentElement === list) {
        const box = target.getBoundingClientRect();
        moveRow(target, ev.clientY > box.top + box.height / 2);
      }
      follow(ev.clientY);
    }

    function end() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      if (!dragging) return; // it was just a click

      document.body.classList.remove('drag-active');
      // The click that follows a drag must not select / toggle anything
      const stopClick = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      document.addEventListener('click', stopClick, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', stopClick, true), 0);

      // Slide the row into its place, then save (saving redraws the list)
      dragLocked = true;
      row.style.transition = 'transform ' + SLIDE_MS + 'ms ease';
      row.style.transform = 'none';
      setTimeout(() => {
        dragLocked = false;
        onDrop(list); // saves, or just redraws when the order did not change
      }, SLIDE_MS + 20);
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });
}

// Tasks: reorder inside one date group (finished tasks stay where they are)
enableDrag(groupsBox, 'li.row:not(.done)', (ul) => {
  const ids = [...ul.querySelectorAll('li.row:not(.done)')].map((row) => row.dataset.id);
  change(() => applyOrder(ids)); // no undo step if the order did not change
});

// Put the dragged items in a new order, using the same slots in `items`
// (other groups and finished items keep their places)
function applyOrder(ids) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const slots = [];
  items.forEach((it, i) => {
    if (ids.includes(it.id)) slots.push(i);
  });
  slots.forEach((slot, n) => {
    items[slot] = byId.get(ids[n]);
  });
}

// Remove finished items that match the sidebar filter
$('clear-done').addEventListener('click', () => {
  change(() => {
    items = items.filter((it) => !(it.done && isVisible(it)));
  });
});

// ---------- Undo / redo ----------

$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);

// Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo (Cmd instead of Ctrl on a Mac).
// While typing in a text box the browser's own undo for the text is used instead.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.target.closest && e.target.closest('input:not([type="checkbox"]), textarea, select')) return;
  if (document.querySelector('dialog[open]')) return;

  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    undo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    redo();
  } else {
    return;
  }
  e.preventDefault();
});

// ---------- Toolbars, sidebar and calendar buttons ----------

$('main-tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.view) return;
  view = e.target.dataset.view;
  render();
});

$('sub-tabs').addEventListener('click', (e) => {
  const key = e.target.dataset.sub;
  if (!key) return;
  if (view === 'checklist') {
    subList = key;
  } else {
    calMode = key;
  }
  render();
});

// "+ Add category": the button turns into a name box (Enter or clicking away adds, Esc cancels)
const newCategory = $('new-category');

$('add-category').addEventListener('click', () => {
  $('add-category').hidden = true;
  newCategory.hidden = false;
  newCategory.value = '';
  newCategory.focus();
});

function finishNewCategory(save) {
  if (newCategory.hidden) return; // already finished (hiding the box fires blur once more)
  newCategory.hidden = true;
  $('add-category').hidden = false;

  const name = cleanCategoryName(newCategory.value);
  if (!save || !name) return;

  const existing = categoryNames().find((n) => n.toLowerCase() === name.toLowerCase()) || name;
  filter = 'cat:' + existing.toLowerCase(); // jump to it, so the next task goes in there
  change(() => {
    if (existing === name) savedCategories.push(name); // a brand new one
  });
}

// Names cannot contain spaces, because "@name" ends at the first space
function cleanCategoryName(raw) {
  return raw.trim().replace(/^@+/, '').replace(/\s+/g, '-');
}

// Rename: the input replaces the category row. Enter or clicking away saves, Esc cancels.
function startRename(row) {
  const oldName = row.dataset.name;
  const box = document.createElement('input');
  box.type = 'text';
  box.className = 'rename-input';
  box.value = oldName;
  box.maxLength = 30;
  box.setAttribute('aria-label', 'Category name');
  row.replaceWith(box);
  box.focus();
  box.select();

  let finished = false; // render() removes the box, which fires blur again
  function finish(save) {
    if (finished) return;
    finished = true;

    const name = cleanCategoryName(box.value);
    const clash = categoryNames().find(
      (n) => n.toLowerCase() === name.toLowerCase() && n.toLowerCase() !== oldName.toLowerCase()
    );

    if (!save || !name || name === oldName) {
      render(); // nothing to change: put the row back
    } else if (clash) {
      alert('There is already a category called "' + clash + '".');
      render();
    } else {
      // Tasks keep their category, so they get the new name too
      if (filter === 'cat:' + oldName.toLowerCase()) filter = 'cat:' + name.toLowerCase();
      change(() => {
        savedCategories = savedCategories.map((n) => (n.toLowerCase() === oldName.toLowerCase() ? name : n));
        items.forEach((it) => {
          if (it.category.toLowerCase() === oldName.toLowerCase()) it.category = name;
        });
      });
    }
  }

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  box.addEventListener('blur', () => finish(true));
}

// Double-click a category to rename it (the pencil that shows on hover does the same)
$('category-list').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.side-item');
  if (row) startRename(row);
});

// Categories: reorder them in the sidebar (the order is saved)
enableDrag($('category-list'), '.side-item', (list) => {
  const order = [...list.children].map((btn) => btn.dataset.name);
  change(() => {
    savedCategories = order; // every category is saved with its place now
  });
});

newCategory.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') finishNewCategory(true);
  if (e.key === 'Escape') finishNewCategory(false);
});
newCategory.addEventListener('blur', () => finishNewCategory(true));

// Click a category or smart list to filter; click All tasks to see everything again
// Fold / unfold a sidebar group (Inbox, Categories) and remember it
function loadFolded() {
  try {
    const data = JSON.parse(localStorage.getItem(FOLD_KEY));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function applyFolded() {
  const folded = loadFolded();
  document.querySelectorAll('.side-group').forEach((group) => {
    const isFolded = folded.includes(group.id);
    group.classList.toggle('collapsed', isFolded);
    group.querySelector('[data-toggle]').setAttribute('aria-expanded', String(!isFolded));
  });
}

function toggleGroup(id) {
  const folded = loadFolded().filter((name) => name !== id);
  if (!$(id).classList.contains('collapsed')) folded.push(id); // it is open now, so fold it
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folded));
  } catch (e) {
    // storage not available: the fold still works until the page is reloaded
  }
  applyFolded();
}

$('sidebar').addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    toggleGroup(toggle.dataset.toggle);
    return;
  }

  const remove = e.target.closest('.remove-cat');
  if (remove) {
    change(() => {
      savedCategories = savedCategories.filter((n) => n.toLowerCase() !== remove.dataset.name.toLowerCase());
    });
    return;
  }

  if (e.target.closest('.cat-edit')) {
    startRename(e.target.closest('.side-item'));
    return;
  }

  if (e.target.closest('.cat-handle')) return; // a drag, not a click on the category

  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  if (filter === btn.dataset.filter) return; // already selected: stay here (All tasks goes back to everything)
  filter = btn.dataset.filter;
  render();
});

// Search box: filters the list and the calendar while typing. "/" jumps into it, Esc clears it.
const searchBox = $('search-box');

function setQuery() {
  query = searchBox.value.trim().toLowerCase();
  $('search').classList.toggle('filled', searchBox.value !== '');
  render(); // the search box itself is not redrawn, so typing is not interrupted
}

searchBox.addEventListener('input', setQuery);
searchBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  searchBox.value = '';
  setQuery();
  searchBox.blur();
});

$('search-clear').addEventListener('click', () => {
  searchBox.value = '';
  setQuery();
  searchBox.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input:not([type="checkbox"]), textarea, select')) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault(); // so "/" is not typed into the box
  searchBox.focus();
});

// Small calendar: previous / next month, and click a day to jump there
$('mini-prev').addEventListener('click', () => {
  miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1);
  renderMiniCalendar();
});

$('mini-next').addEventListener('click', () => {
  miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1);
  renderMiniCalendar();
});

$('mini-grid').addEventListener('click', (e) => {
  const key = e.target.dataset.day;
  if (!key) return;
  if (view === 'calendar') {
    calDate = fromKey(key); // the month / week of that day
    render();
  } else {
    // Checklist: scroll to that day's group (nothing happens when it has no tasks)
    const group = document.querySelector('#groups [data-date="' + key + '"]');
    if (group) group.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

// Previous / next moves by a month or a week, depending on the calendar tab
function shiftCalendar(dir) {
  if (calMode === 'week') {
    calDate = addDays(calDate, dir * 7);
  } else {
    calDate = new Date(calDate.getFullYear(), calDate.getMonth() + dir, 1);
  }
  render();
}

$('cal-prev').addEventListener('click', () => shiftCalendar(-1));
$('cal-next').addEventListener('click', () => shiftCalendar(1));

$('cal-today').addEventListener('click', () => {
  calDate = new Date();
  render();
});

// Click an empty spot of a day to add a task on that date
$('calendar-view').addEventListener('click', (e) => {
  const day = e.target.closest('[data-date]');
  if (day) openTaskDialog(day.dataset.date);
});

applyFolded(); // restore which sidebar groups were folded
render();
