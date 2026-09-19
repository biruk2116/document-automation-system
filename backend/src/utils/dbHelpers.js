/**
 * Database Helper Functions
 * Abstracts MySQL vs PostgreSQL differences
 */

const { pool } = require('../config/db');

/**
 * Execute INSERT query and return the inserted ID
 * PostgreSQL uses RETURNING id, MySQL uses result.insertId
 */
async function insertAndGetId(sql, params) {
  // Check if already has RETURNING clause
  if (!sql.toUpperCase().includes('RETURNING')) {
    // Add RETURNING id for PostgreSQL
    sql = sql.trim();
    if (sql.endsWith(';')) {
      sql = sql.slice(0, -1);
    }
    sql += ' RETURNING id';
  }
  
  const result = await pool.query(sql, params);
  
  // PostgreSQL returns rows array with the inserted row
  if (result.rows && result.rows.length > 0) {
    return {
      insertId: result.rows[0].id,
      rows: result.rows,
      rowCount: result.rowCount
    };
  }
  
  // Fallback for MySQL compatibility (shouldn't happen with pg)
  return {
    insertId: result.insertId || null,
    rows: result,
    rowCount: result.rowCount || result.affectedRows || 0
  };
}

/**
 * Execute UPDATE/DELETE and return affected rows count
 * PostgreSQL uses result.rowCount, MySQL uses result.affectedRows
 */
async function executeUpdate(sql, params) {
  const result = await pool.query(sql, params);
  
  return {
    affectedRows: result.rowCount || result.affectedRows || 0,
    rowCount: result.rowCount || result.affectedRows || 0
  };
}

/**
 * Execute SELECT query and return rows
 * Normalizes between MySQL's [rows, fields] and PostgreSQL's {rows}
 */
async function executeSelect(sql, params) {
  const result = await pool.query(sql, params);
  
  // PostgreSQL returns {rows, fields, rowCount}
  if (result.rows) {
    return result.rows;
  }
  
  // MySQL returns [rows, fields]
  if (Array.isArray(result) && result.length > 0) {
    return result[0];
  }
  
  return result;
}

module.exports = {
  insertAndGetId,
  executeUpdate,
  executeSelect
};
