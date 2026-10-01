// Минимальная запись и чтение .xlsx (Office Open XML) без сторонних библиотек.
// Запись: ZIP без сжатия, строки — inline, даты — числом с форматом даты,
// закреплённая шапка и автофильтр. Чтение: первый лист, общие строки и числа.

const enc = new TextEncoder();
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

// ---------- ZIP ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameB = enc.encode(name);
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    const crc = crc32(bytes);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 имена
    lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, bytes.length, true);
    lh.setUint32(22, bytes.length, true);
    lh.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(lh.buffer), nameB, bytes);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, bytes.length, true);
    ch.setUint32(24, bytes.length, true);
    ch.setUint16(28, nameB.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + bytes.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------- запись ----------

const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const excelDate = (d) => (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000;

// Стили: 0 — обычный, 1 — шапка, 2 — дата, 3 — число, 4/5/6 — статус (красный/жёлтый/зелёный), 7 — перенос строк
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCE4EC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF8C9C2"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBE3B0"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFCDEBD6"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sheet) {
  const { columns, rows } = sheet;
  const out = [];
  const cell = (r, c, v, style, kind) => {
    const ref = colName(c) + (r + 1);
    if (v === null || v === undefined || v === '') return '';
    if (kind === 'n') return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  out.push(`<row r="1" ht="32" customHeight="1">${columns.map((c, i) => cell(0, i, c.label, 1)).join('')}</row>`);
  rows.forEach((row, ri) => {
    const cells = columns.map((c, ci) => {
      const v = row[c.key];
      if (c.date) {
        const d = c.parseDate ? c.parseDate(v) : null;
        return d ? cell(ri + 1, ci, excelDate(d), 2, 'n') : cell(ri + 1, ci, v);
      }
      if (c.num && v !== '' && v !== null && Number.isFinite(Number(v))) return cell(ri + 1, ci, Number(v), Number(v) >= 1000 ? 3 : 0, 'n');
      const st = c.statusStyle ? c.statusStyle(v) : c.wrap ? 7 : 0;
      return cell(ri + 1, ci, v, st);
    });
    out.push(`<row r="${ri + 2}">${cells.join('')}</row>`);
  });
  const last = colName(columns.length - 1) + (rows.length + 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0">${sheet.freeze !== false ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>
<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 14}" customWidth="1"/>`).join('')}</cols>
<sheetData>${out.join('')}</sheetData>
${sheet.filter !== false && rows.length ? `<autoFilter ref="A1:${last}"/>` : ''}
</worksheet>`;
}

// sheets: [{ name, columns: [{key,label,w,num,date,parseDate,statusStyle,wrap}], rows: [{...}] }]
export function writeXlsx(sheets) {
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${xmlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets>${sheets[0].filter !== false && sheets[0].rows.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xmlEsc(sheets[0].name.slice(0, 31))}'!$A$1:$${colName(sheets[0].columns.length - 1)}$${sheets[0].rows.length + 1}</definedName></definedNames>` : ''}</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zipStore(files);
}

// ---------- чтение ----------

const dec = new TextDecoder();
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

// Файлы ZIP-архива как байты: { имя: Uint8Array }. wanted(имя) — какие нужны.
export async function unzipFiles(bytes, inflateRaw, wanted = () => true) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Файл не похож на архив ZIP (.xlsx, .zip): нет оглавления');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!wanted(name)) continue;
    const lnlen = dv.getUint16(off + 26, true);
    const lxlen = dv.getUint16(off + 28, true);
    const data = bytes.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    out[name] = method === 0 ? data.slice() : await inflateRaw(data);
  }
  return out;
}

async function unzip(bytes, inflateRaw, wanted) {
  const files = await unzipFiles(bytes, inflateRaw, wanted);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, dec.decode(v)]));
}

// Первый лист книги → массив строк (массивов значений). inflateRaw(Uint8Array) → Promise<Uint8Array>.
export async function readXlsx(bytes, inflateRaw) {
  const files = await unzip(bytes, inflateRaw, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(n));
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const first = (files['xl/workbook.xml'] || '').match(/<sheet\b[^>]*r:id="([^"]+)"/);
  if (first && files['xl/_rels/workbook.xml.rels']) {
    const rel = files['xl/_rels/workbook.xml.rels'].match(new RegExp(`<Relationship\\b[^>]*Id="${first[1]}"[^>]*Target="([^"]+)"`)) || files['xl/_rels/workbook.xml.rels'].match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${first[1]}"`));
    if (rel) sheetPath = 'xl/' + rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const shared = [];
  for (const si of (files['xl/sharedStrings.xml'] || '').match(/<si>[\s\S]*?<\/si>/g) || []) {
    shared.push(unxml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  }
  const xml = files[sheetPath];
  if (!xml) throw new Error('В книге не найден первый лист');
  const rows = [];
  for (const rowM of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
    const rIdx = +(rowM.match(/<row\b[^>]*\br="(\d+)"/) || [0, rows.length + 1])[1] - 1;
    const row = [];
    for (const c of rowM.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = (c.match(/\br="([A-Z]+)\d+"/) || [])[1];
      const t = (c.match(/\bt="([^"]+)"/) || [])[1];
      let ci = 0;
      if (ref) for (const ch of ref) ci = ci * 26 + ch.charCodeAt(0) - 64;
      ci = ref ? ci - 1 : row.length;
      const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = null;
      if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = unxml(((c.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '').replace(/<[^>]+>/g, ''));
      else if (t === 'str' || t === 'e') val = v != null ? unxml(v) : '';
      else if (t === 'b') val = v === '1';
      else if (v != null) val = Number(v);
      row[ci] = val;
    }
    rows[rIdx] = row;
  }
  return rows.filter(Boolean);
}

// CSV (разделитель «;» или «,», кавычки по RFC 4180) → массив строк
export function readCsv(text) {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}
