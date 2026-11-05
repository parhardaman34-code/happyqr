const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = __dirname;

// Backend In-Memory State for Orders & Firebase Config
let BACKEND_ORDERS = [];
let SERVER_FIREBASE_CONFIG = {
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  apiKey: process.env.FIREBASE_API_KEY || ''
};

// Try loading saved backend server config if present
try {
  const cfgPath = path.join(PUBLIC_DIR, '.server_firebase_config.json');
  if (fs.existsSync(cfgPath)) {
    const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (saved && saved.projectId) {
      SERVER_FIREBASE_CONFIG = { ...SERVER_FIREBASE_CONFIG, ...saved };
    }
  }
} catch (e) {}

// Firestore REST Object Serializer (Converts standard JS objects to Firestore REST schema)
function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: val.toString() };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map(item => {
            if (typeof item === 'object') {
              return { mapValue: { fields: toFirestoreFields(item) } };
            } else if (typeof item === 'string') {
              return { stringValue: item };
            } else if (typeof item === 'number') {
              return { integerValue: item.toString() };
            }
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: toFirestoreFields(val) } };
    }
  }
  return fields;
}

// Background Firestore Order Saver (Runs strictly on the server - invisible to customer)
function saveOrderToFirestoreBackend(orderData) {
  const projectId = SERVER_FIREBASE_CONFIG.projectId || process.env.FIREBASE_PROJECT_ID;
  const apiKey = SERVER_FIREBASE_CONFIG.apiKey || process.env.FIREBASE_API_KEY;

  if (!projectId) {
    return Promise.resolve(null);
  }

  const payload = JSON.stringify({
    fields: toFirestoreFields(orderData)
  });

  const docId = orderData.orderId || ('ORD-' + Date.now());
  const reqPath = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/orders/${encodeURIComponent(docId)}${apiKey ? '?key=' + encodeURIComponent(apiKey) : ''}`;

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      port: 443,
      path: reqPath,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300 });
      });
    });

    req.on('error', err => {
      console.warn('Backend Firebase sync notice:', err.message);
      resolve(null);
    });

    req.write(payload);
    req.end();
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = (req.url || '/').split('?')[0];

  // API: Server-side Order and Add-on Validation
  if (urlPath === '/api/validate-order' && req.method === 'POST') {
    const handlePayload = (raw) => {
      try {
        const payload = typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
        const items = payload.items || [];
        const menuPath = path.join(PUBLIC_DIR, 'menu.json');
        const menuData = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
        const addonsConfig = menuData._addons || [];
        const addonsMap = {};
        addonsConfig.forEach(a => { addonsMap[a.id] = a; });

        let calculatedTotal = 0;
        const now = Date.now();

        for (const it of items) {
          const cat = it.category;
          const catItems = menuData[cat] || [];
          const found = catItems.find(x => x.name === it.name);

          if (!found) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: false, error: `Dish "${it.name}" was not found in ${cat}.` }));
            return;
          }

          // Check out-of-stock
          if (found.status === 'unavailable') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: false, error: `"${found.name}" is currently unavailable.` }));
            return;
          }
          if (found.status === 'temp_out_of_stock' && found.outOfStockUntil && now < found.outOfStockUntil) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: false, error: `"${found.name}" is temporarily out of stock.` }));
            return;
          }

          // Compute item base price
          let basePrice = found.price || 0;
          if (found.variants && it.variantLabel) {
            const v = found.variants.find(vx => vx.label === it.variantLabel);
            if (v) basePrice = v.price;
          }

          // Validate add-ons
          let addonsSum = 0;
          if (Array.isArray(it.addons)) {
            for (const add of it.addons) {
              const cfg = addonsMap[add.id];
              if (!cfg || cfg.enabled === false) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ valid: false, error: `Add-on "${add.name || add.id}" is not available.` }));
                return;
              }
              const addQty = Math.max(1, Number(add.qty) || 1);
              addonsSum += (cfg.price * addQty);
            }
          }

          const lineUnitPrice = basePrice + addonsSum;
          const lineQty = Math.max(1, Number(it.qty) || 1);
          calculatedTotal += (lineUnitPrice * lineQty);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid: true, grandTotal: calculatedTotal, verifiedAt: now }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid: false, error: 'Invalid order payload' }));
      }
    };

    if (req.body) {
      handlePayload(req.body);
    } else {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { handlePayload(body); });
    }
    return;
  }

  // API: Get Menu for Customer (Clean Backend Proxy - No Firebase exposed)
  if (urlPath === '/api/menu' && req.method === 'GET') {
    const menuPath = path.join(PUBLIC_DIR, 'menu.json');
    fs.readFile(menuPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read menu' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
    return;
  }

  // API: Place Order (Backend receives customer order & saves to Firebase in the background)
  if (urlPath === '/api/order' && req.method === 'POST') {
    const handleOrder = (raw) => {
      try {
        const order = typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
        if (!order || !order.customerName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Customer name required' }));
          return;
        }

        const orderId = order.orderId || ('ORD-' + Math.floor(100000 + Math.random() * 900000));
        order.orderId = orderId;
        order.id = orderId;
        order.serverTimestamp = new Date().toISOString();

        // 1. Keep in server orders store
        BACKEND_ORDERS.unshift(order);
        if (BACKEND_ORDERS.length > 200) BACKEND_ORDERS.pop();

        // 2. Save directly to Cloud Firestore from server backend (invisible to customer)
        saveOrderToFirestoreBackend(order).catch(() => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          orderId: orderId,
          message: 'Order recorded securely in backend'
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    };

    if (req.body) {
      handleOrder(req.body);
    } else {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { handleOrder(body); });
    }
    return;
  }

  // API: Stream Recent Orders for Admin Dashboard
  if (urlPath === '/api/orders' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(BACKEND_ORDERS));
    return;
  }

  // API: Configure Backend Firebase Credentials (Private Admin API)
  if (urlPath === '/api/server-config' && req.method === 'POST') {
    const handleConfig = (raw) => {
      try {
        const cfg = typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
        if (cfg.projectId) SERVER_FIREBASE_CONFIG.projectId = cfg.projectId;
        if (cfg.apiKey) SERVER_FIREBASE_CONFIG.apiKey = cfg.apiKey;

        try {
          const cfgPath = path.join(PUBLIC_DIR, '.server_firebase_config.json');
          fs.writeFileSync(cfgPath, JSON.stringify(SERVER_FIREBASE_CONFIG, null, 2));
        } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          projectId: SERVER_FIREBASE_CONFIG.projectId,
          hasApiKey: Boolean(SERVER_FIREBASE_CONFIG.apiKey)
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid config' }));
      }
    };

    if (req.body) {
      handleConfig(req.body);
    } else {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { handleConfig(body); });
    }
    return;
  }

  let safePath = decodeURI(urlPath);
  if (safePath === '/' || safePath === '') {
    safePath = '/index.html';
  } else if (safePath === '/admin' || safePath === '/admin/') {
    safePath = '/admin.html';
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
}

// Export for Vercel Serverless Function runtime
module.exports = handler;

// Local development server runner
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(handler);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`  Kappy Cafe Server is Running!`);
    console.log(`  Local URL: http://localhost:${PORT}`);
    console.log(`========================================\n`);
  });
}
