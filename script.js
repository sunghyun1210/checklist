const STORAGE_KEY = 'checklist-v2'; // the old per-day/week/month data is not used any more
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const $ = (id) => document.getElementById(id);

// Each item: { id, text, category, minutes, due, done, doneDate }
// due and doneDate are 'YYYY-MM-DD' strings (doneDate is '' until the item is checked)
let items = loadItems();
let view = 'checklist';
let subView = 'all'; // 'all' shows finished items too, 'todo' hides them
let filter = ''; // sidebar: '' = everything, 'inbox', or 'cat:' + lowercase category name
let calMonth = firstOfMonth(new Date()); // the month shown in the calendar

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

function firstOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Short label for a row: Today, Tmrw, Oct 25
function dateLabel(key) {
  const today = fromKey(todayKey());
  if (key === dateKey(today)) return 'Today';
  if (key === dateKey(addDays(today, 1))) return 'Tmrw';
  return fromKey(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

// Category names used by any item (@aie510 and @AIE510 count as the same one)
function categoryNames() {
  const names = [];
  items.forEach((item) => {
    const name = item.category;
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  });
  return names;
}

// Reuse the spelling already in use if there is one
function canonicalCategory(name) {
  return categoryNames().find((n) => n.toLowerCase() === name.toLowerCase()) || name;
}

function matchesFilter(item) {
  if (filter === 'inbox') return !item.category;
  if (filter) return 'cat:' + item.category.toLowerCase() === filter;
  return true;
}

// Items that pass the sidebar filter
function filteredItems() {
  return items.filter(matchesFilter);
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
  document.querySelectorAll('#main-tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  const calendar = view === 'calendar';
  $('layout').classList.toggle('calendar-mode', calendar);
  $('checklist-view').hidden = calendar;
  $('summary').hidden = calendar;
  $('calendar-view').hidden = !calendar;

  renderSidebar();
  if (calendar) {
    renderCalendar();
  } else {
    renderChecklist();
    renderSummary();
  }
}

// Month grid: 6 weeks starting on Sunday. Items follow the sidebar filter.
function renderCalendar() {
  $('cal-title').textContent = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const grid = $('cal-grid');
  grid.innerHTML = '';
  DAYS.forEach((name) => grid.append(el('div', 'cal-head', name.toUpperCase())));

  const today = todayKey();
  const mine = filteredItems();
  const start = addDays(calMonth, -calMonth.getDay());

  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const key = dateKey(day);
    const cell = el('div', 'cal-cell');
    cell.dataset.date = key;
    if (day.getMonth() !== calMonth.getMonth()) cell.classList.add('other');
    if (key === today) cell.classList.add('today');
    cell.append(el('div', 'cal-day', String(day.getDate())));

    // Show at most 3 items per day, unfinished first
    const dayItems = mine.filter((it) => it.due === key).sort((a, b) => a.done - b.done);
    dayItems.slice(0, 3).forEach((it) => {
      cell.append(el('div', it.done ? 'cal-item done' : 'cal-item', it.text));
    });
    if (dayItems.length > 3) cell.append(el('div', 'cal-more', '+' + (dayItems.length - 3) + ' more'));
    grid.append(cell);
  }
}

// Cards follow the sidebar filter. Overdue items are not counted here (they have their own group).
function renderSummary() {
  const mine = filteredItems().filter((it) => !it.done);
  const today = fromKey(todayKey());
  const weekEnd = dateKey(addDays(today, 6 - today.getDay())); // the week ends on Saturday

  $('sum-today').textContent = mine.filter((it) => it.due === dateKey(today)).length;
  $('sum-week').textContent = mine.filter((it) => it.due >= dateKey(today) && it.due <= weekEnd).length;
  $('sum-done').textContent = filteredItems().filter((it) => it.doneDate === dateKey(today)).length;
}

function renderSidebar() {
  const names = categoryNames();

  // The selected category may be gone (its items were deleted): back to everything
  if (filter.startsWith('cat:') && !names.some((n) => 'cat:' + n.toLowerCase() === filter)) {
    filter = '';
  }

  const left = (test) => items.filter((it) => !it.done && test(it)).length;

  $('inbox-count').textContent = left((it) => !it.category) || '';
  document.querySelector('[data-filter="inbox"]').classList.toggle('active', filter === 'inbox');

  const list = $('category-list');
  list.innerHTML = '';
  names.forEach((name) => {
    const key = 'cat:' + name.toLowerCase();
    const btn = el('button', 'side-item');
    btn.type = 'button';
    btn.dataset.filter = key;
    btn.classList.toggle('active', filter === key);
    btn.append(
      el('span', '', name),
      el('span', 'side-count', left((it) => it.category.toLowerCase() === name.toLowerCase()) || '')
    );
    list.append(btn);
  });
}

function renderChecklist() {
  document.querySelectorAll('#sub-tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sub === subView);
  });

  if (filter === 'inbox') {
    $('view-title').textContent = 'Inbox';
  } else if (filter) {
    $('view-title').textContent = categoryNames().find((n) => 'cat:' + n.toLowerCase() === filter);
  } else {
    $('view-title').textContent = subView === 'all' ? 'All tasks' : 'To do';
  }

  const shown = filteredItems().filter((it) => subView === 'all' || !it.done);
  const today = todayKey();

  // Unfinished items that are past due go into one Overdue group on top
  const groups = [];
  const overdue = shown.filter((it) => !it.done && it.due < today);
  if (overdue.length) groups.push({ title: 'Overdue', items: overdue, late: true });

  // Everything else is grouped by date, unfinished first and finished (faded) at the bottom
  const rest = shown.filter((it) => !overdue.includes(it));
  [...new Set(rest.map((it) => it.due))].sort().forEach((due) => {
    groups.push({
      title: groupTitle(due),
      items: rest.filter((it) => it.due === due).sort((a, b) => a.done - b.done), // stable sort
    });
  });

  const box = $('groups');
  box.innerHTML = '';
  groups.forEach((group) => {
    const section = el('section', 'group');
    const heading = el('h3', group.late ? 'overdue' : '', group.title);
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
  $('clear-done').hidden = subView === 'todo'; // nothing finished is shown there
}

function makeRow(item) {
  const li = el('li');
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

  // Show the category label unless a category is already selected in the sidebar
  if (item.category && !filter.startsWith('cat:')) li.append(el('span', 'tag', item.category));
  if (item.minutes) li.append(el('span', 'time', formatMinutes(item.minutes)));

  const late = !item.done && item.due < todayKey();
  li.append(el('span', late ? 'date late' : 'date', dateLabel(item.due)));

  const del = el('button', 'delete', '×');
  del.type = 'button';
  del.setAttribute('aria-label', 'Delete');
  li.append(del);
  return li;
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
  dialog.showModal();
  input.focus();
}

$('new-task').addEventListener('click', () => openTaskDialog());

// Click on the dark area around the popup closes it (Esc works by default)
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

form.addEventListener('submit', (e) => {
  e.preventDefault(); // stop the page from reloading
  const parsed = parseInput(input.value);
  if (!parsed.text) return; // ignore empty input

  // Things typed in the text win over the buttons below it
  const cat = parsed.category || $('chip-category').value;
  items.push({
    id: newId(),
    text: parsed.text,
    category: cat ? canonicalCategory(cat) : '',
    minutes: parsed.minutes || Number($('chip-minutes').value),
    due: parsed.due || $('chip-date').value || todayKey(),
    done: false,
    doneDate: '',
  });
  saveItems();

  dialog.close();
  render();
});

// ---------- List events ----------

const groupsBox = $('groups');

// One listener for all checkboxes and delete buttons
groupsBox.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const item = items.find((it) => it.id === li.dataset.id);

  if (e.target.matches('input[type="checkbox"]')) {
    item.done = e.target.checked;
    item.doneDate = item.done ? todayKey() : '';
  } else if (e.target.matches('.delete')) {
    items = items.filter((it) => it !== item);
  } else {
    return;
  }
  saveItems();
  render();
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
      item.text = parsed.text;
      item.category = parsed.category ? canonicalCategory(parsed.category) : '';
      item.minutes = parsed.minutes;
      if (parsed.due) item.due = parsed.due;
      saveItems();
    }
    render();
  }

  edit.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') finish(true);
    if (ev.key === 'Escape') finish(false);
  });
  edit.addEventListener('blur', () => finish(true));
});

// Drag the ≡ handle to reorder inside one date group. Pointer events work for mouse and touch.
groupsBox.addEventListener('pointerdown', (e) => {
  if (!e.target.matches('.handle')) return;
  const handle = e.target;
  const li = handle.closest('li');
  const ul = li.parentElement;
  handle.setPointerCapture(e.pointerId);
  li.classList.add('dragging');

  // While dragging, only move the row in the page; save when the finger/mouse is released
  function move(ev) {
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = over && over.closest('li:not(.done)');
    if (!target || target === li || target.parentElement !== ul) return;
    const box = target.getBoundingClientRect();
    const below = ev.clientY > box.top + box.height / 2;
    ul.insertBefore(li, below ? target.nextSibling : target);
  }

  function end() {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    const ids = [...ul.querySelectorAll('li:not(.done)')].map((row) => row.dataset.id);
    applyOrder(ids);
    saveItems();
    render();
  }

  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
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

// ---------- Toolbars and sidebar ----------

$('main-tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.view) return;
  view = e.target.dataset.view;
  render();
});

// Calendar: previous / next month, back to this month
$('cal-prev').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  render();
});

$('cal-next').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  render();
});

$('cal-today').addEventListener('click', () => {
  calMonth = firstOfMonth(new Date());
  render();
});

// Click a day to add a task on that date
$('cal-grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-cell');
  if (cell) openTaskDialog(cell.dataset.date);
});

$('sub-tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.sub) return;
  subView = e.target.dataset.sub;
  render();
});

// Click a sidebar item to filter; click it again to go back to everything
$('sidebar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  filter = filter === btn.dataset.filter ? '' : btn.dataset.filter;
  render();
});

// Remove finished items that match the sidebar filter
$('clear-done').addEventListener('click', () => {
  items = items.filter((it) => !(it.done && matchesFilter(it)));
  saveItems();
  render();
});

render();
