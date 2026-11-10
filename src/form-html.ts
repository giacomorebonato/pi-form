import type { FormPayload } from "./server-types.js";

/**
 * The browser form: one self-contained HTML page with embedded CSS and a
 * vanilla-JS renderer that builds fields from the schema embedded as JSON.
 *
 * Everything the agent authored (title, description, schema) is untrusted:
 * it is HTML-escaped for the page body and `<`-neutralized inside the JSON
 * payload so it cannot break out of the <script> element.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    margin: 0; padding: 32px 16px;
    background: #f5f5f4; color: #1c1917;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #f5f5f4; }
    .card { background: #292524; border-color: #44403c; }
    input, select, button { background: #1c1917; border-color: #57534e; color: #f5f5f4; }
  }
  .card {
    max-width: 640px; margin: 0 auto; background: #fff;
    border: 1px solid #e7e5e4; border-radius: 12px; padding: 28px;
  }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .desc { margin: 0 0 20px; color: #78716c; font-size: 14px; }
  fieldset { border: 1px solid #d6d3d1; border-radius: 8px; margin: 0 0 16px; padding: 12px; }
  legend { padding: 0 6px; font-weight: 600; font-size: 13px; }
  .field { margin-bottom: 16px; }
  label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 4px; }
  .help { color: #78716c; font-size: 12px; margin: 0 0 6px; }
  input, select {
    display: block; width: 100%; padding: 8px 10px; font-size: 14px;
    border: 1px solid #d6d3d1; border-radius: 6px;
  }
  input[type="checkbox"] { display: inline-block; width: auto; }
  .check-line { display: flex; gap: 8px; align-items: center; font-size: 14px; margin: 4px 0; }
  .check-line label { margin: 0; font-weight: 400; }
  .row { display: flex; gap: 8px; margin: 6px 0; }
  .row input { flex: 1; }
  .btn-remove { padding: 4px 10px; }
  .btn-add { margin-top: 4px; padding: 6px 12px; }
  button {
    font-size: 13px; border: 1px solid #d6d3d1; border-radius: 6px;
    background: #fafaf9; cursor: pointer;
  }
  .submit {
    display: block; width: 100%; margin-top: 8px; padding: 10px;
    font-size: 15px; font-weight: 600; background: #1c1917; color: #fafaf9; border: none;
  }
  @media (prefers-color-scheme: dark) { .submit { background: #fafaf9; color: #1c1917; } }
  .err { color: #b91c1c; font-size: 12px; margin-top: 4px; }
  @media (prefers-color-scheme: dark) { .err { color: #fca5a5; } }
  .status { margin-top: 12px; font-size: 14px; }
  .ok { color: #15803d; font-weight: 600; }
`;

// Vanilla-JS field renderer. No backticks inside (TS template literal).
const RENDERER = `
var P = JSON.parse(document.getElementById('payload').textContent);
var F = document.getElementById('pi-form-fields');
var FORM = document.getElementById('pi-form-form');

function el(tag, attrs, text) {
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) { if (k === 'text') { e.textContent = attrs[k]; } else { e.setAttribute(k, attrs[k]); } }
  if (text !== undefined) { e.textContent = text; }
  return e;
}

function labelFor(name, prop) {
  return (prop && prop.description) ? prop.description : name;
}

function numberAttrs(prop) {
  var a = {};
  if (typeof prop.minimum === 'number') { a.min = prop.minimum; }
  if (typeof prop.maximum === 'number') { a.max = prop.maximum; }
  return a;
}

function addRemoveButton(row) {
  var b = el('button', { type: 'button', 'class': 'btn-remove', text: 'x' });
  b.addEventListener('click', function () { row.remove(); });
  row.appendChild(b);
}

function buildField(name, prop, required, container) {
  var wrap = el('div', { 'class': 'field', 'data-field': name });
  wrap.appendChild(el('label', {}, labelFor(name, prop) + (required ? ' *' : '')));
  if (prop.description && labelFor(name, prop) !== prop.description) {
    wrap.appendChild(el('p', { 'class': 'help' }, prop.description));
  }
  var type = prop.type;

  if (type === 'object') {
    var fs = el('fieldset', { 'data-field': name });
    fs.appendChild(el('legend', {}, labelFor(name, prop)));
    var reqInner = prop.required || [];
    for (var inner in prop.properties) {
      buildField(inner, prop.properties[inner], reqInner.indexOf(inner) !== -1, fs);
    }
    wrap.appendChild(fs);
  } else if (type === 'array') {
    var list = el('div', { 'data-array': name });
    wrap.appendChild(list);
    if (prop.items && prop.items.enum) {
      list.setAttribute('data-kind', 'enum-array');
      for (var i = 0; i < prop.items.enum.length; i++) {
        var val = prop.items.enum[i];
        var line = el('div', { 'class': 'check-line' });
        var cb = el('input', { type: 'checkbox', value: val });
        line.appendChild(cb);
        line.appendChild(el('label', {}, val));
        list.appendChild(line);
      }
    } else {
      list.setAttribute('data-kind', 'value-array');
      var itemType = (prop.items && prop.items.type) === 'number' ? 'number' : 'text';
      var row = el('div', { 'class': 'row' });
      row.appendChild(el('input', { type: itemType, 'data-item': name }));
      addRemoveButton(row);
      list.appendChild(row);
      var add = el('button', { type: 'button', 'class': 'btn-add', text: 'Add' });
      add.addEventListener('click', function () {
        var r = el('div', { 'class': 'row' });
        r.appendChild(el('input', { type: itemType, 'data-item': name }));
        addRemoveButton(r);
        list.appendChild(r);
      });
      wrap.appendChild(add);
    }
  } else if (type === 'boolean') {
    var line2 = el('div', { 'class': 'check-line' });
    line2.appendChild(el('input', { type: 'checkbox' }));
    wrap.appendChild(line2);
  } else if (type === 'string' && prop.enum) {
    var sel = el('select');
    if (!required) { sel.appendChild(el('option', { value: '' }, '')); }
    for (var j = 0; j < prop.enum.length; j++) {
      sel.appendChild(el('option', { value: prop.enum[j] }, prop.enum[j]));
    }
    wrap.appendChild(sel);
  } else {
    var attrs = {};
    if (type === 'integer') { attrs.type = 'number'; attrs.step = '1'; }
    else if (type === 'number') { attrs.type = 'number'; attrs.step = 'any'; }
    else { attrs.type = 'text'; }
    if (typeof prop.minLength === 'number') { attrs.minlength = prop.minLength; }
    if (typeof prop.maxLength === 'number') { attrs.maxlength = prop.maxLength; }
    if (prop.pattern) { attrs.pattern = prop.pattern; }
    if (type === 'integer' || type === 'number') {
      var na = numberAttrs(prop);
      for (var nk in na) { attrs[nk] = na[nk]; }
    }
    if (required) { attrs.required = 'required'; }
    var input = el('input', attrs);
    if (prop.default !== undefined && prop.default !== null) { input.value = String(prop.default); }
    wrap.appendChild(input);
  }
  container.appendChild(wrap);
}

function valueOfField(fieldEl, prop) {
  if (prop.type === 'object') {
    var inner = {};
    var fs = fieldEl.querySelector('fieldset');
    var saw = false;
    var innerProps = prop.properties || {};
    var kids = fs ? fs.querySelectorAll(':scope > .field') : [];
    for (var i = 0; i < kids.length; i++) {
      var name = kids[i].getAttribute('data-field');
      var v = valueOfField(kids[i], innerProps[name]);
      if (v !== undefined) { inner[name] = v; saw = true; }
    }
    return saw ? inner : undefined;
  }
  if (prop.type === 'array') {
    var arr = [];
    var list = fieldEl.querySelector('[data-array]');
    if (list.getAttribute('data-kind') === 'enum-array') {
      var cbs = list.querySelectorAll('input[type="checkbox"]:checked');
      for (var c = 0; c < cbs.length; c++) { arr.push(cbs[c].value); }
    } else {
      var items = list.querySelectorAll('input[data-item]');
      for (var k = 0; k < items.length; k++) {
        if (items[k].value === '') { continue; }
        arr.push(prop.items.type === 'number' ? Number(items[k].value) : items[k].value);
      }
    }
    return arr;
  }
  if (prop.type === 'boolean') {
    return fieldEl.querySelector('input[type="checkbox"]').checked;
  }
  var input = fieldEl.querySelector('input, select');
  if (!input || input.value === '') { return undefined; }
  if (prop.type === 'integer' || prop.type === 'number') { return Number(input.value); }
  return input.value;
}

function collect() {
  var data = {};
  var req = P.schema.required || [];
  var props = P.schema.properties || {};
  var kids = F.querySelectorAll(':scope > .field');
  for (var i = 0; i < kids.length; i++) {
    var name = kids[i].getAttribute('data-field');
    var v = valueOfField(kids[i], props[name]);
    if (v !== undefined) { data[name] = v; }
  }
  return data;
}

function showErrors(errors) {
  var props = P.schema.properties || {};
  for (var name in errors) {
    var f = F.querySelector('.field[data-field="' + name + '"]');
    if (!f) { continue; }
    var old = f.querySelector('.err');
    if (old) { old.remove(); }
    f.appendChild(el('div', { 'class': 'err' }, errors[name]));
    var inp = f.querySelector('input, select');
    if (inp) {
      inp.addEventListener('input', function () {
        var e = f.querySelector('.err');
        if (e) { e.remove(); }
      }, { once: true });
    }
  }
}

FORM.addEventListener('submit', function (ev) {
  ev.preventDefault();
  var status = document.getElementById('pi-form-status');
  status.textContent = 'Submitting...';
  status.className = 'status';
  fetch('/submit?token=' + encodeURIComponent(P.token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collect())
  }).then(function (res) {
    return res.json().then(function (body) { return { code: res.status, body: body }; });
  }).then(function (r) {
    if (r.code === 200 && r.body.ok) {
      FORM.style.display = 'none';
      status.textContent = 'Submitted — you can close this tab.';
      status.className = 'status ok';
    } else if (r.code === 422 && r.body.errors) {
      status.textContent = 'Fix the highlighted fields and submit again.';
      status.className = 'status';
      showErrors(r.body.errors);
    } else {
      status.textContent = 'Error: ' + (r.body && r.body.error ? r.body.error : 'unexpected response');
      status.className = 'status err';
    }
  }).catch(function (e) {
    status.textContent = 'Error: ' + e;
    status.className = 'status err';
  });
});

(function () {
  var req = P.schema.required || [];
  var props = P.schema.properties || {};
  for (var name in props) {
    buildField(name, props[name], req.indexOf(name) !== -1, F);
  }
})();
`;

export function renderFormPage(payload: FormPayload): string {
  const json = escapeJsonForScript(JSON.stringify(payload));
  const title = escapeHtml(payload.title);
  const desc = payload.description ? escapeHtml(payload.description) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  ${desc ? `<p class="desc">${desc}</p>` : ""}
  <form id="pi-form-form" novalidate>
    <div id="pi-form-fields"></div>
    <button type="submit" class="submit">Submit</button>
  </form>
  <div id="pi-form-status" class="status" role="status"></div>
</div>
<script type="application/json" id="payload">${json}</script>
<script>${RENDERER}</script>
</body>
</html>`;
}
