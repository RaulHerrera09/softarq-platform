/**
 * Alcance de la vista (presentación limpia): qué clasificación de clientes muestran las listas, la bandeja y los contadores.
 * Por omisión es «Presentación»; quien necesite los ejemplos o el historial completo lo cambia en «Mi trabajo» o en el filtro de
 * cada lista (es el mismo valor compartido). No borra ni oculta nada en el servidor: solo filtra lo que se consulta.
 * Fuera del proveedor (pruebas de pantallas sueltas) cada pantalla usa su propio estado, sin filtro.
 */
import type { FiltroClasificacion } from "@softarq/contracts";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface ValorAmbito {
  ambito: FiltroClasificacion | undefined;
  setAmbito: (v: FiltroClasificacion | undefined) => void;
}

const ContextoAmbito = createContext<ValorAmbito | null>(null);

export function ProveedorAmbito({ children }: { children: ReactNode }) {
  const [ambito, setAmbito] = useState<FiltroClasificacion | undefined>("PRESENTACION");
  const valor = useMemo(() => ({ ambito, setAmbito }), [ambito]);
  return <ContextoAmbito.Provider value={valor}>{children}</ContextoAmbito.Provider>;
}

export function useAmbito(): ValorAmbito {
  const compartido = useContext(ContextoAmbito);
  const [ambito, setAmbito] = useState<FiltroClasificacion | undefined>(undefined);
  return compartido ?? { ambito, setAmbito };
}
