import { BookOpen, LayoutGrid, Settings, Users } from "lucide-react";

/** Itens de navegação. Novos módulos entram aqui conforme forem entregues. */
export const NAV_ITEMS = [
  { href: "/painel", label: "Painel", icon: LayoutGrid },
  { href: "/funcionarios", label: "Funcionários", icon: Users },
  { href: "/conhecimento", label: "Base de conhecimento", icon: BookOpen },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
] as const;
