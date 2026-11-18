import type { ClientBase } from "pg";

/**
 * The tables a full backup carries: every table of the app's schema except Prisma's own record of
 * migrations, parents before children (by foreign key), so a restore can insert them in this order.
 */

export type BackupColumn = { name: string; type: string; json: boolean };
export type BackupTable = { name: string; serials: string[]; columns: BackupColumn[] };

export const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Orders tables so each comes after the tables its foreign keys point at; ties go by name. */
export function parentsFirst(tables: string[], links: { child: string; parent: string }[]): string[] {
  const known = new Set(tables);
  const waiting = new Map(tables.map((name) => [name, new Set<string>()]));
  for (const { child, parent } of links) {
    if (!known.has(child) || !known.has(parent)) continue;
    if (child === parent) throw new Error(`Table ${child} points at itself; a backup cannot order it.`);
    waiting.get(child)!.add(parent);
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < tables.length) {
    const ready = [...waiting.entries()]
      .filter(([name, parents]) => !done.has(name) && [...parents].every((parent) => done.has(parent)))
      .map(([name]) => name)
      .sort();
    if (ready.length === 0) throw new Error(`Foreign keys go round in a circle among: ${tables.filter((name) => !done.has(name)).join(", ")}`);
    for (const name of ready) {
      order.push(name);
      done.add(name);
    }
  }
  return order;
}

/** The tables of the `public` schema in insert order, with their counter columns. */
export async function backupTables(client: ClientBase): Promise<BackupTable[]> {
  const tables = await client.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  const links = await client.query<{ child: string; parent: string }>(
    `SELECT child.relname AS child, parent.relname AS parent
       FROM pg_constraint c
       JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_class parent ON parent.oid = c.confrelid
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
  );
  const serials = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')`,
  );
  const columns = await client.query<{ table_name: string; name: string; type: string }>(
    `SELECT c.relname AS table_name, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      ORDER BY c.relname, a.attnum`,
  );
  const byTable = new Map<string, string[]>();
  for (const row of serials.rows) byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name]);
  const columnsOf = new Map<string, BackupColumn[]>();
  for (const row of columns.rows) {
    columnsOf.set(row.table_name, [...(columnsOf.get(row.table_name) ?? []), { name: row.name, type: row.type, json: row.type === "json" || row.type === "jsonb" }]);
  }
  return parentsFirst(
    tables.rows.map((row) => row.name),
    links.rows,
  ).map((name) => ({ name, serials: byTable.get(name) ?? [], columns: columnsOf.get(name) ?? [] }));
}

/**
 * One row as JSON text. A json column goes in as its text, so a stored JSON `null` stays apart from an
 * empty (SQL NULL) column.
 */
export function rowSelect(table: BackupTable): string {
  const json = table.columns.filter((column) => column.json);
  const base = `to_jsonb(t)`;
  if (json.length === 0) return `${base}::text`;
  return `(${base} || jsonb_build_object(${json.map((column) => `'${column.name.replace(/'/g, "''")}', t.${quote(column.name)}::text`).join(", ")}))::text`;
}

/** Inserts a JSON array of rows written by `rowSelect`, each value turned back into its column's type. */
export function rowInsert(table: BackupTable): string {
  const names = table.columns.map((column) => quote(column.name)).join(", ");
  const values = table.columns.map((column) => (column.json ? `r.${quote(column.name)}::${column.type}` : `r.${quote(column.name)}`)).join(", ");
  const shape = table.columns.map((column) => `${quote(column.name)} ${column.json ? "text" : column.type}`).join(", ");
  return `INSERT INTO ${quote(table.name)} (${names}) OVERRIDING SYSTEM VALUE SELECT ${values} FROM jsonb_to_recordset($1::jsonb) AS r(${shape})`;
}

/** The migrations this database has fully applied, in order: two databases with the same list have the same tables. */
export async function appliedMigrations(client: ClientBase): Promise<string[]> {
  const rows = await client.query<{ migration_name: string }>(
    `SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`,
  );
  return rows.rows.map((row) => row.migration_name);
}
