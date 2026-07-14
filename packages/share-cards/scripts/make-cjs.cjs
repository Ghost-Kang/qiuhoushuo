const fs = require('fs');
const path = require('path');
const dist = path.join(__dirname, '..', 'dist');
fs.writeFileSync(path.join(dist, 'index.cjs'), "module.exports = require('./index.js');\n");
