/**
 * Comprobación tras rotar la credencial del superusuario (ADR-0025), dentro del servicio con
 * SOFTARQ_OPERACION=comprobar-credenciales. Solo imprime resultados lógicos, nunca contraseñas ni URL.
 *  ADMIN_DATABASE_URL        → referencia al DATABASE_URL del servicio Postgres (credencial NUEVA).
 *  SOFTARQ_ADMIN_ANTERIOR    → la contraseña anterior (ya rotada), solo para comprobar que dejó de autenticar.
 */
import pg from "pg";

const requerida = (n) => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}.`);
  return v;
};
const admin = new URL(requerida("ADMIN_DATABASE_URL"));
const intentar = async (url) => {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await c.connect();
    return { ok: true, c };
  } catch (e) {
    return { ok: false, codigo: e.code ?? "?" };
  }
};
const log = (t, v) => console.log(`[credenciales] ${t}: ${v}`);

const nueva = await intentar(admin.toString());
log("la credencial nueva del superusuario autentica", nueva.ok);
if (nueva.ok) {
  const { rows } = await nueva.c.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
  log("el rol administrativo es superusuario (solo para operaciones puntuales)", rows[0].rolsuper);
  const { rows: roles } = await nueva.c.query(
    "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication FROM pg_roles WHERE rolname IN ('softarq_app','softarq_migrator','softarq_respaldo')",
  );
  for (const r of roles) log(`${r.rolname} sin privilegios especiales`, !(r.rolsuper || r.rolcreatedb || r.rolcreaterole || r.rolbypassrls || r.rolreplication));
  await nueva.c.end();
}
const vieja = new URL(admin.toString());
vieja.password = requerida("SOFTARQ_ADMIN_ANTERIOR");
const v = await intentar(vieja.toString());
log("la credencial anterior YA NO autentica", !v.ok, v.ok ? "" : `(código ${v.codigo})`);
if (v.ok) await v.c.end();

const app = await intentar(requerida("DATABASE_URL"));
log("la aplicación autentica con softarq_app", app.ok);
if (app.ok) {
  const { rows: [u] } = await app.c.query("SELECT current_user AS rol, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super");
  log("la aplicación usa softarq_app sin ser superusuario", u.rol === "softarq_app" && u.super === false);
  const n = (await app.c.query("SELECT count(*)::int AS n FROM cotizacion")).rows[0].n;
  log("la aplicación conserva su lectura", n > 0);
  let ddl = false;
  try {
    await app.c.query("CREATE TABLE prueba_privilegios (x int)");
    ddl = true;
    await app.c.query("DROP TABLE prueba_privilegios");
  } catch {
    ddl = false;
  }
  log("la aplicación NO puede crear objetos (sin DDL)", !ddl);
  await app.c.end();
}
if (!nueva.ok || v.ok || !app.ok) throw new Error("La comprobación de credenciales detectó un problema.");
