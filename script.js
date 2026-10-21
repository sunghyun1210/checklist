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

  const period = currentPeriod();
  const visible = items.filter((item) => item.scope === scope && item.period === period);

  list.innerHTML = '';
  visible.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.text; // textContent keeps user input safe from HTML injection
    list.appendChild(li);
  });
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
