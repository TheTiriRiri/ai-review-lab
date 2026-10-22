export type Operator = "=" | "!=" | "<" | "<=" | ">" | ">=" | "LIKE";
export type Value = string | number | boolean;

export interface Query {
  sql: string;
  params: Value[];
}

const OPERATORS: ReadonlySet<string> = new Set<Operator>(["=", "!=", "<", "<=", ">", ">=", "LIKE"]);
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

/**
 * Table and column names cannot be bound as parameters, so they are the one place
 * caller input reaches the SQL text. Every name goes through this check first.
 */
export function assertIdentifier(name: string): void {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`"${name}" is not a valid SQL identifier`);
  }
}

interface Condition {
  column: string;
  operator: Operator;
  value: Value;
}

class SelectBuilder {
  readonly #table: string;
  readonly #conditions: Condition[] = [];
  #orderBy: string | undefined;
  #limit: number | undefined;

  constructor(table: string) {
    assertIdentifier(table);
    this.#table = table;
  }

  where(column: string, operator: Operator, value: Value): this {
    assertIdentifier(column);
    if (!OPERATORS.has(operator)) {
      throw new Error(`unsupported operator "${operator}"`);
    }
    this.#conditions.push({ column, operator, value });
    return this;
  }

  /** Sorts the rows, e.g. `orderBy("created_at DESC")`. */
  orderBy(expression: string): this {
    this.#orderBy = expression;
    return this;
  }

  limit(count: number): this {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`limit must be a positive integer, got ${count}`);
    }
    this.#limit = count;
    return this;
  }

  build(): Query {
    const params: Value[] = [];
    let sql = `SELECT * FROM ${this.#table}`;
    if (this.#conditions.length > 0) {
      const clauses = this.#conditions.map(({ column, operator, value }) => {
        params.push(value);
        return `${column} ${operator} $${params.length}`;
      });
      sql += ` WHERE ${clauses.join(" AND ")}`;
    }
    if (this.#orderBy !== undefined) {
      sql += ` ORDER BY ${this.#orderBy}`;
    }
    if (this.#limit !== undefined) {
      sql += ` LIMIT ${this.#limit}`;
    }
    return { sql, params };
  }
}

export function select(table: string): SelectBuilder {
  return new SelectBuilder(table);
}
