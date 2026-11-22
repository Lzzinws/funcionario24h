/**
 * Proteções contra prompt injection.
 *
 * A defesa principal NÃO é este detector: é a arquitetura — instruções e
 * permissões vêm somente do banco, o texto do cliente entra como dado
 * delimitado, e toda ferramenta é validada e autorizada no servidor. O
 * detector apenas registra tentativas para auditoria.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|as\s+|todas?\s+as\s+)?(previous|prior|above|anteriores|instru)/i,
  /(esque[cç]a|desconsidere|ignore)\s+(tudo|as\s+instru|suas\s+instru|o\s+que)/i,
  /(system|sistema)\s*prompt/i,
  /(voc[eê]\s+agora\s+[eé]|you\s+are\s+now|a\s+partir\s+de\s+agora\s+voc[eê])/i,
  /(modo|mode)\s+(desenvolvedor|developer|admin|administrador|dan)\b/i,
  /(revele|mostre|repita|print|reveal)\s+(suas?\s+)?(instru|prompt|regras|configura)/i,
  /(aprove|aprovar|libere|liberar)\s+(sem|without)\s+(aprova|approval|autoriza)/i,
  /(altere|mude|change)\s+(suas?\s+)?(permiss|regras|instru)/i,
  /<\/?\s*(system|instructions?|regras|mensagem_cliente|historico)\b/i,
];

export function detectInjection(text: string): { suspected: boolean; matches: string[] } {
  const matches = INJECTION_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
  return { suspected: matches.length > 0, matches };
}

/**
 * Neutraliza marcações que poderiam "fechar" os delimitadores do prompt.
 * Remove caracteres de controle e troca < > por equivalentes visuais.
 */
export function sanitizeUntrusted(text: string, maxChars: number): string {
  const cleaned = text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) + " […]" : cleaned;
}

/** Remove dados que nunca devem ir para a resposta (ex.: marcações internas). */
export function cleanReply(text: string): string {
  return text.replace(/<\/?[a-z_]+>/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}
