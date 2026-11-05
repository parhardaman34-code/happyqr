const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = __dirname;

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
