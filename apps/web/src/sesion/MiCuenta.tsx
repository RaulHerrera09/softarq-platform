/**
 * «Mi cuenta → Cambiar contraseña»: cambio voluntario de la contraseña propia con el mecanismo existente del
 * servidor (`POST /api/v1/auth/contrasena`: pide la actual, revoca todas las sesiones). Mismo formulario y
 * política que el cambio obligatorio de una temporal.
 */
import type { RespuestaSesion } from "@softarq/contracts";
import { PantallaCambioContrasena } from "./PantallaCambioContrasena.tsx";
import { useSesion } from "./ProveedorSesion.tsx";

export function MiCuenta({ sesion }: { sesion: RespuestaSesion }) {
  const { cambiarContrasena, cerrar } = useSesion();
  return (
    <section aria-label="Mi cuenta">
      <PantallaCambioContrasena modo="voluntario" sesion={sesion} alCambiar={cambiarContrasena} alCerrar={cerrar} />
    </section>
  );
}
