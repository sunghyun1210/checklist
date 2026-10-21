const STORAGE_KEY = 'checklist-items';

// Each item: { id, text, category, minutes, scope, period, done }
// scope is 'day' | 'week' | 'month'; period is the key of that day/week/month
let items = loadItems();
let scope = 'day';
let viewDate = new Date(); // the date we are currently looking at
let category = ''; // selected category tab in lowercase ('' = All)

const form = document.getElementById('add-form');
const input = document.getElementById('new-item');
const list = document.getElementById('list');
const periodLabel = document.getElementById('period-label');
const footer = document.getElementById('footer');
const count = document.getElementById('count');
const categoryTabs = document.getElementById('category-tabs');

// ---------- Storage ----------

function loadItems() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return []; // broken or missing data: start fresh
  }
}

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// ---------- Dates ----------

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// Which day / week / month does viewDate belong to?
function currentPeriod() {
  if (scope === 'month') {
    return viewDate.getFullYear() + '-' + pad(viewDate.getMonth() + 1);
  }
  if (scope === 'week') {
    const monday = new Date(viewDate);
    monday.setDate(viewDate.getDate() - ((viewDate.getDay() + 6) % 7)); // weeks start on Monday
    return dateKey(monday);
  }
  return dateKey(viewDate);
}

function periodText() {
  if (scope === 'month') {
    return viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (scope === 'week') {
    const monday = new Date(currentPeriod() + 'T00:00:00');
    return 'Week of ' + monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return viewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// Move to the previous (-1) or next (+1) day / week / month
function shiftPeriod(dir) {
  if (scope === 'month') {
    viewDate.setDate(1); // avoids jumping over short months
    viewDate.setMonth(viewDate.getMonth() + dir);
  } else {
    viewDate.setDate(viewDate.getDate() + dir * (scope === 'week' ? 7 : 1));
  }
}

// ---------- Rendering ----------

function render() {
  periodLabel.textContent = periodText();

  document.querySelectorAll('#scope-tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scope === scope);
  });

  renderCategoryTabs(); // must run first: it may reset the selected category
  const visible = visibleItems();

  list.innerHTML = '';
  visible.forEach((item) => {
    const li = document.createElement('li');
    li.dataset.id = item.id;
    li.classList.toggle('done', item.done);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = item.text; // textContent keeps user input safe from HTML injection

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete');

    li.append(checkbox, text);

    // On the All tab, show which category the item belongs to
    if (item.category && !category) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = item.category;
      li.append(tag);
    }

    if (item.minutes) {
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatMinutes(item.minutes);
      li.append(time);
    }

    li.append(del);
    list.appendChild(li);
  });

  // Footer: remaining count + clear button (hidden when the list is empty)
  const remaining = visible.filter((item) => !item.done);
  const left = remaining.length;
  const minutesLeft = remaining.reduce((sum, item) => sum + (item.minutes || 0), 0);
  count.textContent = left + (left === 1 ? ' item left' : ' items left');
  if (minutesLeft) count.textContent += ' · ' + formatMinutes(minutesLeft);
  footer.hidden = visible.length === 0;
}

// All items of the current day/week/month (every category)
function periodItems() {
  const period = currentPeriod();
  return items.filter((item) => item.scope === scope && item.period === period);
}

// What is on screen: the selected category only, unfinished first, finished at the bottom
function visibleItems() {
  return periodItems()
    .filter((item) => !category || (item.category || '').toLowerCase() === category)
    .sort((a, b) => a.done - b.done); // sort is stable, so the original order is kept
}

// ---------- Categories ----------

// Category names used in the current list (@aie510 and @AIE510 count as the same one)
function categoryNames() {
  const names = [];
  periodItems().forEach((item) => {
    const name = item.category;
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  });
  return names;
}

// Reuse the spelling already in this list if there is one
function canonicalCategory(name) {
  return categoryNames().find((n) => n.toLowerCase() === name.toLowerCase()) || name;
}

function renderCategoryTabs() {
  const names = categoryNames();

  // The selected category may be gone (deleted items, or another day): back to All
  if (category && !names.some((n) => n.toLowerCase() === category)) {
    category = '';
  }

  categoryTabs.innerHTML = '';
  categoryTabs.hidden = names.length === 0;

  ['All'].concat(names).forEach((name) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = name;
    btn.dataset.category = name === 'All' ? '' : name.toLowerCase();
    btn.classList.toggle('active', btn.dataset.category === category);
    categoryTabs.appendChild(btn);
  });
}

// "@AIE510 quiz 3 t25" -> { category: 'AIE510', text: 'quiz 3', minutes: 25 }
function parseInput(raw) {
  let cat = '';
  let minutes = 0;

  let text = raw.replace(/(^|\s)@(\S+)/, (_, space, name) => {
    cat = name; // only the first @word counts
    return space;
  });

  // "t25" as its own word means 25 minutes
  text = text.replace(/(^|\s)t(\d+)(?=\s|$)/i, (_, space, number) => {
    minutes = Number(number);
    return space;
  });

  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^"(.*)"$/, '$1'); // the placeholder shows the task in quotes
  return { category: cat, text: text.trim(), minutes: minutes };
}

// 25 -> "25m", 75 -> "1h 15m", 120 -> "2h"
function formatMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return m + 'm';
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}

// ---------- Events ----------

form.addEventListener('submit', (e) => {
  e.preventDefault(); // stop the page from reloading
  const parsed = parseInput(input.value);
  if (!parsed.text) return; // ignore empty input

  // No @ typed: use the selected category tab (if any)
  const typed = parsed.category || category;

  items.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    text: parsed.text,
    category: typed ? canonicalCategory(typed) : '',
    minutes: parsed.minutes,
    scope: scope,
    period: currentPeriod(),
    done: false,
  });
  saveItems();

  input.value = '';
  input.focus();
  render();
});

// One listener on the whole list handles every checkbox and delete button
list.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const item = items.find((it) => it.id === li.dataset.id);

  if (e.target.matches('input[type="checkbox"]')) {
    item.done = e.target.checked;
  } else if (e.target.matches('.delete')) {
    items = items.filter((it) => it !== item);
  } else {
    return;
  }
  saveItems();
  render();
});

// Remove finished items from the current list only
document.getElementById('clear-done').addEventListener('click', () => {
  const shown = visibleItems();
  items = items.filter((it) => !(shown.includes(it) && it.done));
  saveItems();
  render();
});

categoryTabs.addEventListener('click', (e) => {
  if (e.target.dataset.category === undefined) return;
  category = e.target.dataset.category;
  render();
});

document.getElementById('scope-tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.scope) return;
  scope = e.target.dataset.scope;
  render();
});

document.getElementById('prev').addEventListener('click', () => {
  shiftPeriod(-1);
  render();
});

document.getElementById('next').addEventListener('click', () => {
  shiftPeriod(1);
  render();
});

document.getElementById('today').addEventListener('click', () => {
  viewDate = new Date();
  render();
});

render();
