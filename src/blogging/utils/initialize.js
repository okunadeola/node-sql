const fs = require('fs');
const path = require('path');
const pool = require('../utils/db');

const runSchema = async () => {
    const client = await pool.connect();
    try {
      // 1. Run schema files
      const schemaDir = path.join(process.cwd(), 'db', 'schema');
      const schemaFiles = fs.readdirSync(schemaDir).sort();
      for (const file of schemaFiles) {
        const sql = fs.readFileSync(path.join(schemaDir, file), 'utf8');
        await client.query(sql);
      }
  
      // 2. Run index files
      const indexDir = path.join(process.cwd(), 'db', 'indexes');
      const indexFiles = fs.readdirSync(indexDir);
      for (const file of indexFiles) {
        const sql = fs.readFileSync(path.join(indexDir, file), 'utf8');
        await client.query(sql);
        console.log(`Index created: ${file}`);
      }
    } finally {
      client.release();
    }
  };

runSchema().catch(console.error);