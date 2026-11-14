// @vitest-environment jsdom
/**
 * «Mi cuenta → Cambiar contraseña»: el cambio voluntario reutiliza el formulario del cambio obligatorio.
 * Pide la contraseña actual (no «temporal»), valida longitud, distinta y confirmación, y envía lo escrito.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RespuestaSesion } from "@softarq/contracts";
import { describe, expect, it, vi } from "vitest";
import { PantallaCambioContrasena } from "../PantallaCambioContrasena.tsx";

const SESION = { usuario: { nombre: "Raúl Preparador" }, organizacion: { nombre: "Organización DEMO" } } as unknown as RespuestaSesion;

describe("Mi cuenta: cambio voluntario de contraseña", () => {
  it("usa los textos del cambio voluntario y envía actual, nueva y confirmación", async () => {
    const alCambiar = vi.fn(async () => ({ ok: true as const }));
    render(<PantallaCambioContrasena modo="voluntario" sesion={SESION} alCambiar={alCambiar} alCerrar={async () => ({ ok: true as const })} />);
    expect(screen.getByRole("heading", { name: "Cambiar contraseña" })).toBeTruthy();
    expect(screen.queryByText(/contraseña temporal/i)).toBeNull();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Contraseña actual"), "la-actual-que-tengo");
    await u.type(screen.getByLabelText("Contraseña nueva"), "mi frase nueva y larga");
    await u.type(screen.getByLabelText("Confirmación"), "mi frase nueva y larga");
    await u.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
    await waitFor(() => expect(alCambiar).toHaveBeenCalledWith({ actual: "la-actual-que-tengo", nueva: "mi frase nueva y larga", confirmacion: "mi frase nueva y larga" }));
  });

  it("avisa antes de enviar si la nueva es igual a la actual o la confirmación no coincide", async () => {
    const alCambiar = vi.fn(async () => ({ ok: true as const }));
    render(<PantallaCambioContrasena modo="voluntario" sesion={SESION} alCambiar={alCambiar} alCerrar={async () => ({ ok: true as const })} />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Contraseña actual"), "misma frase larga 123");
    await u.type(screen.getByLabelText("Contraseña nueva"), "misma frase larga 123");
    await u.type(screen.getByLabelText("Confirmación"), "otra distinta cualquiera");
    await u.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
    expect(await screen.findByText("La contraseña nueva debe ser distinta de la actual.")).toBeTruthy();
    expect(screen.getByText("La confirmación no coincide con la contraseña nueva.")).toBeTruthy();
    expect(alCambiar).not.toHaveBeenCalled();
  });
});
