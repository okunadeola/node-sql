// server/src/utils/sqlBuilder.js
/**
 * SQL Query Builder
 * Provides utilities for dynamically building SQL queries
 */
class SqlBuilder {
  /**
   * Create a WHERE clause from filter conditions
   * @param {Object} filters - Key-value pairs of filter conditions
   * @param {number} [startParamIndex=1] - Starting index for parameterized queries
   * @returns {Object} Object containing where clause and parameters
   */
  static buildWhereClause(filters, startParamIndex = 1) {
    if (!filters || Object.keys(filters).length === 0) {
      return { whereClause: '', params: [] };
    }

    const conditions = [];
    const params = [];
    let paramIndex = startParamIndex;

    for (const [key, value] of Object.entries(filters)) {
      // Skip null or undefined values
      if (value === null || value === undefined) continue;

      // Handle special operators like IN, BETWEEN, etc.
      if (typeof value === 'object' && !Array.isArray(value)) {
        const { operator, value: operatorValue } = value;
        
        if (operator && operatorValue !== null && operatorValue !== undefined) {
          switch (operator.toUpperCase()) {
            case 'IN':
              if (Array.isArray(operatorValue) && operatorValue.length > 0) {
                const placeholders = operatorValue.map(() => `$${paramIndex++}`).join(', ');
                conditions.push(`${key} IN (${placeholders})`);
                params.push(...operatorValue);
              }
              break;
            case 'BETWEEN':
              if (Array.isArray(operatorValue) && operatorValue.length === 2) {
                conditions.push(`${key} BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
                params.push(operatorValue[0], operatorValue[1]);
                paramIndex += 2;
              }
              break;
            case 'LIKE':
            case 'ILIKE':
              conditions.push(`${key} ${operator} $${paramIndex++}`);
              params.push(`%${operatorValue}%`);
              break;
            case '>':
            case '>=':
            case '<':
            case '<=':
            case '!=':
              conditions.push(`${key} ${operator} $${paramIndex++}`);
              params.push(operatorValue);
              break;
            case 'IS NULL':
              conditions.push(`${key} IS NULL`);
              break;
            case 'IS NOT NULL':
              conditions.push(`${key} IS NOT NULL`);
              break;
            default:
              conditions.push(`${key} = $${paramIndex++}`);
              params.push(operatorValue);
          }
        }
      } else if (Array.isArray(value)) {
        // Handle array values as IN conditions
        if (value.length > 0) {
          const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
          conditions.push(`${key} IN (${placeholders})`);
          params.push(...value);
        }
      } else {
        // Handle simple equality
        conditions.push(`${key} = $${paramIndex++}`);
        params.push(value);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, params };
  }

  /**
   * Build ORDER BY clause from sort parameters
   * @param {Object|Array|string} sort - Sort configuration
   * @param {string} defaultSort - Default sort field and direction
   * @returns {string} ORDER BY clause
   */
  static buildOrderByClause(sort, defaultSort = 'created_at DESC') {
    if (!sort) {
      return `ORDER BY ${defaultSort}`;
    }

    let sortFields = [];

    if (typeof sort === 'string') {
      // Simple string sorting e.g. 'price ASC'
      sortFields.push(sort);
    } else if (Array.isArray(sort)) {
      // Array of sort fields e.g. ['price ASC', 'name DESC']
      sortFields = sort;
    } else if (typeof sort === 'object') {
      // Object with field:direction pairs e.g. { price: 'ASC', name: 'DESC' }
      sortFields = Object.entries(sort).map(([field, direction]) => 
        `${field} ${direction.toUpperCase()}`
      );
    }

    return sortFields.length > 0
      ? `ORDER BY ${sortFields.join(', ')}`
      : `ORDER BY ${defaultSort}`;
  }

  /**
   * Build LIMIT and OFFSET clause for pagination
   * @param {number} page - Page number (1-based indexing)
   * @param {number} limit - Number of records per page
   * @returns {Object} Object containing limit, offset and pagination info
   */
  static buildPaginationClause(page = 1, limit = 20) {
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const offset = (pageNum - 1) * limitNum;

    return {
      limitClause: `LIMIT ${limitNum} OFFSET ${offset}`,
      limit: limitNum,
      offset,
      page: pageNum
    };
  }

  /**
   * Build INSERT query
   * @param {string} table - Table name
   * @param {Object} data - Data to insert
   * @returns {Object} SQL query and parameters
   */
  static buildInsertQuery(table, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    
    const query = `
      INSERT INTO ${table} (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `;
    
    return { query, values };
  }

  /**
   * Build UPDATE query
   * @param {string} table - Table name
   * @param {Object} data - Data to update
   * @param {Object} where - Where conditions
   * @returns {Object} SQL query and parameters
   */
  static buildUpdateQuery(table, data, where) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    
    const setClause = columns
      .map((col, index) => `${col} = $${index + 1}`)
      .join(', ');
    
    let paramCount = values.length;
    const whereConditions = [];
    const whereValues = [];
    
    for (const [key, value] of Object.entries(where)) {
      whereConditions.push(`${key} = $${++paramCount}`);
      whereValues.push(value);
    }
    
    const query = `
      UPDATE ${table}
      SET ${setClause}
      WHERE ${whereConditions.join(' AND ')}
      RETURNING *
    `;
    
    return { query, values: [...values, ...whereValues] };
  }

  /**
   * Build a SELECT query
   * @param {string} table - Table name
   * @param {Array} columns - Columns to select
   * @param {Object} filters - Filter conditions
   * @param {Object} options - Additional options (sort, pagination)
   * @returns {Object} SQL query and parameters
   */
  static buildSelectQuery(table, columns = ['*'], filters = {}, options = {}) {
    const columnsStr = Array.isArray(columns) ? columns.join(', ') : columns;
    const { whereClause, params } = this.buildWhereClause(filters);
    
    const orderBy = options.sort
      ? this.buildOrderByClause(options.sort)
      : '';
    
    const pagination = options.pagination
      ? this.buildPaginationClause(options.pagination.page, options.pagination.limit)
      : { limitClause: '' };
    
    const query = `
      SELECT ${columnsStr}
      FROM ${table}
      ${whereClause}
      ${orderBy}
      ${pagination.limitClause}
    `;
    
    return { 
      query, 
      params, 
      pagination: options.pagination ? pagination : null 
    };
  }

  /**
   * Build a query for fetching total count (for pagination)
   * @param {string} table - Table name
   * @param {Object} filters - Filter conditions
   * @returns {Object} SQL query and parameters
   */
  static buildCountQuery(table, filters = {}) {
    const { whereClause, params } = this.buildWhereClause(filters);
    
    const query = `
      SELECT COUNT(*) AS total
      FROM ${table}
      ${whereClause}
    `;
    
    return { query, params };
  }

  /**
   * Generate a dynamically parameterized IN clause
   * @param {Array} items - Array of items for the IN clause
   * @param {number} startIndex - Starting parameter index
   * @returns {Object} parameterized IN clause and updated index
   */
  static generateInClause(items, startIndex = 1) {
    if (!items || items.length === 0) {
      return { inClause: '(NULL)', params: [], nextIndex: startIndex };
    }

    const placeholders = [];
    const params = [];
    let paramIndex = startIndex;

    for (const item of items) {
      placeholders.push(`$${paramIndex++}`);
      params.push(item);
    }

    return {
      inClause: `(${placeholders.join(', ')})`,
      params,
      nextIndex: paramIndex
    };
  }

  /**
   * Generate a dynamically parameterized VALUES clause for multi-row insert
   * @param {Array} items - Array of objects to insert
   * @param {Array} columns - Column names
   * @returns {Object} parameterized VALUES clause and parameters
   */
  static generateBulkInsertClause(items, columns) {
    if (!items || items.length === 0 || !columns || columns.length === 0) {
      return { valuesClause: '', params: [] };
    }

    const params = [];
    let paramIndex = 1;
    const valueRows = [];

    for (const item of items) {
      const rowPlaceholders = [];
      for (const column of columns) {
        rowPlaceholders.push(`$${paramIndex++}`);
        params.push(item[column] ?? null);
      }
      valueRows.push(`(${rowPlaceholders.join(', ')})`);
    }

    return {
      valuesClause: valueRows.join(',\n'),
      params
    };
  }

  /**
   * Build JSON/JSONB query conditions
   * @param {string} column - JSON column name
   * @param {string} path - JSON path
   * @param {*} value - Value to compare against
   * @param {string} [operator='='] - Comparison operator
   * @returns {Object} SQL fragment and value
   */
  static jsonCondition(column, path, value, operator = '=') {
    // For PostgreSQL JSONB operations
    const pathParts = path.split('.');
    let sqlFragment;
    
    if (pathParts.length === 1) {
      // Simple key access
      sqlFragment = `${column}->>'${pathParts[0]}' ${operator} $%i`;
    } else {
      // Nested key access
      const lastKey = pathParts.pop();
      const jsonPath = pathParts.map(part => `'${part}'`).join('->');
      sqlFragment = `${column}->${jsonPath}->>'${lastKey}' ${operator} $%i`;
    }
    
    return { sqlFragment, value };
  }
}

module.exports = SqlBuilder;