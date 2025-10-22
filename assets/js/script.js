// ========= CẤU HÌNH ===========
const SHEET_JSON_URL = "https://opensheet.elk.sh/17YmmVafz78B5zWve0XrF7Y9Nj4nI7ovEn3TAwr8w8Bo/Hotspots";
const SHEET_WEB_URL = "https://docs.google.com/spreadsheets/d/17YmmVafz78B5zWve0XrF7Y9Nj4nI7ovEn3TAwr8w8Bo/edit?gid=1329490609#gid=1329490609";

// Cột: name, name_cn, area_m2, usage, usage_cn, capacity, capacity_cn, status, status_cn,
// x_pct, y_pct, rect_x_pct, rect_y_pct, rect_w_pct, rect_h_pct, polygon, notes, notes_cn, link

const boardEl = document.getElementById('board');
const zoomLayer = document.getElementById('zoomLayer');
const imgEl = document.getElementById('floorImg');
const overlayEl = document.getElementById('overlay');
const refreshBtn = document.getElementById('refreshBtn');
const editToggle = document.getElementById('editToggle');
const coordHint = document.getElementById('coordHint');
const coordVal = document.getElementById('coordVal');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomResetBtn = document.getElementById('zoomReset');

let data = [];
let popoverEl = null;
let hoverCloseTimer = null;

// ===== Zoom / Pan state =====
let scale = 1, tx = 0, ty = 0;
const MIN_SCALE = 1, MAX_SCALE = 6;

const normKey = k => (k || '').toString().trim().toLowerCase();
const escapeHtml = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escapeAttr = s => escapeHtml(s).replace(/"/g, '%22');

// === Fetch Google Sheet
async function fetchSheet() {
    const res = await fetch(SHEET_JSON_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Không tải được dữ liệu: ' + res.status);
    const rows = await res.json();
    return rows.map(r => {
        const o = {}; Object.keys(r).forEach(k => o[normKey(k)] = r[k]);
        return {
            id: o.id || '',
            name: o.name || o["tên khu vực"] || o["ten khu vuc"] || o["ten"] || '',
            name_cn: o.name_cn || o["名称"] || '',
            area_m2: o.area_m2 || o["diện tích"] || o["dien tich"] || '',
            usage: o.usage || o["công dụng"] || o["cong dung"] || '',
            usage_cn: o.usage_cn || o["用途"] || '',
            capacity: o.capacity || o["sức chứa"] || o["suc chua"] || '',
            capacity_cn: o.capacity_cn || o["容量"] || '',
            status: o.status || o["tình trạng"] || o["tinh trang"] || '',
            status_cn: o.status_cn || o["状态"] || '',
            x_pct: o.x_pct || o.x || '',
            y_pct: o.y_pct || o.y || '',
            rx: o.rect_x_pct || o.rx || '',
            ry: o.rect_y_pct || o.ry || '',
            rw: o.rect_w_pct || o.rw || '',
            rh: o.rect_h_pct || o.rh || '',
            poly: o.polygon || o.poly || '',
            notes: o.notes || o["ghi chú"] || o["ghi chu"] || '',
            notes_cn: o.notes_cn || o["备注"] || '',
            link: o.link || o["liên kết"] || o["lien ket"] || ''
        };
    });
}

// === Map trạng thái Việt/Trung -> class màu
function statusToClass(s) {
    const vi = (s || '').toString().trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, '');
    if (vi === 'HOAT DONG' || s === '运行') return 'ok';
    if (vi === 'CANH BAO' || s === '警告') return 'warn';
    if (vi === 'DA DAY' || s === '已满') return 'err';
    return '';
}

// === Helpers song ngữ
const zhStatusFallback = (vi => {
    const u = (vi || '').toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, '');
    if (u === 'HOAT DONG') return '运行';
    if (u === 'CANH BAO') return '警告';
    if (u === 'DA DAY') return '已满';
    return '';
});
const bi = (vi, zh) => {
    const left = (vi ?? '').toString().trim();
    const right = (zh ?? '').toString().trim();
    if (left && right) return `${left} / ${right}`;
    return left || right || '—';
};

// === Hotspot (chấm) – render vào zoomLayer để bám zoom/pan
function createHotspot(item) {
    if (!(item.x_pct && item.y_pct)) return null;
    const dot = document.createElement('button');
    dot.className = 'hotspot';
    dot.setAttribute('aria-label', item.name || 'Hotspot');
    const st = statusToClass(item.status); if (st) dot.classList.add(st);
    dot.style.left = (parseFloat(item.x_pct) || 0) + '%';
    dot.style.top = (parseFloat(item.y_pct) || 0) + '%';
    const open = (ev) => { ev.stopPropagation(); openPopover(item, dot); };
    dot.addEventListener('mouseenter', open);
    dot.addEventListener('click', open);
    return dot;
}

// === Popover song ngữ (popover đặt ngoài zoom để không bị scale)
function openPopover(item, anchor) {
    closePopover();
    popoverEl = document.createElement('div');
    popoverEl.className = 'popover';
    const title = bi(item.name, item.name_cn);
    popoverEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;justify-content:space-between">
          <h3>${escapeHtml(title)}</h3>
          <span class="tag">${escapeHtml(bi(item.usage, item.usage_cn))}</span>
        </div>
        <div class="kv">
          <div>Diện tích (m²) / 面积</div><div>${escapeHtml(item.area_m2 || '—')}</div>
          <div>Công dụng / 用途</div><div>${escapeHtml(bi(item.usage, item.usage_cn))}</div>
          <div>Sức chứa / 容量</div><div>${escapeHtml(bi(item.capacity, item.capacity_cn))}</div>
          <div>Tình trạng / 状态</div><div>${escapeHtml(bi(item.status, item.status_cn || zhStatusFallback(item.status)))}</div>
          <div>Ghi chú / 备注</div><div>${escapeHtml(bi(item.notes, item.notes_cn))}</div>
          <div>Liên kết / 链接</div><div>${item.link ? `<a href="${escapeAttr(item.link)}" target="_blank" rel="noopener">Mở / 打开</a>` : '—'}</div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          ${SHEET_WEB_URL ? `<a class="btn" href="${escapeAttr(SHEET_WEB_URL)}" target="_blank" rel="noopener">Chỉnh sửa trên Sheet / 在表格中编辑</a>` : ''}
          <button class="btn" onclick="closePopover()">Đóng / 关闭</button>
        </div>`;
    boardEl.appendChild(popoverEl);

    const rectBoard = boardEl.getBoundingClientRect();
    const rectAnchor = anchor.getBoundingClientRect();
    const rect = { x: rectAnchor.left - rectBoard.left, y: rectAnchor.top - rectBoard.top, w: rectAnchor.width, h: rectAnchor.height };
    const x = rect.x + rect.w + 10;
    const y = rect.y - 4;
    popoverEl.style.left = Math.max(8, Math.min(x, rectBoard.width - 400)) + 'px';
    popoverEl.style.top = Math.max(8, Math.min(y, rectBoard.height - 180)) + 'px';
}
function closePopover() { if (popoverEl) { popoverEl.remove(); popoverEl = null; } }

// === Vẽ vùng (rect / polygon) vào overlay (nằm trong zoomLayer)
function clearZones() { while (overlayEl.firstChild) overlayEl.removeChild(overlayEl.firstChild); }
function createZoneRect(item) {
    const must = ['rx', 'ry', 'rw', 'rh'];
    if (!must.every(k => item[k] !== '' && item[k] != null)) return null;
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', parseFloat(item.rx));
    r.setAttribute('y', parseFloat(item.ry));
    r.setAttribute('width', parseFloat(item.rw));
    r.setAttribute('height', parseFloat(item.rh));
    r.setAttribute('tabindex', '0');
    r.classList.add('zone');
    const st = statusToClass(item.status); if (st) r.classList.add(st);
    const open = (ev) => { ev.stopPropagation(); openPopover(item, r); };
    r.addEventListener('mouseenter', open);
    r.addEventListener('click', open);
    return r;
}
function parsePoly(str) {
    if (!str) return null;
    const pts = String(str).replace(/;/g, ' ').trim().split(/\s+/).map(p => p.replace(/,/g, ' ').trim()).filter(Boolean)
        .map(p => p.split(/\s+/).map(Number)).filter(a => a.length === 2 && a.every(n => !isNaN(n)));
    return pts.length >= 3 ? pts : null;
}
function createZonePolygon(item) {
    const pts = parsePoly(item.poly);
    if (!pts) return null;
    const pg = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    pg.setAttribute('points', pts.map(([x, y]) => `${x},${y}`).join(' '));
    pg.setAttribute('tabindex', '0');
    pg.classList.add('zone');
    const st = statusToClass(item.status); if (st) pg.classList.add(st);
    const open = (ev) => { ev.stopPropagation(); openPopover(item, pg); };
    pg.addEventListener('mouseenter', open);
    pg.addEventListener('click', open);
    return pg;
}
function render() {
    // Xoá hotspots cũ
    [...zoomLayer.querySelectorAll('.hotspot')].forEach(el => el.remove());
    clearZones();
    data.forEach(item => {
        const pg = createZonePolygon(item);
        const rc = createZoneRect(item);
        if (pg) overlayEl.appendChild(pg);
        if (rc) overlayEl.appendChild(rc);
        if (!pg && !rc) {
            const dot = createHotspot(item);
            if (dot) zoomLayer.appendChild(dot);
        }
    });
}

// === Auto-close popover khi không hover vùng/điểm ===
function isInteractiveAt(clientX, clientY) {
    const els = document.elementsFromPoint(clientX, clientY);
    return els.some(el =>
        (el.classList && (el.classList.contains('zone') || el.classList.contains('hotspot'))) ||
        el === popoverEl || (popoverEl && popoverEl.contains(el))
    );
}
boardEl.addEventListener('mouseleave', () => {
    closePopover();
    if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
});

// ===== Zoom / Pan (zoom bám vị trí con trỏ) =====
function applyTransform() { zoomLayer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Kích thước cơ sở (scale=1) để clamp pan
function baseSize() {
    // transform không ảnh hưởng clientWidth/Height → dùng làm kích thước gốc
    return { w: imgEl.clientWidth, h: imgEl.clientHeight };
}
function constrainPan() {
    const b = { w: boardEl.clientWidth, h: boardEl.clientHeight };
    const bs = baseSize();
    const contentW = bs.w * scale;
    const contentH = bs.h * scale;
    const minTx = Math.min(0, b.w - contentW);
    const minTy = Math.min(0, b.h - contentH);
    const maxTx = 0, maxTy = 0;
    tx = clamp(tx, minTx, maxTx);
    ty = clamp(ty, minTy, maxTy);
}

// Lưu vị trí con trỏ gần nhất (trong board) để dùng cho nút +/−
const lastPointer = { cx: boardEl.clientWidth / 2, cy: boardEl.clientHeight / 2 };
boardEl.addEventListener('mousemove', (e) => {
    const r = boardEl.getBoundingClientRect();
    lastPointer.cx = e.clientX - r.left;
    lastPointer.cy = e.clientY - r.top;

    // Auto-close theo hover
    if (isInteractiveAt(e.clientX, e.clientY)) {
        if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
    } else {
        if (!hoverCloseTimer) {
            hoverCloseTimer = setTimeout(() => { closePopover(); hoverCloseTimer = null; }, 250);
        }
    }

    // Hiện toạ độ nếu bật chế độ lấy toạ độ
    if (editToggle.checked) {
        const p = pointPercentFromClient(e.clientX, e.clientY);
        coordVal.textContent = `x: ${p.x.toFixed(2)}%, y: ${p.y.toFixed(2)}%`;
    }
});

// Zoom giữ cố định điểm (cx,cy) trong khung board
function zoomTo(factor, center) {
    const old = scale;
    const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
    const cx = center.cx, cy = center.cy;
    // Giữ điểm (cx,cy) đúng vị trí khi đổi scale
    tx = cx - ((cx - tx) * (newScale / old));
    ty = cy - ((cy - ty) * (newScale / old));
    scale = newScale;
    constrainPan();
    applyTransform();
}

// Nút zoom (bám vị trí chuột gần nhất)
zoomInBtn.addEventListener('click', () => zoomTo(1.2, { cx: lastPointer.cx, cy: lastPointer.cy }));
zoomOutBtn.addEventListener('click', () => zoomTo(1 / 1.2, { cx: lastPointer.cx, cy: lastPointer.cy }));
zoomResetBtn.addEventListener('click', () => { scale = 1; tx = 0; ty = 0; constrainPan(); applyTransform(); });

// Wheel zoom (desktop) – bám đúng vị trí con trỏ
boardEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = (e.deltaY < 0) ? 1.1 : 1 / 1.1;
    const r = boardEl.getBoundingClientRect();
    zoomTo(factor, { cx: e.clientX - r.left, cy: e.clientY - r.top });
}, { passive: false });

// Kéo (pan) bằng chuột (desktop)
let dragging = false, lastMouse = { x: 0, y: 0 };
zoomLayer.addEventListener('mousedown', (e) => {
    dragging = true; lastMouse = { x: e.clientX, y: e.clientY };
    zoomLayer.classList.add('grabbing');
});
window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    tx += (e.clientX - lastMouse.x);
    ty += (e.clientY - lastMouse.y);
    lastMouse = { x: e.clientX, y: e.clientY };
    constrainPan(); applyTransform();
});
window.addEventListener('mouseup', () => {
    dragging = false; zoomLayer.classList.remove('grabbing');
});

// Touch pinch & pan (mobile)
let startScale = 1, startTx = 0, startTy = 0, startDist = 0, startMid = { x: 0, y: 0 };
let panning = false, lastPan = { x: 0, y: 0 };
let lastTapTime = 0;

boardEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        e.preventDefault();
        startScale = scale; startTx = tx; startTy = ty;
        const [t1, t2] = e.touches;
        startDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const r = boardEl.getBoundingClientRect();
        startMid = { x: (t1.clientX + t2.clientX) / 2 - r.left, y: (t1.clientY + t2.clientY) / 2 - r.top };
    } else if (e.touches.length === 1) {
        panning = true;
        lastPan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        // double-tap → reset
        const now = Date.now();
        if (now - lastTapTime < 300) { scale = 1; tx = 0; ty = 0; constrainPan(); applyTransform(); }
        lastTapTime = now;
    }
}, { passive: false });

boardEl.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
        e.preventDefault();
        const [t1, t2] = e.touches;
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const factor = dist / (startDist || 1);
        const newScale = clamp(startScale * factor, MIN_SCALE, MAX_SCALE);
        // giữ midpoint cố định khi pinch
        tx = startMid.x - (startMid.x - startTx) * (newScale / startScale);
        ty = startMid.y - (startMid.y - startTy) * (newScale / startScale);
        scale = newScale; constrainPan(); applyTransform();
    } else if (e.touches.length === 1 && panning) {
        e.preventDefault();
        const t = e.touches[0];
        tx += (t.clientX - lastPan.x);
        ty += (t.clientY - lastPan.y);
        lastPan = { x: t.clientX, y: t.clientY };
        constrainPan(); applyTransform();
    }
}, { passive: false });

boardEl.addEventListener('touchend', () => { panning = false; });

// === Lấy toạ độ (%)
document.addEventListener('click', (e) => { if (popoverEl && !popoverEl.contains(e.target)) closePopover(); });
editToggle.addEventListener('change', () => {
    coordHint.style.display = editToggle.checked ? 'block' : 'none';
    boardEl.style.cursor = editToggle.checked ? 'crosshair' : 'default';
});
boardEl.addEventListener('click', (e) => {
    if (!editToggle.checked) return;
    const p = pointPercentFromClient(e.clientX, e.clientY);
    const txt = `${p.x.toFixed(2)}, ${p.y.toFixed(2)}`;
    navigator.clipboard?.writeText(txt).catch(() => { });
    alert(`Toạ độ đã copy: ${txt}\n→ Dán vào cột x_pct, y_pct hoặc tính rect_*/polygon trong Google Sheet.`);
});

function pointPercentFromClient(clientX, clientY) {
    const rect = imgEl.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
}

// === Load & init
async function load() {
    try {
        data = await fetchSheet();
        render();
        // reset view
        scale = 1; tx = 0; ty = 0; constrainPan(); applyTransform();
    } catch (e) {
        console.error(e); alert('Lỗi tải dữ liệu. Mở DevTools để xem chi tiết.');
    }
}
refreshBtn.addEventListener('click', load);

// Bắt đầu
load();