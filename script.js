const STORAGE_KEY = 'checklist-items';

// Each item: { id, text, scope, period, done }
// scope is 'day' | 'week' | 'month'; period is the key of that day/week/month
let items = loadItems();
let scope = 'day';
let viewDate = new Date(); // the date we are currently looking at

const form = document.getElementById('add-form');
const input = document.getElementById('new-item');
const list = document.getElementById('list');
const periodLabel = document.getElementById('period-label');
const footer = document.getElementById('footer');
const count = document.getElementById('count');

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

    li.append(checkbox, text, del);
    list.appendChild(li);
  });

  // Footer: remaining count + clear button (hidden when the list is empty)
  const left = visible.filter((item) => !item.done).length;
  count.textContent = left + (left === 1 ? ' item left' : ' items left');
  footer.hidden = visible.length === 0;
}

// Items of the current day/week/month: unfinished first, finished at the bottom
function visibleItems() {
  const period = currentPeriod();
  return items
    .filter((item) => item.scope === scope && item.period === period)
    .sort((a, b) => a.done - b.done); // sort is stable, so the original order is kept
}

// ---------- Events ----------

form.addEventListener('submit', (e) => {
  e.preventDefault(); // stop the page from reloading
  const text = input.value.trim();
  if (!text) return; // ignore empty input

  items.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    text: text,
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
