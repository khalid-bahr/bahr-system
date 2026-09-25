const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3300;
const DB_PATH = path.join(__dirname, 'al_diyafa.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Initialize Database
const db = new DatabaseSync(DB_PATH);

// Configure WAL mode for performance & reliability
db.exec(`PRAGMA journal_mode = WAL;`);

// Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cashier', -- 'admin', 'cashier', 'owner'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    full_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    shift_type TEXT NOT NULL, -- 'صباحية' أو 'مسائية'
    cashier_name TEXT,
    status TEXT DEFAULT 'open', -- 'open', 'closed'
    opening_custody REAL DEFAULT 0, -- العهدة الافتتاحية
    total_sales REAL DEFAULT 0, -- إجمالي المبيعات
    card_sales REAL DEFAULT 0, -- مبيعات البطاقة / شبكة
    credit_sales REAL DEFAULT 0, -- مبيعات الآجل
    cash_sales REAL DEFAULT 0, -- المبيعات النقدية
    expenses_cash REAL DEFAULT 0, -- المصروفات النقدية المحسوبة للوردية
    expected_cash REAL DEFAULT 0, -- النقدي المتوقع
    actual_cash REAL DEFAULT 0, -- النقدي الموجود الفعلي
    difference REAL DEFAULT 0, -- الفرق (الموجود - المتوقع)
    result_status TEXT DEFAULT 'لم يُغلق', -- 'متطابق', 'عجز', 'زيادة', 'لم يُغلق'
    notes TEXT,
    opened_at TEXT,
    closed_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    shift_id INTEGER,
    shift_type TEXT NOT NULL, -- 'صباحية', 'مسائية', 'عام'
    time TEXT,
    category TEXT NOT NULL, -- 'مرافق', 'مشتريات', 'رواتب وأجور', 'مواد خام', 'طعام', 'نظافة', 'صيانة', 'أخرى'
    item TEXT NOT NULL, -- 'كهرباء', 'سلفه', 'خضار', 'ارز بسمتي', 'بون'...
    details TEXT, -- البيان والتفاصيل
    payment_method TEXT NOT NULL DEFAULT 'نقدي', -- 'نقدي' أو 'تحويل'
    amount REAL NOT NULL,
    receipt_image TEXT, -- Base64 encoded or path
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    items TEXT -- comma separated common items
  );
`);

// Insert default settings if not exist
const getSetting = (key) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : null;
};

const setSetting = (key, value) => {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
};

if (!getSetting('restaurant_name')) {
  setSetting('restaurant_name', 'مطعم الضيافة العُمانية');
  setSetting('currency', 'ر.ع'); // أو ج.م / ر.س
  setSetting('manager_name', 'المدير العام');
}

// Ensure default categories exist
const initCategories = [
  { name: 'مرافق', items: 'كهرباء,ماء,غاز,إنترنت,صيانة عامة' },
  { name: 'رواتب وأجور', items: 'سلفه,راتب أسبوعي,راتب شهري,مكافأة,بدل انتقال' },
  { name: 'مواد خام', items: 'ارز بسمتي,زيوت,توابل وبقوليات,لحوم ودواجن,أسماك,معلبات' },
  { name: 'مشتريات', items: 'خضار,فواكه,ألبان وأجبان,بون,مخبوزات' },
  { name: 'طعام', items: 'طعام موظفين,ضيافة زبائن,دخان ونعناع' },
  { name: 'نظافة', items: 'بريل,مناديل,مطهرات,أكياس قمامة,أدوات نظافة' },
  { name: 'صيانة ومعدات', items: 'صيانة ثلاجات,أفران,إضاءة,أدوات مطبخ' },
  { name: 'أخرى', items: 'فواتير هاتف,إكراميات,مصاريف نقل,حكومية' }
];

const catCount = db.prepare(`SELECT COUNT(*) as count FROM categories`).get().count;
if (catCount === 0) {
  const insertCat = db.prepare(`INSERT INTO categories (name, items) VALUES (?, ?)`);
  for (const c of initCategories) {
    insertCat.run(c.name, c.items);
  }
}

// Password Hashing Helper
function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd) + 'al_diyafa_secure_salt').digest('hex');
}

// Seed Default Users if none exist
const userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
if (userCount === 0) {
  const insertUser = db.prepare(`INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)`);
  insertUser.run('admin', hashPassword('admin123'), 'المدير العام', 'admin');
  insertUser.run('cashier', hashPassword('123456'), 'كاشير الوردية', 'cashier');
  insertUser.run('owner', hashPassword('owner123'), 'صاحب المطعم', 'owner');
  console.log('✅ Initial users created: admin (admin123), cashier (123456), owner (owner123)');
}

// Helper to authenticate request
function getSessionUser(req) {
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    token = urlObj.searchParams.get('token');
  }
  if (!token) return null;

  const session = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
  return session || null;
}

// Function to recalculate shift cash expenses & expected cash
function recalculateShift(shiftId) {
  const shift = db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(shiftId);
  if (!shift) return;

  // Calculate cash expenses linked to this shift
  // Only 'نقدي' affects the cash drawer! 'تحويل' does NOT subtract from cashier drawer.
  const expensesRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as cash_expenses 
    FROM expenses 
    WHERE (shift_id = ? OR (date = ? AND shift_type = ?))
      AND payment_method = 'نقدي'
  `).get(shift.id, shift.date, shift.shift_type);

  const expensesCash = expensesRow ? expensesRow.cash_expenses : 0;
  
  // Total sales breakdown
  const cardSales = Number(shift.card_sales) || 0;
  const creditSales = Number(shift.credit_sales) || 0;
  const totalSales = Number(shift.total_sales) || 0;
  const custody = Number(shift.opening_custody) || 0;
  const actualCash = Number(shift.actual_cash) || 0;

  // Cash sales = Total sales - Card sales - Credit sales
  let cashSales = totalSales - cardSales - creditSales;
  if (cashSales < 0) cashSales = 0;

  // Expected cash = Cash Sales + Custody - Cash Expenses
  const expectedCash = (cashSales + custody) - expensesCash;
  const difference = actualCash - expectedCash;

  let resultStatus = shift.status === 'open' ? 'لم يُغلق' : 'متطابق';
  if (shift.status === 'closed') {
    if (Math.abs(difference) < 0.01) {
      resultStatus = 'متطابق';
    } else if (difference < 0) {
      resultStatus = 'عجز';
    } else {
      resultStatus = 'زيادة';
    }
  }

  db.prepare(`
    UPDATE shifts 
    SET cash_sales = ?, 
        expenses_cash = ?, 
        expected_cash = ?, 
        difference = ?, 
        result_status = ? 
    WHERE id = ?
  `).run(cashSales, expensesCash, expectedCash, difference, resultStatus, shift.id);
}

// Helper to parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 25 * 1024 * 1024) { // 25MB max for receipt images
        reject(new Error('Payload Too Large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// Helper for sending JSON
function sendJSON(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// HTTP Server
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // API Routes
    if (pathname.startsWith('/api/')) {
      // 0. Authentication API
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await parseBody(req);
        const { username, password } = body;
        if (!username || !password) {
          return sendJSON(res, { error: 'اسم المستخدم وكلمة المرور مطلوبان' }, 400);
        }

        const hashed = hashPassword(password);
        const user = db.prepare(`SELECT * FROM users WHERE username = ? AND password = ?`).get(username.trim(), hashed);
        if (!user) {
          return sendJSON(res, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }, 401);
        }

        const token = crypto.randomBytes(32).toString('hex');
        db.prepare(`
          INSERT INTO sessions (token, user_id, username, role, full_name)
          VALUES (?, ?, ?, ?, ?)
        `).run(token, user.id, user.username, user.role, user.full_name);

        return sendJSON(res, {
          success: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role
          }
        });
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const session = getSessionUser(req);
        if (session) {
          db.prepare(`DELETE FROM sessions WHERE token = ?`).run(session.token);
        }
        return sendJSON(res, { success: true, message: 'تم تسجيل الخروج بنجاح' });
      }

      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const session = getSessionUser(req);
        if (!session) {
          return sendJSON(res, { error: 'غير مسجل الدخول' }, 401);
        }
        return sendJSON(res, {
          success: true,
          user: {
            id: session.user_id,
            username: session.username,
            full_name: session.full_name,
            role: session.role
          }
        });
      }

      // Users Management (Owner Only)
      if (pathname === '/api/users' || pathname.startsWith('/api/users/')) {
        const session = getSessionUser(req);
        if (!session || session.role !== 'owner') {
          return sendJSON(res, { error: 'عفواً، هذه الصلاحية خاصة بصاحب المطعم (Owner) فقط' }, 403);
        }

        if (pathname === '/api/users' && req.method === 'GET') {
          const users = db.prepare(`SELECT id, username, full_name, role, created_at FROM users ORDER BY id ASC`).all();
          return sendJSON(res, { success: true, users });
        }
        if (pathname === '/api/users' && req.method === 'POST') {
          const body = await parseBody(req);
          const { username, password, full_name, role } = body;
          if (!username || !password || !full_name) {
            return sendJSON(res, { error: 'جميع الحقول مطلوبة' }, 400);
          }
          const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username.trim());
          if (existing) {
            return sendJSON(res, { error: 'اسم المستخدم مسجل بالفعل مسبقاً' }, 400);
          }

          const hashed = hashPassword(password);
          db.prepare(`
            INSERT INTO users (username, password, full_name, role)
            VALUES (?, ?, ?, ?)
          `).run(username.trim(), hashed, full_name.trim(), role || 'cashier');

          return sendJSON(res, { success: true, message: 'تم إضافة المستخدم بنجاح' });
        }

        const userDelMatch = pathname.match(/^\/api\/users\/(\d+)$/);
        if (userDelMatch && req.method === 'DELETE') {
          const uId = parseInt(userDelMatch[1], 10);
          // Prevent owner from deleting their own account
          if (session.user_id === uId) {
            return sendJSON(res, { error: 'لا يمكنك حذف حساب المالك الحالي' }, 400);
          }
          db.prepare(`DELETE FROM users WHERE id = ?`).run(uId);
          return sendJSON(res, { success: true, message: 'تم حذف المستخدم' });
        }
      }

      // 1. Dashboard summary
      if (pathname === '/api/dashboard' && req.method === 'GET') {
        const fallbackDate = new Date().toISOString().slice(0, 10);
        const today = urlObj.searchParams.get('date') || fallbackDate;
        
        // Today's morning and evening expenses
        const morningExp = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date = ? AND shift_type = 'صباحية'`).get(today).total;
        const eveningExp = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date = ? AND shift_type = 'مسائية'`).get(today).total;
        const generalExp = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date = ? AND shift_type = 'عام'`).get(today).total;
        const todayExpTotal = morningExp + eveningExp + generalExp;

        // Current Month string (YYYY-MM)
        const currentMonth = today.slice(0, 7);
        const monthExpTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date LIKE ?`).get(`${currentMonth}%`).total;
        const monthSalesTotal = db.prepare(`SELECT COALESCE(SUM(total_sales), 0) as total FROM shifts WHERE date LIKE ?`).get(`${currentMonth}%`).total;
        const monthCardTotal = db.prepare(`SELECT COALESCE(SUM(card_sales), 0) as total FROM shifts WHERE date LIKE ?`).get(`${currentMonth}%`).total;
        const monthCreditTotal = db.prepare(`SELECT COALESCE(SUM(credit_sales), 0) as total FROM shifts WHERE date LIKE ?`).get(`${currentMonth}%`).total;

        // Total shortage and overage this month
        const shortages = db.prepare(`SELECT COALESCE(SUM(ABS(difference)), 0) as total FROM shifts WHERE date LIKE ? AND result_status = 'عجز'`).get(`${currentMonth}%`).total;
        const overages = db.prepare(`SELECT COALESCE(SUM(difference), 0) as total FROM shifts WHERE date LIKE ? AND result_status = 'زيادة'`).get(`${currentMonth}%`).total;

        // Active shift (if any)
        const activeShift = db.prepare(`SELECT * FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get() || null;

        // Today shifts list
        const todayShifts = db.prepare(`SELECT * FROM shifts WHERE date = ? ORDER BY id ASC`).all(today);

        // Recent 5 expenses
        const recentExpenses = db.prepare(`SELECT * FROM expenses ORDER BY id DESC LIMIT 8`).all();

        return sendJSON(res, {
          success: true,
          date: today,
          month: currentMonth,
          kpis: {
            morningExpense: morningExp,
            eveningExpense: eveningExp,
            todayTotalExpense: todayExpTotal,
            monthTotalExpense: monthExpTotal,
            monthTotalSales: monthSalesTotal,
            monthCardSales: monthCardTotal,
            monthCreditSales: monthCreditTotal,
            monthShortage: shortages,
            monthOverage: overages
          },
          activeShift,
          todayShifts,
          recentExpenses,
          restaurantName: getSetting('restaurant_name'),
          currency: getSetting('currency')
        });
      }

      // 2. Shifts API
      if (pathname === '/api/shifts') {
        if (req.method === 'GET') {
          const month = urlObj.searchParams.get('month');
          const date = urlObj.searchParams.get('date');
          let query = `SELECT * FROM shifts`;
          const params = [];
          if (date) {
            query += ` WHERE date = ?`;
            params.push(date);
          } else if (month) {
            query += ` WHERE date LIKE ?`;
            params.push(`${month}%`);
          }
          query += ` ORDER BY date DESC, id DESC`;
          const shifts = db.prepare(query).all(...params);
          return sendJSON(res, { success: true, shifts });
        }

        if (req.method === 'POST') {
          const body = await parseBody(req);
          const date = body.date || new Date().toISOString().slice(0, 10);
          const shift_type = body.shift_type || 'صباحية';
          const cashier_name = body.cashier_name || 'الكاشير';
          const opening_custody = Number(body.opening_custody) || 0;
          const total_sales = Number(body.total_sales) || 0;
          const card_sales = Number(body.card_sales) || 0;
          const credit_sales = Number(body.credit_sales) || 0;
          const actual_cash = Number(body.actual_cash) || 0;
          const status = body.status || 'open';
          const notes = body.notes || '';
          const opened_at = body.opened_at || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
          const closed_at = status === 'closed' ? (body.closed_at || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })) : null;

          const stmt = db.prepare(`
            INSERT INTO shifts (date, shift_type, cashier_name, status, opening_custody, total_sales, card_sales, credit_sales, actual_cash, notes, opened_at, closed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const result = stmt.run(date, shift_type, cashier_name, status, opening_custody, total_sales, card_sales, credit_sales, actual_cash, notes, opened_at, closed_at);
          
          const shiftId = Number(result.lastInsertRowid);
          recalculateShift(shiftId);
          const shift = db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(shiftId);
          return sendJSON(res, { success: true, shift });
        }
      }

      // 2b. Close Shift
      if (pathname === '/api/shifts/close' && req.method === 'POST') {
        const body = await parseBody(req);
        const { id, actual_cash, total_sales, card_sales, credit_sales, notes } = body;
        if (!id) return sendJSON(res, { error: 'Shift ID is required' }, 400);

        const closed_at = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        db.prepare(`
          UPDATE shifts 
          SET status = 'closed',
              actual_cash = COALESCE(?, actual_cash),
              total_sales = COALESCE(?, total_sales),
              card_sales = COALESCE(?, card_sales),
              credit_sales = COALESCE(?, credit_sales),
              notes = COALESCE(?, notes),
              closed_at = ?
          WHERE id = ?
        `).run(actual_cash, total_sales, card_sales, credit_sales, notes, closed_at, id);

        recalculateShift(id);
        const updated = db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(id);
        return sendJSON(res, { success: true, shift: updated });
      }

      // 2c. Update Shift
      const shiftIdMatch = pathname.match(/^\/api\/shifts\/(\d+)$/);
      if (shiftIdMatch) {
        const shiftId = parseInt(shiftIdMatch[1], 10);
        if (req.method === 'PUT') {
          const body = await parseBody(req);
          db.prepare(`
            UPDATE shifts 
            SET date = COALESCE(?, date),
                shift_type = COALESCE(?, shift_type),
                cashier_name = COALESCE(?, cashier_name),
                status = COALESCE(?, status),
                opening_custody = COALESCE(?, opening_custody),
                total_sales = COALESCE(?, total_sales),
                card_sales = COALESCE(?, card_sales),
                credit_sales = COALESCE(?, credit_sales),
                actual_cash = COALESCE(?, actual_cash),
                notes = COALESCE(?, notes),
                closed_at = COALESCE(?, closed_at)
            WHERE id = ?
          `).run(
            body.date,
            body.shift_type,
            body.cashier_name,
            body.status,
            body.opening_custody !== undefined ? Number(body.opening_custody) : null,
            body.total_sales !== undefined ? Number(body.total_sales) : null,
            body.card_sales !== undefined ? Number(body.card_sales) : null,
            body.credit_sales !== undefined ? Number(body.credit_sales) : null,
            body.actual_cash !== undefined ? Number(body.actual_cash) : null,
            body.notes,
            body.closed_at,
            shiftId
          );

          recalculateShift(shiftId);
          const shift = db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(shiftId);
          return sendJSON(res, { success: true, shift });
        }

        if (req.method === 'DELETE') {
          db.prepare(`DELETE FROM shifts WHERE id = ?`).run(shiftId);
          return sendJSON(res, { success: true, message: 'Deleted successfully' });
        }
      }

      // 3. Expenses API
      if (pathname === '/api/expenses') {
        if (req.method === 'GET') {
          const month = urlObj.searchParams.get('month');
          const date = urlObj.searchParams.get('date');
          const shift_type = urlObj.searchParams.get('shift_type');
          const category = urlObj.searchParams.get('category');
          const method = urlObj.searchParams.get('payment_method');

          let query = `SELECT * FROM expenses WHERE 1=1`;
          const params = [];

          if (date) {
            query += ` AND date = ?`;
            params.push(date);
          } else if (month) {
            query += ` AND date LIKE ?`;
            params.push(`${month}%`);
          }

          if (shift_type) {
            query += ` AND shift_type = ?`;
            params.push(shift_type);
          }

          if (category) {
            query += ` AND category = ?`;
            params.push(category);
          }

          if (method) {
            query += ` AND payment_method = ?`;
            params.push(method);
          }

          query += ` ORDER BY date DESC, id DESC`;
          const expenses = db.prepare(query).all(...params);
          return sendJSON(res, { success: true, expenses });
        }

        if (req.method === 'POST') {
          const body = await parseBody(req);
          const date = body.date || new Date().toISOString().slice(0, 10);
          const shift_type = body.shift_type || 'صباحية';
          const time = body.time || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
          const category = body.category || 'أخرى';
          const item = body.item || '';
          const details = body.details || '';
          const payment_method = body.payment_method || 'نقدي';
          const amount = Number(body.amount) || 0;
          const receipt_image = body.receipt_image || null;
          const notes = body.notes || '';
          const shift_id = body.shift_id || null;

          const stmt = db.prepare(`
            INSERT INTO expenses (date, shift_id, shift_type, time, category, item, details, payment_method, amount, receipt_image, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const result = stmt.run(date, shift_id, shift_type, time, category, item, details, payment_method, amount, receipt_image, notes);
          const expenseId = Number(result.lastInsertRowid);

          // Find if there is an active/matching shift for this date & shift_type to recalculate
          const shift = db.prepare(`SELECT id FROM shifts WHERE date = ? AND shift_type = ?`).get(date, shift_type);
          if (shift) {
            recalculateShift(shift.id);
          }

          const expense = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(expenseId);
          return sendJSON(res, { success: true, expense });
        }
      }

      // Update / Delete Expense
      const expIdMatch = pathname.match(/^\/api\/expenses\/(\d+)$/);
      if (expIdMatch) {
        const expId = parseInt(expIdMatch[1], 10);
        if (req.method === 'PUT') {
          const body = await parseBody(req);
          const oldExp = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(expId);
          if (!oldExp) return sendJSON(res, { error: 'Expense not found' }, 404);

          db.prepare(`
            UPDATE expenses 
            SET date = COALESCE(?, date),
                shift_type = COALESCE(?, shift_type),
                time = COALESCE(?, time),
                category = COALESCE(?, category),
                item = COALESCE(?, item),
                details = COALESCE(?, details),
                payment_method = COALESCE(?, payment_method),
                amount = COALESCE(?, amount),
                notes = COALESCE(?, notes),
                receipt_image = COALESCE(?, receipt_image)
            WHERE id = ?
          `).run(
            body.date,
            body.shift_type,
            body.time,
            body.category,
            body.item,
            body.details,
            body.payment_method,
            body.amount !== undefined ? Number(body.amount) : null,
            body.notes,
            body.receipt_image,
            expId
          );

          // Recalculate relevant shifts
          const shift = db.prepare(`SELECT id FROM shifts WHERE date = ? AND shift_type = ?`).get(body.date || oldExp.date, body.shift_type || oldExp.shift_type);
          if (shift) recalculateShift(shift.id);

          const updated = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(expId);
          return sendJSON(res, { success: true, expense: updated });
        }

        if (req.method === 'DELETE') {
          const oldExp = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(expId);
          db.prepare(`DELETE FROM expenses WHERE id = ?`).run(expId);
          if (oldExp) {
            const shift = db.prepare(`SELECT id FROM shifts WHERE date = ? AND shift_type = ?`).get(oldExp.date, oldExp.shift_type);
            if (shift) recalculateShift(shift.id);
          }
          return sendJSON(res, { success: true, message: 'Deleted' });
        }
      }

      // 4. Monthly Summary API
      if (pathname === '/api/monthly-summary' && req.method === 'GET') {
        const month = urlObj.searchParams.get('month') || new Date().toISOString().slice(0, 7);

        // Group shifts by date
        const daysData = db.prepare(`
          SELECT 
            date,
            COUNT(id) as shift_count,
            COALESCE(SUM(total_sales), 0) as total_sales,
            COALESCE(SUM(card_sales), 0) as card_sales,
            COALESCE(SUM(credit_sales), 0) as credit_sales,
            COALESCE(SUM(cash_sales), 0) as cash_sales,
            COALESCE(SUM(expenses_cash), 0) as expenses_cash,
            COALESCE(SUM(expected_cash), 0) as expected_cash,
            COALESCE(SUM(actual_cash), 0) as actual_cash,
            COALESCE(SUM(opening_custody), 0) as total_custody,
            COALESCE(SUM(difference), 0) as total_diff
          FROM shifts 
          WHERE date LIKE ? 
          GROUP BY date 
          ORDER BY date ASC
        `).all(`${month}%`);

        // Also query total expenses per date (including bank transfers)
        const dateExpenses = db.prepare(`
          SELECT date, COALESCE(SUM(amount), 0) as total_expense
          FROM expenses
          WHERE date LIKE ?
          GROUP BY date
        `).all(`${month}%`);

        const expenseMap = {};
        for (const e of dateExpenses) {
          expenseMap[e.date] = e.total_expense;
        }

        // Merge daily summary with status
        const summary = daysData.map(day => {
          let status = 'متطابق';
          if (Math.abs(day.total_diff) < 0.01) {
            status = 'متطابق';
          } else if (day.total_diff < 0) {
            status = 'عجز';
          } else {
            status = 'زيادة';
          }

          return {
            ...day,
            all_expenses: expenseMap[day.date] || day.expenses_cash,
            status
          };
        });

        // Totals for top cards
        const totals = {
          total_sales: summary.reduce((acc, s) => acc + s.total_sales, 0),
          card_sales: summary.reduce((acc, s) => acc + s.card_sales, 0),
          credit_sales: summary.reduce((acc, s) => acc + s.credit_sales, 0),
          cash_sales: summary.reduce((acc, s) => acc + s.cash_sales, 0),
          total_expenses: summary.reduce((acc, s) => acc + s.all_expenses, 0),
          expected_cash: summary.reduce((acc, s) => acc + s.expected_cash, 0),
          actual_cash: summary.reduce((acc, s) => acc + s.actual_cash, 0),
          total_overage: summary.filter(s => s.total_diff > 0).reduce((acc, s) => acc + s.total_diff, 0),
          total_shortage: Math.abs(summary.filter(s => s.total_diff < 0).reduce((acc, s) => acc + s.total_diff, 0))
        };

        return sendJSON(res, { success: true, month, totals, summary });
      }

      // 5. Categories & Settings API
      if (pathname === '/api/categories') {
        const cats = db.prepare(`SELECT * FROM categories`).all();
        return sendJSON(res, { success: true, categories: cats });
      }

      if (pathname === '/api/settings') {
        if (req.method === 'GET') {
          const rows = db.prepare(`SELECT key, value FROM settings`).all();
          const s = {};
          for (const r of rows) s[r.key] = r.value;
          return sendJSON(res, { success: true, settings: s });
        }
        if (req.method === 'POST') {
          const body = await parseBody(req);
          for (const [key, val] of Object.entries(body)) {
            setSetting(key, String(val));
          }
          return sendJSON(res, { success: true, message: 'Settings saved' });
        }
      }

      // 6. Reset / Seed Demo Data (from the user's Excel sheets)
      if (pathname === '/api/seed-demo' && req.method === 'POST') {
        require('./seed_data.js')(db);
        return sendJSON(res, { success: true, message: 'تم تحميل بيانات الشيتات بنجاح!' });
      }

      // 7. Clear all data for clean production use
      if (pathname === '/api/reset-database' && req.method === 'POST') {
        db.exec(`
          DELETE FROM expenses;
          DELETE FROM shifts;
          DELETE FROM sqlite_sequence WHERE name IN ('expenses', 'shifts');
        `);
        return sendJSON(res, { success: true, message: 'تم تصفير وتفريغ قاعدة البيانات بنجاح، النظام جاهز للعمل الحقيقي.' });
      }

      return sendJSON(res, { error: 'Endpoint Not Found' }, 404);
    }

    // Static Files Handling
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Internal Server Error: ' + err.message);
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });

  } catch (err) {
    console.error('Server error:', err);
    sendJSON(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  مطعم الضيافة العُمانية - نظام إدارة المالية والورديات  `);
  console.log(`  الخادم يعمل الآن بنجاح على: http://localhost:${PORT} `);
  console.log(`====================================================`);
});
