import { BookOpen, CreditCard, LayoutGrid, Settings, Users } from "lucide-react";

/** Itens de navegação. Novos módulos entram aqui conforme forem entregues. */
export const NAV_ITEMS = [
  { href: "/painel", label: "Painel", icon: LayoutGrid },
  { href: "/funcionarios", label: "Funcionários", icon: Users },
  { href: "/conhecimento", label: "Base de conhecimento", icon: BookOpen },
  { href: "/assinatura", label: "Plano e cobrança", icon: CreditCard },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
] as const;
