require('dotenv').config();
const { Pool } = require('pg');
const express = require("express");


const app = express();
const PORT = process.env.PORT || 3002;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) throw err;
  console.log('Connected at:', res.rows[0].now);
  pool.end(); // Close the pool
});


const createTable = async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(50) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('Table created');
    } finally {
      client.release();
    }
  };
  
  createTable();



app.listen(PORT, () => {
    console.log(`server running on port ${PORT}`);
  });